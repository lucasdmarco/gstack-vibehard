import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { stripBom } from "../util/json.js"
import { fileURLToPath } from "url"
import { createHash } from "crypto"
import { execFileSync } from "child_process"
import { isStrongTrust } from "../dream/capabilities.js"
import { detectProfile } from "./detect-profile.js"
import { publishGuard } from "./publish-guard.js"
import { diffHygiene } from "./diff-hygiene.js"
import { loadRuntimeManifest, validateRuntimeManifest } from "../runtime/manifest.js"
import { readAllState } from "../runtime/supervisor.js"
import { runStepProcess } from "../util/exec-step.js"

const PKG_QG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks", "hooks", "qg.py")

function fileSha(p) { try { return "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex") } catch { return null } }
function readQgVersion(p) { try { const m = readFileSync(p, "utf-8").match(/QG_VERSION\s*=\s*["']([^"']+)["']/); return m ? m[1] : null } catch { return null } }

/** Metadados do QG que rodou + drift vs o qg.py EMPACOTADO (P0.1). */
function qgMeta(qgHook) {
  const installedHash = fileSha(qgHook)
  const pkgHash = fileSha(PKG_QG)
  const origin = qgHook === PKG_QG ? "bundled" : qgHook.includes(".gstack") ? "gstack" : qgHook.includes(".codex") ? "codex" : "installed"
  const drift = !!(installedHash && pkgHash && installedHash !== pkgHash)
  return { origin, path: qgHook, version: readQgVersion(qgHook), packagedVersion: readQgVersion(PKG_QG), hash: installedHash, packagedHash: pkgHash, drift }
}

/** Fingerprint do projeto p/ cache do `verify --quick` (P0.2): package.json +
 *  path/size/mtime de src/tests/hooks. Determinístico, barato, sem ler conteúdo. */
const isSkipDir = (name) => name === "node_modules" || name === ".git"
const hashFileStat = (h, p) => { try { const s = statSync(p); h.update(`${p}:${s.size}:${Math.round(s.mtimeMs)}`) } catch { /* skip */ } }
function projectFingerprint(cwd) {
  const h = createHash("sha256")
  try { h.update(readFileSync(join(cwd, "package.json"))) } catch { /* sem pkg */ }
  const walk = (dir, depth = 0) => {
    if (depth > 8) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (isSkipDir(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else hashFileStat(h, p)
    }
  }
  for (const sub of ["src", "tests", "hooks"]) walk(join(cwd, sub))
  return "sha256:" + h.digest("hex")
}
function cachePath(cwd) { return join(cwd, ".gstack", "verify-cache.json") }
function readVerifyCache(cwd) { try { return JSON.parse(stripBom(readFileSync(cachePath(cwd), "utf-8"))) } catch { return null } }
function writeVerifyCache(cwd, data) { try { mkdirSync(join(cwd, ".gstack"), { recursive: true }); writeFileSync(cachePath(cwd), JSON.stringify(data, null, 2) + "\n") } catch { /* cache best-effort */ } }

/**
 * Delivery gates HONESTOS (PRD Fase 3 §6). Orquestra só os gates que existem;
 * o que falta é classificado com precisão — nunca "sucesso silencioso".
 *
 * Status por gate: passed | failed | not_applicable | tool_missing | pending_feature
 * Status do run:
 *   blocked             = algum gate OBRIGATÓRIO falhou.
 *   pending_product     = runtime/preview pendente E o projeto precisa rodar (start/dev).
 *   ready_with_warnings = passou, mas faltou ferramenta esperada (ex.: Fallow/QG ausente).
 *   ready               = tudo aplicável passou, sem avisos.
 * `reducedTrust` = harness ativo não tem controle real (best_effort/partial).
 */

function readJson(p) { try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return {} } }

function defaultExec(file, args, opts) {
  if (process.platform === "win32" && file === "npm") {
    return execFileSync("cmd.exe", ["/c", "npm", ...args], { stdio: "pipe", timeout: 600000, ...opts })
  }
  return execFileSync(file, args, { stdio: "pipe", timeout: 600000, ...opts })
}

function findQgHook(home) {
  for (const p of [join(home, ".gstack", "hooks", "qg.py"), join(home, ".codex", "hooks", "qg.py")]) {
    if (existsSync(p)) return p
  }
  return null
}

