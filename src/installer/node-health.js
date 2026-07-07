import { execFileSync } from "child_process"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { npmArgv } from "./deps.js"

/**
 * Node/npm/npx health gate (PRD28 Sprint 28.0 / §11.6).
 *
 * "Node instalado" NÃO significa "npm saudável": o transcript real mostrou npm
 * operando no diretório errado e shim npm.ps1 bloqueável por ExecutionPolicy.
 * Este módulo prova o trio node/npm/npx de ponta a ponta com um smoke test
 * CONTROLADO em diretório temporário — NUNCA cria package.json no home do usuário,
 * nunca instala dependência remota, timeout curto, cleanup garantido.
 *
 * PURO/testável: exec/fs injetáveis. Registry é informativo (degraded), não gate.
 */

const MIN_NODE_MAJOR = 18 // package.json engines: node >=18

function defaultDeps() {
  return {
    exec: (file, args, opts = {}) => execFileSync(file, args, { encoding: "utf-8", stdio: "pipe", timeout: 10000, ...opts }),
    platform: process.platform,
    mkdtemp: () => mkdtempSync(join(tmpdir(), "gstack-npm-smoke-")),
    write: (p, c) => writeFileSync(p, c),
    cleanup: (dir) => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } },
  }
}

// Sonda `--version` de um binário via runner cross-platform. ok=false com motivo.
function probeArgv(tool, platform) {
  if (tool.viaNpmShim) return npmShimArgv(tool.bin, platform)
  return { file: tool.bin, argv: ["--version"] }
}
function probeFailDetail(e) {
  if (e && e.code === "ETIMEDOUT") return "timeout"
  return (e && e.code) || "não executável"
}
function probeVersion(deps, tool) {
  const { file, argv } = probeArgv(tool, deps.platform)
  try {
    const out = String(deps.exec(file, argv)).trim()
    return { ok: true, version: out.split("\n").pop().trim() }
  } catch (e) {
    return { ok: false, version: null, detail: probeFailDetail(e) }
  }
}
// npm/npx no Windows são .cmd — via cmd.exe (evita ENOENT e o bloqueio do .ps1).
function npmShimArgv(bin, platform) {
  const base = npmArgv(["--version"], platform)
  if (platform === "win32") return { file: base.file, argv: ["/c", bin, "--version"] }
  return { file: bin, argv: ["--version"] }
}

function checkNodeVersion(nodeProbe) {
  if (!nodeProbe.ok) return { ok: false, detail: `node não executável (${nodeProbe.detail})` }
  const major = parseInt(String(nodeProbe.version).replace(/^v/, ""), 10)
  if (!Number.isInteger(major)) return { ok: false, detail: `versão ilegível: ${nodeProbe.version}` }
  if (major < MIN_NODE_MAJOR) return { ok: false, detail: `node ${nodeProbe.version} < mínimo v${MIN_NODE_MAJOR}` }
  return { ok: true, detail: null }
}

/**
 * Smoke test do npm em TEMPDIR controlado: package.json mínimo descartável +
 * `npm pkg get name` (local, sem rede, barato). Prova que o npm consegue OPERAR
 * dentro de um projeto — a falha do mundo real que `--version` não pega.
 */
function smokeFailDetail(e) {
  if (e && e.code === "ETIMEDOUT") return "npm pendurado (timeout)"
  return `npm falhou: ${(e && e.code) || e.message}`
}
function runSmokeIn(dir, deps) {
  deps.write(join(dir, "package.json"), JSON.stringify({ name: "gstack-smoke", version: "0.0.0", private: true }))
  const { file, argv } = npmArgv(["pkg", "get", "name"], deps.platform)
  const out = String(deps.exec(file, argv, { cwd: dir, timeout: 15000 }))
  if (out.includes("gstack-smoke")) return { ok: true, detail: "npm opera em projeto (tempdir)" }
  return { ok: false, detail: `saída inesperada: ${out.slice(0, 60)}` }
}
function npmSmoke(deps) {
  let dir = null
  try { dir = deps.mkdtemp(); return runSmokeIn(dir, deps) }
  catch (e) { return { ok: false, detail: smokeFailDetail(e) } }
  finally { if (dir) deps.cleanup(dir) }
}

