import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execFileSync } from "child_process"
import { stripBom } from "../util/json.js"

/**
 * Tool Readiness como PRODUTO (PRD20 20.3): mede o estado REAL de cada ferramenta
 * local (Fallow/Graphify/Headroom/context) — não um arquivo mantido à mão. PURO e
 * injetável (`probe`/`git`/`now`): sem side-effect, sem escrever nada por padrão.
 *
 * HONESTIDADE dos status (PRD20 §I0): Headroom sem proxy é `callable_not_routed`,
 * NUNCA `routed` — só vira `routed` se o doctor confirmar proxy rodando E tráfego
 * roteado. Graphify declara `fresh`/`stale`/`unknown` comparando `built_at_commit`
 * do grafo com o `git rev-parse HEAD`. Nunca lê `.env*` nem toca config global.
 */

export const STATUS_DESCRIPTIONS = Object.freeze({
  missing: "Tool is not installed or cannot be found.",
  installed_not_callable: "Files appear to exist, but the command failed from this project.",
  callable: "The command was verified from this project and can be called manually by agents.",
  callable_not_routed: "The command works, but no harness traffic is routed through it automatically.",
  routed: "Harness traffic is verified to pass through the tool.",
})

const GUARDRAILS = Object.freeze({
  projectScopedOnly: true,
  globalHarnessConfigTouched: false,
  globalMcpRegistered: false,
  headroomWrapApplied: false,
  envFilesTouched: false,
  secretFilesAllowed: false,
})

const SUMMARY_MAX = 300
const trunc = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX)
// Windows: os shims npm/npx são `.cmd` (execFileSync não resolve PATHEXT sozinho).
const npmBin = () => (process.platform === "win32" ? "npm.cmd" : "npm")
const npxBin = () => (process.platform === "win32" ? "npx.cmd" : "npx")

// Probe padrão: roda o comando, captura stdout/stderr resumidos e NUNCA lança.
// Node ≥20 recusa spawnar `.cmd`/`.bat` sem shell (CVE-2024-27980) — args são
// literais fixos (npx/npm), então shell:true aqui é seguro e não injeta input.
function defaultProbe(file, args, opts = {}) {
  const shell = /\.(cmd|bat)$/i.test(file)
  try {
    const stdout = execFileSync(file, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 15000, encoding: "utf-8", shell, ...opts })
    return { ok: true, code: 0, stdout: trunc(stdout), stderr: "" }
  } catch (e) {
    return { ok: false, code: typeof e.status === "number" ? e.status : null, stdout: trunc(e.stdout), stderr: trunc(e.stderr || e.message) }
  }
}

function gitHead(cwd, probe) {
  const r = probe("git", ["rev-parse", "HEAD"], { cwd })
  return r.ok ? r.stdout.trim() : null
}

const pickVersion = (res) => (res.ok ? res.stdout : null)
function pythonProbe(probe) {
  const p3 = probe("python3", ["--version"])
  return p3.ok ? p3 : probe("python", ["--version"])
}
function pathSummary() {
  const raw = process.env.PATH || process.env.Path || ""
  const parts = raw.split(process.platform === "win32" ? ";" : ":").filter(Boolean)
  return { entries: parts.length, head: parts.slice(0, 5) }
}
function readEnv(probe) {
  return {
    os: `${process.platform} ${process.arch}`,
    node: pickVersion(probe("node", ["--version"])),
    npm: pickVersion(probe(npmBin(), ["--version"])),
    python: pickVersion(pythonProbe(probe)),
    pathSummary: pathSummary(),
  }
}

// classifica um probe simples (sem noção de routing): callable / not_callable / missing.
const classifyProbe = (res, filesExist) => (res.ok ? "callable" : filesExist ? "installed_not_callable" : "missing")
function toolEntry({ status, scope, purpose, command, res, extra }) {
  return {
    status, scope, purpose,
    validatedCommand: command,
    exitCode: res.code,
    stdout: res.stdout,
    stderr: res.stderr,
    ...(extra || {}),
  }
}

function probeFallow(probe) {
  const res = probe(npxBin(), ["fallow", "--version"])
  return toolEntry({ status: classifyProbe(res, false), scope: "project", purpose: "deterministic_quality_gate", command: "npx fallow --version", res })
}

