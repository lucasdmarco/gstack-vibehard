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

  const run = (id, file, args, { required = false } = {}) => {
    try { exec(file, args, { cwd }); steps.push({ id, status: "passed", required }) }
    catch (e) { steps.push({ id, status: "failed", required, detail: (e.message || "falhou").split("\n")[0].slice(0, 160) }) }
  }
  const na = (id, detail, required = false) => steps.push({ id, status: "not_applicable", required, detail })

  // 1. deps — quick: checagem FILESYSTEM (instantânea, sem spawnar npm que é lento
  //    no Windows); full/release: install obrigatório.
  if (isQuick) {
    if (!hasPkg) na("deps", "sem package.json")
    else {
      const pkg = readJson(pkgPath)
      const declared = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
      const missing = declared.filter((d) => !existsSync(join(cwd, "node_modules", d)))
      if (missing.length === 0) steps.push({ id: "deps", status: "passed", detail: "node_modules ok (check rápido)" })
      else steps.push({ id: "deps", status: "failed", detail: `deps ausentes: ${missing.slice(0, 5).join(", ")} — rode npm install` })
    }
  }
  else if (isFullish) { hasPkg ? run("deps", "npm", ["install"], { required: true }) : na("deps", "sem package.json") }
  // 2. lint (sempre, se houver)
  scripts.lint ? run("lint", "npm", ["run", "lint"]) : na("lint", "sem script lint")
  // 3. typecheck (full/release)
  if (isFullish) { scripts.typecheck ? run("typecheck", "npm", ["run", "typecheck"]) : na("typecheck", "sem script typecheck") }
  // 4. testes — pulados no quick (parte lenta); obrigatórios nos demais quando existem.
  if (isQuick) { na("test", "pulado no --quick (use --profile full p/ a suíte)") }
  else if (scripts.test) run("test", "npm", ["test"], { required: true })
  else if (hasPyTests) run("test", pyBin, ["-m", "pytest", "-q"], { required: true })
  else na("test", "sem suíte de testes")
  // 5. build (full/release; obrigatório quando existe)
  if (isFullish) { scripts.build ? run("build", "npm", ["run", "build"], { required: true }) : na("build", "sem script build") }
  // 6. Quality Gate — quick: só L1 (rápido, binário local). full/release: L1+L2.
  //    release roda o qg EMPACOTADO (consistência garantida); demais usam o instalado.
  const qgRun = isRelease && existsSync(PKG_QG) ? PKG_QG : qgHook
  if (qgRun) {
    if (isQuick) {
      // quick: QG L1 com timeout CURTO e ADVISORY — garante feedback rápido (< 30s)
      // e nunca trava o smoke num Fallow lento/sujo. O gate bloqueante é o --profile full.
      try { exec(pyBin, [qgRun, "--path", ".", "--level", "1", "--timeout", "15"], { cwd }); steps.push({ id: "qg-l1", status: "passed" }) }
      catch { steps.push({ id: "qg-l1", status: "advisory", detail: "advisory no quick (rode `verify` p/ o gate bloqueante)" }) }
    } else {
      const strict = isRelease ? ["--strict"] : []
      run("qg-l1", pyBin, [qgRun, "--path", ".", "--level", "1", ...strict], { required: true })
      run("qg-l2", pyBin, [qgRun, "--path", ".", "--level", "2", ...strict], { required: true })
    }
  } else {
    steps.push({ id: "qg", status: "tool_missing", required: false, detail: "Fallow/QG não instalado" })
  }
  const qg = qgRun ? qgMeta(qgRun) : { origin: "none", path: null, drift: false }
  // 7. Gates por arquétipo (lib/CLI) — ADVISORY: reportam, nunca bloqueiam o verify
  //    (filosofia observe-only). publish-guard e diff-hygiene são determinísticos.
  if (isLibCli) {
    try {
      const pg = publishGuard({ cwd, exec, checkCi: false })
      // release: publish-guard é BLOQUEANTE; demais perfis: advisory (observe-only).
      const okStatus = pg.status === "pass" ? "passed" : isRelease ? "failed" : "advisory"
      steps.push({ id: "publish-guard", status: okStatus, required: isRelease, detail: pg.status === "pass" ? "pronto p/ publicar" : `pendências: ${pg.failed.join(", ")}` })
    } catch { steps.push({ id: "publish-guard", status: "advisory", detail: "guard indisponível" }) }
    try {
      const dh = diffHygiene({ cwd, exec })
      steps.push({ id: "diff-hygiene", status: dh.findings.length === 0 ? "passed" : "advisory", detail: dh.findings.length ? `${dh.findings.length} achado(s), ${dh.high} HIGH` : "limpo" })
    } catch { steps.push({ id: "diff-hygiene", status: "advisory", detail: "hygiene indisponível" }) }
  }

  // 8. runtime/preview — não se aplica a lib/CLI; para app/web fica pending_feature
  //    (roadmap). productCritical quando o projeto precisa rodar.
  if (isLibCli) {
    na("runtime:start", "não se aplica a lib/CLI")
    na("preview:open", "não se aplica a lib/CLI")
  } else {
    steps.push({ id: "runtime:start", status: "pending_feature", productCritical: hasRunScript })
    steps.push({ id: "preview:open", status: "pending_feature", productCritical: hasRunScript })
  }

  // Qualquer gate que FALHOU bloqueia "ready" (lint quebrado não é "pronto").
  const failed = steps.filter((s) => s.status === "failed").map((s) => s.id)
  const toolMissing = steps.filter((s) => s.status === "tool_missing").map((s) => s.id)
  const productPending = steps.some((s) => s.status === "pending_feature" && s.productCritical)

  let status
  if (failed.length) status = "blocked"
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

  const result = { profile, archetype, status, ready, usable, reducedTrust, qg, qgDrift: qg.drift, harness: opts.harness || null, steps, failed, toolMissing }
  if (isQuick) writeVerifyCache(cwd, { profile: "quick", fingerprint, result, savedAt: new Date().toISOString() })
  return result
}