// Registry é informativo: falha = degraded (rede), NUNCA blocker de ambiente.
function registryStatus(deps) {
  try {
    const { file, argv } = npmArgv(["config", "get", "registry"], deps.platform)
    const out = String(deps.exec(file, argv, { timeout: 8000 })).trim()
    return out.startsWith("http") ? { status: "configured", registry: out } : { status: "degraded", registry: out || null }
  } catch { return { status: "degraded", registry: null } }
}

// Blockers como TABELA when→msg (cc baixa, ordem preservada).
const BLOCKER_RULES = [
  { when: (c) => !c.node.ok || !c.nodeVersion.ok, msg: (c) => `Node: ${c.nodeVersion.detail || c.node.detail}` },
  { when: (c) => !c.npm.ok, msg: (c) => `npm: ${c.npm.detail} (mesmo com node OK, npm pode estar quebrado)` },
  { when: (c) => c.npm.ok && !c.smoke.ok, msg: (c) => `npm smoke: ${c.smoke.detail}` },
  { when: (c) => !c.npx.ok, msg: (c) => `npx: ${c.npx.detail} (bloqueia Fallow/skills que dependem de npx)` },
]
function collectBlockers(ctx) {
  return BLOCKER_RULES.filter((r) => r.when(ctx)).map((r) => r.msg(ctx))
}

/**
 * Health completo: node/npm/npx --version + smoke controlado + registry.
 * `ok:false` = ambiente NÃO está pronto para criar/rodar projeto (gate honesto).
 */
export function checkNodeHealth(overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const node = probeVersion(deps, { bin: "node" })
  const nodeVersion = checkNodeVersion(node)
  const npm = probeVersion(deps, { bin: "npm", viaNpmShim: true })
  const npx = probeVersion(deps, { bin: "npx", viaNpmShim: true })
  // smoke só faz sentido com npm callable; sem npm o blocker já explica.
  const smoke = npm.ok ? npmSmoke(deps) : { ok: false, detail: "pulado (npm não executável)" }
  const registry = registryStatus(deps)
  const blockers = collectBlockers({ node, nodeVersion, npm, npx, smoke })
  return {
    schemaVersion: "gstack.node-health.v1",
    ok: blockers.length === 0,
    node: { ...node, minMajor: MIN_NODE_MAJOR, versionOk: nodeVersion.ok },
    npm, npx, smoke, registry,
    windowsShim: deps.platform === "win32" ? "npm.cmd via cmd.exe (npm.ps1 pode ser bloqueado por ExecutionPolicy)" : null,
    blockers,
  }
}

/**
 * Probe LEVE para o preflight do install (sem smoke — o smoke completo vive no
 * `doctor node`): só prova que npm/npx respondem `--version` via shim correto.
 * Barato o bastante para rodar em `install --audit-only` sem latência perceptível.
 */
export function probeNpmNpx(overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  return {
    npmOk: probeVersion(deps, { bin: "npm", viaNpmShim: true }).ok,
    npxOk: probeVersion(deps, { bin: "npx", viaNpmShim: true }).ok,
  }
}

// Render humano em 3 blocos (probes, ambiente, blockers) — cc baixa por bloco.
function renderProbes(h, log) {
  const line = (label, p) => (p.ok ? log.success(`${label}: OK ${p.version}`) : log.error(`${label}: FALHOU — ${p.detail}`))
  line("Node.js", { ...h.node, ok: h.node.ok && h.node.versionOk, detail: h.node.detail || `mínimo v${h.node.minMajor}` })
  line("npm", h.npm)
  line("npx", h.npx)
}
function renderEnvironment(h, log) {
  const smokeLog = h.smoke.ok ? log.success : log.warn
  smokeLog(`Package manager smoke: ${h.smoke.ok ? "OK" : h.smoke.detail}`)
  log.info(`Registry: ${h.registry.status}${h.registry.registry ? ` (${h.registry.registry})` : ""}`)
  if (h.windowsShim) log.info(`PowerShell npm shim: ${h.windowsShim}`)
}
function renderBlockers(h, log) {
  if (h.ok) return
  log.error("Ambiente NÃO está pronto para criar/rodar projeto:")
  h.blockers.forEach((b) => log.error(`  ✗ ${b}`))
  log.info("  Ação: repare o Node/npm e rode `gstack_vibehard doctor node` de novo.")
}
/** Render humano (para `doctor node` e preflight). logger = {success,warn,error,info}. */
export function renderNodeHealth(h, log) {
  renderProbes(h, log)
  renderEnvironment(h, log)
  renderBlockers(h, log)
}