function readBuiltAtCommit(graphPath) {
  try { return JSON.parse(stripBom(readFileSync(graphPath, "utf-8"))).built_at_commit || null }
  catch { return null }
}
const unknownFreshness = (builtAt, head) => ({ state: "unknown", builtAtCommit: builtAt || null, head: head || null })
function graphFreshness(cwd, head) {
  const graphPath = join(cwd, "graphify-out", "graph.json")
  if (!existsSync(graphPath)) return { state: "absent" }
  const builtAt = readBuiltAtCommit(graphPath)
  if (!builtAt || !head) return unknownFreshness(builtAt, head)
  return { state: builtAt === head ? "fresh" : "stale", builtAtCommit: builtAt, head }
}
function probeGraphify(probe, cwd, head) {
  const res = probe("graphify", ["--version"])
  return toolEntry({
    status: classifyProbe(res, false), scope: "path", purpose: "code_topology",
    command: "graphify --version", res, extra: { freshness: graphFreshness(cwd, head) },
  })
}

function headroomExe(cwd) {
  const rel = process.platform === "win32" ? ["Scripts", "headroom.exe"] : ["bin", "headroom"]
  return join(cwd, ".gstack", "tools", "headroom-venv", ...rel)
}
// Só "routed" se o doctor confirmar proxy rodando E tráfego roteado (nunca assume).
function headroomRouted(probe, exe) {
  const doc = probe(exe, ["doctor"])
  if (!doc.ok) return false
  const out = doc.stdout.toLowerCase()
  return out.includes("proxy running") && out.includes("routed")
}
function probeHeadroom(probe, cwd) {
  const exe = headroomExe(cwd)
  if (!existsSync(exe)) {
    return toolEntry({ status: "missing", scope: "project", purpose: "token_proxy", command: `${exe} --version`, res: { code: null, stdout: "", stderr: "não instalado" } })
  }
  const ver = probe(exe, ["--version"])
  if (!ver.ok) {
    return toolEntry({ status: "installed_not_callable", scope: "project", purpose: "token_proxy", command: `${exe} --version`, res: ver })
  }
  const routed = headroomRouted(probe, exe)
  return toolEntry({
    status: routed ? "routed" : "callable_not_routed", scope: "project", purpose: "token_proxy",
    command: `${exe} doctor`, res: ver, extra: { routed },
  })
}

function probeContext(cwd) {
  const dbPath = join(cwd, ".gstack", "context", "context.db")
  const exists = existsSync(dbPath)
  return {
    status: exists ? "callable" : "installed_not_callable",
    scope: "project", purpose: "offline_doc_search",
    validatedCommand: "node src/index.js context status --json",
    exitCode: null, stdout: "", stderr: "",
    artifact: exists ? dbPath : null,
  }
}

const harnessInfo = (present, file) => ({ present, instructionFile: file, enforcement: "instructional" })
function harnessDiscovery(cwd, home) {
  return {
    codex: harnessInfo(existsSync(join(cwd, "AGENTS.md")), "AGENTS.md"),
    claude: harnessInfo(existsSync(join(cwd, "CLAUDE.md")), "CLAUDE.md"),
    opencode: harnessInfo(existsSync(join(home, ".config", "opencode")), ".config/opencode"),
  }
}

/**
 * Constrói o relatório de readiness (READ-ONLY). `probe`/`git`/`now` injetáveis.
 * `--clean-machine` só marca o modo no relatório — a medição continua honesta.
 */
export function buildReadiness(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const home = opts.home || homedir()
  const probe = opts.probe || defaultProbe
  const now = opts.now || (() => new Date().toISOString())
  const head = (opts.git || (() => gitHead(cwd, probe)))()
  return {
    schemaVersion: 2,
    generatedAt: now(),
    cleanMachine: opts.cleanMachine === true,
    guardrails: GUARDRAILS,
    statuses: STATUS_DESCRIPTIONS,
    env: readEnv(probe),
    tools: {
      fallow: probeFallow(probe),
      graphify: probeGraphify(probe, cwd, head),
      gstackContext: probeContext(cwd),
      headroom: probeHeadroom(probe, cwd),
    },
    harnessDiscovery: harnessDiscovery(cwd, home),
  }
}