// Timeout POR ETAPA (PRD20 20.1) — o release nunca mais fica mudo por 10 min.
// `test` = 900s: a suíte completa (680+ testes com E2Es que spawnam processos reais)
// passa de 300s em máquina fria/lenta — 300s reprovava suíte VERDE por duração
// (revisão pós-PRD25). Não mascara falha: asserção quebrada falha rápido; só um
// hang real chega ao teto. Override p/ máquinas extremas: GSTACK_VERIFY_TEST_TIMEOUT_MS.
const STEP_TIMEOUT_MS = { deps: 300000, test: 900000, build: 300000, "qg-l1": 120000, "qg-l2": 180000 }
function envTimeout(id) {
  if (id !== "test") return null
  const v = Number(process.env.GSTACK_VERIFY_TEST_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : null
}
function stepTimeout(id) { return envTimeout(id) || STEP_TIMEOUT_MS[id] || 60000 }

// Package manager REAL do projeto (PR2/PR5): packageManager field → lockfile → npm.
function pmFromLock(cwd) {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  if (existsSync(join(cwd, "bun.lockb"))) return "bun"
  return "npm"
}
function resolvePm(cwd, hasPkg, pkgPath) {
  try { const p = hasPkg ? readJson(pkgPath) : {}; if (p.packageManager) return String(p.packageManager).split("@")[0] } catch { /* ignore */ }
  return pmFromLock(cwd)
}

function stepStatus(r) {
  if (r.timedOut) return "timed_out"
  return r.code === 0 ? "passed" : "failed"
}
function cmdDetail(status, r, command) {
  if (status === "timed_out") return `timeout: ${command}`
  if (status === "failed") return (r.stderr || r.stdout || "falhou").split("\n")[0].slice(0, 160)
  return null
}
/** Monta o step de um comando a partir do resultado estruturado (passed/failed/timed_out). */
function buildCmdStep(id, r, required, command) {
  const status = stepStatus(r)
  const step = { id, status, required, command }
  const detail = cmdDetail(status, r, command)
  if (detail) step.detail = detail
  if (r.stdout) step.stdoutTail = r.stdout
  if (r.stderr) step.stderrTail = r.stderr
  if (typeof r.durationMs === "number") step.durationMs = r.durationMs
  return step
}

/** Resultado estruturado a partir de um erro do exec injetado (throw→failed). */
function execError(e) {
  return { code: Number.isInteger(e.status) ? e.status : 1, timedOut: false, stdout: String(e.stdout || ""), stderr: String(e.stderr || e.message || "") }
}

/**
 * Runner estruturado de UMA etapa. Default = spawn com timeout + tree-kill
 * (`runStepProcess`). `exec` injetado (testes) → adaptado ao contrato throw→failed,
 * sem timeout real (determinístico). Sempre devolve { code, timedOut, stdout, stderr }.
 */
function makeStepExec(injected, cwd) {
  if (!injected) return (file, args, o = {}) => runStepProcess(file, args, { cwd, timeoutMs: o.timeoutMs })
  return (file, args) => {
    try { return { code: 0, timedOut: false, stdout: String(injected(file, args, { cwd }) || ""), stderr: "" } }
    catch (e) { return execError(e) }
  }
}

/** Comando de teste do projeto (npm test | pytest | vazio). */
function testCommand({ scripts = {}, hasPyTests, pm = "npm", pyBin = "python3" }) {
  if (scripts.test) return `${pm} test`
  if (hasPyTests) return `${pyBin} -m pytest -q`
  return ""
}

/** Flags de fase (profile) — isola os operadores booleanos das specs. */
function phaseFlags(ctx) {
  return {
    notQuick: ctx.profile !== "quick",
    fullish: ctx.profile === "full" || ctx.profile === "release",
    strict: ctx.isRelease ? " --strict" : "",
    testCmd: testCommand(ctx),
  }
}

/** Specs [id, incluir?, comando, required?] dos gates executáveis do profile. */
function gateSpecs(ctx) {
  const p = phaseFlags(ctx)
  const { scripts = {}, hasPkg, qgAvailable, pm = "npm" } = ctx
  return [
    ["deps", p.notQuick && hasPkg, `${pm} install`, true],
    ["lint", !!scripts.lint, `${pm} run lint`, false],
    ["typecheck", p.fullish && !!scripts.typecheck, `${pm} run typecheck`, false],
    ["test", p.notQuick && !!p.testCmd, p.testCmd, true],
    ["build", p.fullish && !!scripts.build, `${pm} run build`, true],
    ["qg-l1", qgAvailable, `qg --level 1${p.strict}`, true],
    ["qg-l2", qgAvailable && p.notQuick, `qg --level 2${p.strict}`, true],
  ]
}

/**
 * Lista PURA dos comandos de gate que um profile RODARIA (para `--dry-run`). Só os
 * comandos executáveis — o ponto do dry-run é mostrar o que seria executado sem
 * executar nada.
 */
export function planVerifySteps(ctx) {
  return gateSpecs(ctx).filter((s) => s[1]).map(([id, , command, required]) => ({ id, command, required }))
}

const VALID_PROFILES = ["quick", "scaffold", "full", "release"]
const profileFlags = (profile) => ({ isQuick: profile === "quick", isFullish: profile === "full" || profile === "release", isRelease: profile === "release" })
function detectProject(cwd) {
  const pkgPath = join(cwd, "package.json")
  const hasPkg = existsSync(pkgPath)
  const scripts = (hasPkg ? readJson(pkgPath).scripts : {}) || {}
  const { profile: archetype } = detectProfile(cwd)
  return {
    pkgPath, hasPkg, scripts, archetype,
    hasPyTests: ["pytest.ini", "pyproject.toml", "requirements.txt"].some((f) => existsSync(join(cwd, f))),
    hasRunScript: !!(scripts.start || scripts.dev), // projeto que "roda" (app/web)
    isLibCli: archetype === "library" || archetype === "cli",
  }
}
const execCtx = (opts, cwd) => ({
  exec: opts.exec || defaultExec,
  pyBin: process.platform === "win32" ? "python" : "python3",
  // Progresso incremental (PRD20 20.1): cada etapa é emitida ao sink (arquivo).
  stepExec: opts.stepExec || makeStepExec(opts.exec, cwd),
  onStep: typeof opts.onStep === "function" ? opts.onStep : null,
})
function buildVerifyCtx(opts) {
  const cwd = opts.cwd || process.cwd()
  const home = opts.home || homedir()
  const profile = VALID_PROFILES.includes(opts.profile) ? opts.profile : "full"
  const flags = profileFlags(profile)
  const proj = detectProject(cwd)
  return {
    cwd, home, profile, opts, ...flags, ...proj, ...execCtx(opts, cwd),
    qgHook: findQgHook(home),
    steps: [],
    pm: resolvePm(cwd, proj.hasPkg, proj.pkgPath), // dry-run e o plano precisam dele
    fingerprint: flags.isQuick ? projectFingerprint(cwd) : null,
  }
}

// Cache do --quick (P0.2): sem mudanças desde a última run → cache_hit rápido.
const validQuickCache = (cached, fp) => !!cached && cached.profile === "quick" && cached.fingerprint === fp && !!cached.result
function checkQuickCache(c) {
  if (!c.isQuick || c.opts.noCache === true) return null
  const cached = readVerifyCache(c.cwd)
  if (!validQuickCache(cached, c.fingerprint)) return null
  const r = cached.result
  return { ...r, cached: true, steps: r.steps.map((s) => ({ ...s, status: "cache_hit", was: s.status })) }
}
// `--dry-run`: lista os comandos do profile SEM executar nada (PRD20 20.1).
function buildDryRun(c) {
  const qgAvailable = !!(c.isRelease && existsSync(PKG_QG)) || !!c.qgHook
  return { profile: c.profile, dryRun: true, plan: planVerifySteps({ profile: c.profile, scripts: c.scripts, hasPyTests: c.hasPyTests, hasPkg: c.hasPkg, qgAvailable, isRelease: c.isRelease, pm: c.pm, pyBin: c.pyBin }) }
}

// Runners (record/run/na/runPm) que compartilham steps/sink/pm via o ctx `c`.
function makeRunners(c) {
  const record = (step) => { c.steps.push(step); if (c.onStep) { try { c.onStep(step) } catch { /* sink best-effort */ } } }
  const run = (id, file, args, { required = false } = {}) => {
    const r = c.stepExec(file, args, { timeoutMs: stepTimeout(id) })
    record(buildCmdStep(id, r, required, `${file} ${(args || []).join(" ")}`.trim()))
  }
  const na = (id, detail, required = false) => record({ id, status: "not_applicable", required, detail })
  // Exec do PM cross-platform: no Windows o binário é `pm.cmd` → cmd.exe /c (senão ENOENT).
  const runPm = (id, args, o) => {
    if (process.platform === "win32") run(id, process.env.ComSpec || "cmd.exe", ["/c", c.pm, ...args], o)
    else run(id, c.pm, args, o)
  }
  return { record, run, na, runPm }
}

// 1. deps — quick: checagem FILESYSTEM (instantânea); full/release: install obrigatório.
function depsQuick(c) {
  if (!c.hasPkg) return c.na("deps", "sem package.json")
  const pkg = readJson(c.pkgPath)
  const declared = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
  const missing = declared.filter((d) => !existsSync(join(c.cwd, "node_modules", d)))
  if (missing.length === 0) return c.record({ id: "deps", status: "passed", detail: "node_modules ok (check rápido)" })
  c.record({ id: "deps", status: "failed", detail: `deps ausentes: ${missing.slice(0, 5).join(", ")} — rode ${c.pm} install` })
}
function gateDeps(c) {
  if (c.isQuick) return depsQuick(c)
  if (c.isFullish) c.hasPkg ? c.runPm("deps", ["install"], { required: true }) : c.na("deps", "sem package.json")
}
function gateLint(c) { c.scripts.lint ? c.runPm("lint", ["run", "lint"]) : c.na("lint", "sem script lint") }
function gateTypecheck(c) { if (c.isFullish) c.scripts.typecheck ? c.runPm("typecheck", ["run", "typecheck"]) : c.na("typecheck", "sem script typecheck") }
function gateTest(c) {
  if (c.isQuick) return c.na("test", "pulado no --quick (use --profile full p/ a suíte)")
  if (c.scripts.test) return c.runPm("test", ["test"], { required: true })
  if (c.hasPyTests) return c.run("test", c.pyBin, ["-m", "pytest", "-q"], { required: true })
  c.na("test", "sem suíte de testes")
}
function gateBuild(c) { if (c.isFullish) c.scripts.build ? c.runPm("build", ["run", "build"], { required: true }) : c.na("build", "sem script build") }

// 6. Quality Gate — quick: L1 advisory; full/release: L1+L2 bloqueantes (release usa o EMPACOTADO).
function qgQuick(c, qgRun) {
  // quick: L1 com timeout CURTO e ADVISORY — feedback < 30s sem travar num Fallow lento.
  try { c.exec(c.pyBin, [qgRun, "--path", ".", "--level", "1", "--timeout", "15"], { cwd: c.cwd }); c.record({ id: "qg-l1", status: "passed" }) }
  catch { c.record({ id: "qg-l1", status: "advisory", detail: "advisory no quick (rode `verify` p/ o gate bloqueante)" }) }
}
function qgFull(c, qgRun) {
  const strict = c.isRelease ? ["--strict"] : []
  c.run("qg-l1", c.pyBin, [qgRun, "--path", ".", "--level", "1", ...strict], { required: true })
  c.run("qg-l2", c.pyBin, [qgRun, "--path", ".", "--level", "2", ...strict], { required: true })
}
function qgMissing(c) {
  // Fail-closed no release (claim de QG REAL não pode ser opcional); demais: tool_missing.
  if (c.isRelease) return c.record({ id: "qg", status: "failed", required: true, detail: "Fallow/QG obrigatório no --profile release e não está instalado" })
  c.record({ id: "qg", status: "tool_missing", required: false, detail: "Fallow/QG não instalado" })
}
function gateQg(c) {
  const qgRun = c.isRelease && existsSync(PKG_QG) ? PKG_QG : c.qgHook
  if (!qgRun) { qgMissing(c); return null }
  c.isQuick ? qgQuick(c, qgRun) : qgFull(c, qgRun)
  return qgRun
}

// 7. Gates por arquétipo (lib/CLI) — ADVISORY (observe-only); release torna publish-guard bloqueante.
function gatePublishGuard(c) {
  try {
    const pg = publishGuard({ cwd: c.cwd, exec: c.exec, checkCi: false })
    const okStatus = pg.status === "pass" ? "passed" : c.isRelease ? "failed" : "advisory"
    c.record({ id: "publish-guard", status: okStatus, required: c.isRelease, detail: pg.status === "pass" ? "pronto p/ publicar" : `pendências: ${pg.failed.join(", ")}` })
  } catch { c.record({ id: "publish-guard", status: "advisory", detail: "guard indisponível" }) }
}
function gateDiffHygiene(c) {
  try {
    const dh = diffHygiene({ cwd: c.cwd, exec: c.exec })
    c.record({ id: "diff-hygiene", status: dh.findings.length === 0 ? "passed" : "advisory", detail: dh.findings.length ? `${dh.findings.length} achado(s), ${dh.high} HIGH` : "limpo" })
  } catch { c.record({ id: "diff-hygiene", status: "advisory", detail: "hygiene indisponível" }) }
}
function gateLibCli(c) {
  gatePublishGuard(c)
  gateDiffHygiene(c)
  c.na("runtime:start", "não se aplica a lib/CLI")
  c.na("preview:open", "não se aplica a lib/CLI")
}

// 8. runtime/preview — verify CONHECE o runtime entregue: valida o Manifest V2 e reporta
//    o estado real dos serviços. Sem runtime declarado, preserva o pending_product.
const safeReadAllState = (cwd) => { try { return readAllState(cwd) } catch { return [] } }
function runtimePending(c) {
  c.record({ id: "runtime:start", status: "pending_feature", productCritical: c.hasRunScript, detail: "sem .gstack/runtime.json — `gstack_vibehard create` declara o runtime" })
  c.record({ id: "preview:open", status: "pending_feature", productCritical: c.hasRunScript })
}
function recordRuntimeStart(c, rm, v, state) {
  if (!v.valid) return c.record({ id: "runtime:start", status: "failed", required: c.isFullish, detail: `runtime manifest INVÁLIDO: ${v.errors[0]}` })
  const ready = state.filter((s) => s.status === "ready")
  if (ready.length) return c.record({ id: "runtime:start", status: "passed", detail: `${ready.length}/${rm.services.length} serviço(s) ready (dev rodou)` })
  c.record({ id: "runtime:start", status: "advisory", productCritical: false, detail: `runtime válido (${rm.services.length} serviço(s)) — rode \`gstack_vibehard dev\`` })
}
function recordPreview(c, state) {
  const web = state.find((s) => s.url)
  if (web) c.record({ id: "preview:open", status: "passed", detail: web.url })
  else c.record({ id: "preview:open", status: "advisory", detail: "preview chega com `gstack_vibehard dev --open`" })
}
function gateRuntime(c) {
  const rm = loadRuntimeManifest(c.cwd)
  if (!rm) return runtimePending(c)
  const state = safeReadAllState(c.cwd)
  recordRuntimeStart(c, rm, validateRuntimeManifest(rm), state)
  recordPreview(c, state)
}

function runGates(c) {
  gateDeps(c)
  gateLint(c)
  gateTypecheck(c)
  gateTest(c)
  gateBuild(c)
  c.qgRun = gateQg(c)
  if (c.isLibCli) gateLibCli(c)
  else gateRuntime(c)
}

// Timeout tem sinal PRÓPRIO (PRD20 20.1): distinto de `blocked` — o gate não falhou,
// estourou o tempo (filhos encerrados). QG-drift ≠ ready silencioso.
function pickStatus({ timedOut, failed, productPending, toolMissing, drift }) {
  if (timedOut.length) return "timed_out"
  if (failed.length) return "blocked"
  if (productPending) return "pending_product"
  if (toolMissing.length) return "ready_with_warnings"
  if (drift) return "ready_with_warnings"
  return "ready"
}
function resolveVerifyStatus(steps, qg) {
  const failed = steps.filter((s) => s.status === "failed").map((s) => s.id)
  const timedOut = steps.filter((s) => s.status === "timed_out").map((s) => s.id)
  const toolMissing = steps.filter((s) => s.status === "tool_missing").map((s) => s.id)
  const productPending = steps.some((s) => s.status === "pending_feature" && s.productCritical)
  const status = pickStatus({ timedOut, failed, productPending, toolMissing, drift: qg.drift })
  return { status, failed, timedOut, toolMissing }
}
function finalizeVerify(c) {
  const qg = c.qgRun ? qgMeta(c.qgRun) : { origin: "none", path: null, drift: false }
  const { status, failed, timedOut, toolMissing } = resolveVerifyStatus(c.steps, qg)
  // `ready` é ESTRITO (tudo aplicável passou, sem tool_missing); `usable` = sem blockers.
  const ready = status === "ready"
  const result = {
    profile: c.profile, archetype: c.archetype, status, ready,
    usable: ready || status === "ready_with_warnings",
    reducedTrust: c.opts.harness ? !isStrongTrust(c.opts.harness) : false,
    qg, qgDrift: qg.drift, harness: c.opts.harness || null,
    steps: c.steps, failed, timedOut, toolMissing,
  }
  if (c.isQuick) writeVerifyCache(c.cwd, { profile: "quick", fingerprint: c.fingerprint, result, savedAt: new Date().toISOString() })
  return result
}

export function runVerify(opts = {}) {
  const c = buildVerifyCtx(opts)
  const cached = checkQuickCache(c)
  if (cached) return cached
  if (opts.dryRun) return buildDryRun(c)
  Object.assign(c, makeRunners(c))
  runGates(c)
  return finalizeVerify(c)
}
