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
function projectFingerprint(cwd) {
  const h = createHash("sha256")
  try { h.update(readFileSync(join(cwd, "package.json"))) } catch { /* sem pkg */ }
  const walk = (dir, depth = 0) => {
    if (depth > 8) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else { try { const s = statSync(p); h.update(`${p}:${s.size}:${Math.round(s.mtimeMs)}`) } catch { /* skip */ } }
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
const STEP_TIMEOUT_MS = { deps: 300000, test: 300000, build: 300000, "qg-l1": 120000, "qg-l2": 180000 }
function stepTimeout(id) { return STEP_TIMEOUT_MS[id] || 60000 }

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

export function runVerify(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const home = opts.home || homedir()
  const VALID_PROFILES = ["quick", "scaffold", "full", "release"]
  const profile = VALID_PROFILES.includes(opts.profile) ? opts.profile : "full"
  const isQuick = profile === "quick"
  const isFullish = profile === "full" || profile === "release"
  const isRelease = profile === "release"
  const exec = opts.exec || defaultExec
  const pyBin = process.platform === "win32" ? "python" : "python3"

  // Cache do --quick (P0.2): sem mudanças desde a última run → cache_hit rápido.
  const fingerprint = isQuick ? projectFingerprint(cwd) : null
  if (isQuick && opts.noCache !== true) {
    const cached = readVerifyCache(cwd)
    if (cached && cached.profile === "quick" && cached.fingerprint === fingerprint && cached.result) {
      const r = cached.result
      return { ...r, cached: true, steps: r.steps.map((s) => ({ ...s, status: "cache_hit", was: s.status })) }
    }
  }

  const pkgPath = join(cwd, "package.json")
  const hasPkg = existsSync(pkgPath)
  const scripts = (hasPkg ? readJson(pkgPath).scripts : {}) || {}
  const hasPyTests = ["pytest.ini", "pyproject.toml", "requirements.txt"].some((f) => existsSync(join(cwd, f)))
  const hasRunScript = !!(scripts.start || scripts.dev) // projeto que "roda" (app/web)
  const qgHook = findQgHook(home)
  const { profile: archetype } = detectProfile(cwd)
  const isLibCli = archetype === "library" || archetype === "cli"
  const steps = []

  // Package manager REAL do projeto (movido p/ cima: dry-run e o plano precisam dele).
  const pm = resolvePm(cwd, hasPkg, pkgPath)
  // `--dry-run`: lista os comandos do profile SEM executar nada (PRD20 20.1).
  if (opts.dryRun) {
    const qgAvailable = !!(isRelease && existsSync(PKG_QG)) || !!qgHook
    return { profile, dryRun: true, plan: planVerifySteps({ profile, scripts, hasPyTests, hasPkg, qgAvailable, isRelease, pm, pyBin }) }
  }

  // Progresso incremental (PRD20 20.1): cada etapa é emitida ao sink (arquivo).
  const stepExec = opts.stepExec || makeStepExec(opts.exec, cwd)
  const onStep = typeof opts.onStep === "function" ? opts.onStep : null
  const record = (step) => { steps.push(step); if (onStep) { try { onStep(step) } catch { /* sink best-effort */ } } }

  const run = (id, file, args, { required = false } = {}) => {
    const r = stepExec(file, args, { timeoutMs: stepTimeout(id) })
    const command = `${file} ${(args || []).join(" ")}`.trim()
    record(buildCmdStep(id, r, required, command))
  }
  const na = (id, detail, required = false) => record({ id, status: "not_applicable", required, detail })

  // Exec do PM cross-platform: no Windows o binário é `pm.cmd` → cmd.exe /c (senão ENOENT).
  const runPm = (id, args, o) => {
    if (process.platform === "win32") run(id, process.env.ComSpec || "cmd.exe", ["/c", pm, ...args], o)
    else run(id, pm, args, o)
  }

  // 1. deps — quick: checagem FILESYSTEM (instantânea); full/release: install obrigatório.
  const depsQuick = () => {
    if (!hasPkg) return na("deps", "sem package.json")
    const pkg = readJson(pkgPath)
    const declared = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
    const missing = declared.filter((d) => !existsSync(join(cwd, "node_modules", d)))
    if (missing.length === 0) return record({ id: "deps", status: "passed", detail: "node_modules ok (check rápido)" })
    record({ id: "deps", status: "failed", detail: `deps ausentes: ${missing.slice(0, 5).join(", ")} — rode ${pm} install` })
  }
  if (isQuick) depsQuick()
  else if (isFullish) { hasPkg ? runPm("deps", ["install"], { required: true }) : na("deps", "sem package.json") }
  // 2. lint (sempre, se houver)
  scripts.lint ? runPm("lint", ["run", "lint"]) : na("lint", "sem script lint")
  // 3. typecheck (full/release)
  if (isFullish) { scripts.typecheck ? runPm("typecheck", ["run", "typecheck"]) : na("typecheck", "sem script typecheck") }
  // 4. testes — pulados no quick (parte lenta); obrigatórios nos demais quando existem.
  if (isQuick) { na("test", "pulado no --quick (use --profile full p/ a suíte)") }
  else if (scripts.test) runPm("test", ["test"], { required: true })
  else if (hasPyTests) run("test", pyBin, ["-m", "pytest", "-q"], { required: true })
  else na("test", "sem suíte de testes")
  // 5. build (full/release; obrigatório quando existe)
  if (isFullish) { scripts.build ? runPm("build", ["run", "build"], { required: true }) : na("build", "sem script build") }
  // 6. Quality Gate — quick: L1 advisory; full/release: L1+L2 bloqueantes (release usa o EMPACOTADO).
  const qgRun = isRelease && existsSync(PKG_QG) ? PKG_QG : qgHook
  const qgQuick = () => {
    // quick: L1 com timeout CURTO e ADVISORY — feedback < 30s sem travar num Fallow lento.
    try { exec(pyBin, [qgRun, "--path", ".", "--level", "1", "--timeout", "15"], { cwd }); record({ id: "qg-l1", status: "passed" }) }
    catch { record({ id: "qg-l1", status: "advisory", detail: "advisory no quick (rode `verify` p/ o gate bloqueante)" }) }
  }
  const qgFull = () => {
    const strict = isRelease ? ["--strict"] : []
    run("qg-l1", pyBin, [qgRun, "--path", ".", "--level", "1", ...strict], { required: true })
    run("qg-l2", pyBin, [qgRun, "--path", ".", "--level", "2", ...strict], { required: true })
  }
  const qgGate = () => {
    if (!qgRun) {
      // Fail-closed no release (claim de QG REAL não pode ser opcional); demais: tool_missing.
      if (isRelease) return record({ id: "qg", status: "failed", required: true, detail: "Fallow/QG obrigatório no --profile release e não está instalado" })
      return record({ id: "qg", status: "tool_missing", required: false, detail: "Fallow/QG não instalado" })
    }
    isQuick ? qgQuick() : qgFull()
  }
  qgGate()
  const qg = qgRun ? qgMeta(qgRun) : { origin: "none", path: null, drift: false }
  // 7. Gates por arquétipo (lib/CLI) — ADVISORY: reportam, nunca bloqueiam o verify
  //    (filosofia observe-only). publish-guard e diff-hygiene são determinísticos.
  if (isLibCli) {
    try {
      const pg = publishGuard({ cwd, exec, checkCi: false })
      // release: publish-guard é BLOQUEANTE; demais perfis: advisory (observe-only).
      const okStatus = pg.status === "pass" ? "passed" : isRelease ? "failed" : "advisory"
      record({ id: "publish-guard", status: okStatus, required: isRelease, detail: pg.status === "pass" ? "pronto p/ publicar" : `pendências: ${pg.failed.join(", ")}` })
    } catch { record({ id: "publish-guard", status: "advisory", detail: "guard indisponível" }) }
    try {
      const dh = diffHygiene({ cwd, exec })
      record({ id: "diff-hygiene", status: dh.findings.length === 0 ? "passed" : "advisory", detail: dh.findings.length ? `${dh.findings.length} achado(s), ${dh.high} HIGH` : "limpo" })
    } catch { record({ id: "diff-hygiene", status: "advisory", detail: "hygiene indisponível" }) }
  }

  // 8. runtime/preview — verify CONHECE o runtime entregue (PR5): valida o Runtime
  //    Manifest V2 e reporta o estado real dos serviços (.gstack/runtime/). Sem
  //    runtime declarado, preserva o pending_product (o projeto roda mas o gstack não verifica).
  if (isLibCli) {
    na("runtime:start", "não se aplica a lib/CLI")
    na("preview:open", "não se aplica a lib/CLI")
  } else {
    const rm = loadRuntimeManifest(cwd)
    if (!rm) {
      record({ id: "runtime:start", status: "pending_feature", productCritical: hasRunScript, detail: "sem .gstack/runtime.json — `gstack_vibehard create` declara o runtime" })
      record({ id: "preview:open", status: "pending_feature", productCritical: hasRunScript })
    } else {
      const v = validateRuntimeManifest(rm)
      const state = (() => { try { return readAllState(cwd) } catch { return [] } })()
      const ready = state.filter((s) => s.status === "ready")
      if (!v.valid) {
        record({ id: "runtime:start", status: "failed", required: isFullish, detail: `runtime manifest INVÁLIDO: ${v.errors[0]}` })
      } else if (ready.length) {
        record({ id: "runtime:start", status: "passed", detail: `${ready.length}/${rm.services.length} serviço(s) ready (dev rodou)` })
      } else {
        record({ id: "runtime:start", status: "advisory", productCritical: false, detail: `runtime válido (${rm.services.length} serviço(s)) — rode \`gstack_vibehard dev\`` })
      }
      const web = state.find((s) => s.url)
      if (web) record({ id: "preview:open", status: "passed", detail: web.url })
      else record({ id: "preview:open", status: "advisory", detail: "preview chega com `gstack_vibehard dev --open`" })
    }
  }

  // Qualquer gate que FALHOU bloqueia "ready" (lint quebrado não é "pronto").
  const failed = steps.filter((s) => s.status === "failed").map((s) => s.id)
  const timedOut = steps.filter((s) => s.status === "timed_out").map((s) => s.id)
  const toolMissing = steps.filter((s) => s.status === "tool_missing").map((s) => s.id)
  const productPending = steps.some((s) => s.status === "pending_feature" && s.productCritical)

  // Timeout tem sinal PRÓPRIO (PRD20 20.1): distinto de `blocked` — o gate não
  // falhou, estourou o tempo (e os filhos foram encerrados). DX/CI precisam saber.
  let status
  if (timedOut.length) status = "timed_out"
  else if (failed.length) status = "blocked"
  else if (productPending) status = "pending_product"
  else if (toolMissing.length) status = "ready_with_warnings"
  else if (qg.drift) status = "ready_with_warnings" // QG instalado ≠ empacotado: não é ready silencioso
  else status = "ready"

  const reducedTrust = opts.harness ? !isStrongTrust(opts.harness) : false
  // `ready` é ESTRITO: só true quando TUDO aplicável passou (sem tool_missing).
  // Consumidor automático que olha só `ready` não libera sem ferramenta de confiança.
  // `usable` = sem blockers (mas pode faltar gate de confiança / haver avisos).
  const ready = status === "ready"
  const usable = ready || status === "ready_with_warnings"

  const result = { profile, archetype, status, ready, usable, reducedTrust, qg, qgDrift: qg.drift, harness: opts.harness || null, steps, failed, timedOut, toolMissing }
  if (isQuick) writeVerifyCache(cwd, { profile: "quick", fingerprint, result, savedAt: new Date().toISOString() })
  return result
}
