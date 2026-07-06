import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { stripBom } from "../util/json.js"
import { buildMcpInventory } from "../mcp/inventory.js"
import { readRuntimeMcp, summarizeScopes } from "../mcp/scope.js"
import { readClaudeMcp } from "../mcp/readers/claude.js"
import { readCodexMcp } from "../mcp/readers/codex.js"
import { readOpenCodeMcp } from "../mcp/readers/opencode.js"
import { readProjectMcp } from "../mcp/readers/project.js"

// Readers do inventário + o run context do GStack (runtime-injected).
const mcpReaders = () => [readClaudeMcp, readCodexMcp, readOpenCodeMcp, readProjectMcp, readRuntimeMcp]

const INDEXER = join(dirname(fileURLToPath(import.meta.url)), "..", "context-docs", "py", "context_db.py")

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
  timeout_degraded: "The probe timed out twice — the tool may be installed but slow/cold; NOT the same as missing. Retry or run the tool directly.",
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
// Node ≥20 recusa spawnar `.cmd`/`.bat` sem shell (CVE-2024-27980). E shell:true
// COM array de args emite DEP0190 (concatenação sem escape) — então, quando o
// shell é necessário, montamos a string EXPLÍCITA com quoting. Args são literais
// fixos do produto (nunca input do usuário) — sem superfície de injeção.
const quoteArg = (a) => (/[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '""')}"` : String(a))
const shellCommand = (file, args) => [quoteArg(file), ...(args || []).map(quoteArg)].join(" ")
// Timeout é sinal DIFERENTE de ausência (PRD26 26.B): npx frio no Windows pode
// estourar 15s com a ferramenta INSTALADA. `timedOut` viaja no resultado e o
// chamador re-tenta uma vez antes de classificar.
const isTimeoutErr = (e) => e.code === "ETIMEDOUT" || e.killed === true || /ETIMEDOUT/i.test(String(e.message || ""))
function defaultProbe(file, args, opts = {}) {
  const shell = /\.(cmd|bat)$/i.test(file)
  const common = { stdio: ["ignore", "pipe", "pipe"], timeout: 15000, encoding: "utf-8", ...opts }
  try {
    const stdout = shell
      ? execFileSync(shellCommand(file, args), { ...common, shell: true })
      : execFileSync(file, args, common)
    return { ok: true, code: 0, stdout: trunc(stdout), stderr: "" }
  } catch (e) {
    return { ok: false, code: typeof e.status === "number" ? e.status : null, timedOut: isTimeoutErr(e), stdout: trunc(e.stdout), stderr: trunc(e.stderr || e.message) }
  }
}
// 1 retry curto SÓ em timeout (cold-start de npx/AV); segunda falha vale.
function probeRetryTimeout(probe, file, args, opts) {
  const first = probe(file, args, opts)
  if (!first.timedOut) return first
  const second = probe(file, args, opts)
  return { ...second, retried: true, timedOut: second.timedOut === true }
}

// Como defaultProbe, mas SEM truncar stdout — para saídas JSON (context/fallow audit).
function runFullDefault(file, args, opts = {}) {
  const shell = /\.(cmd|bat)$/i.test(file)
  try {
    const stdout = execFileSync(file, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 60000, encoding: "utf-8", shell, ...opts })
    return { ok: true, code: 0, stdout, stderr: "" }
  } catch (e) {
    return { ok: false, code: typeof e.status === "number" ? e.status : null, stdout: String(e.stdout || ""), stderr: trunc(e.stderr || e.message) }
  }
}
const pyBin = (probe) => (probe("python3", ["--version"]).ok ? "python3" : "python")

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

// classifica um probe simples (sem noção de routing): callable / not_callable /
// timeout_degraded / missing. TIMEOUT NUNCA vira `missing` (falso negativo que a
// revisão do PRD26 mediu): a ferramenta pode estar instalada e o probe frio/lento.
const classifyProbe = (res, filesExist) => {
  if (res.ok) return "callable"
  if (res.timedOut) return "timeout_degraded"
  return filesExist ? "installed_not_callable" : "missing"
}
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

// Resumo do audit do Fallow. NÃO roda por default (audit é pesado) — só quando um
// runner `fallowAudit` é injetado (ex.: tools refresh/CI). Senão declara "unknown".
const auditNum = (v) => (typeof v === "number" ? v : null)
function parseFallowAudit(json) {
  const s = json.summary || {}
  return {
    verdict: json.verdict || "unknown",
    deadCode: auditNum(s.dead_code_issues),
    complexity: auditNum(s.complexity_findings),
    duplication: auditNum(s.duplication_clone_groups),
    maxCyclomatic: auditNum(s.max_cyclomatic),
  }
}
function fallowAuditSummary(fallowAudit) {
  if (typeof fallowAudit !== "function") return { verdict: "unknown", note: "audit não executado (rode `tools refresh` ou `verify`)" }
  try {
    const r = fallowAudit()
    return r && r.ok && r.stdout ? parseFallowAudit(JSON.parse(r.stdout)) : { verdict: "unknown", note: "audit falhou/indisponível" }
  } catch {
    return { verdict: "unknown", note: "audit ilegível" }
  }
}
function probeFallow(probe, fallowAudit) {
  // npx frio no Windows já estourou 15s com fallow INSTALADO — retry só em timeout.
  const res = probeRetryTimeout(probe, npxBin(), ["fallow", "--version"])
  return toolEntry({
    status: classifyProbe(res, false), scope: "project", purpose: "deterministic_quality_gate",
    command: "npx fallow --version", res, extra: { auditSummary: fallowAuditSummary(fallowAudit) },
  })
}

function readGraph(graphPath) {
  try { return JSON.parse(stripBom(readFileSync(graphPath, "utf-8"))) }
  catch { return null }
}
function countCommunities(nodes) {
  const s = new Set()
  for (const n of nodes) if (n.community != null) s.add(n.community)
  return s.size
}
function graphMetrics(g) {
  const nodes = Array.isArray(g.nodes) ? g.nodes : []
  const links = Array.isArray(g.links) ? g.links : []
  return { indexedCommit: g.built_at_commit || null, nodes: nodes.length, edges: links.length, communities: countCommunities(nodes) }
}
const freshnessState = (builtAt, head) => (!builtAt || !head ? "unknown" : builtAt === head ? "fresh" : "stale")
// Ação recomendada IMPOSSÍVEL de confundir (PRD25 25.2): stale/absent ⇒ como sanar.
const FRESHNESS_ACTIONS = Object.freeze({
  stale: "tools refresh --changed (ou `graphify update .`)",
  absent: "graphify index . (gera graphify-out/graph.json)",
})
const withAction = (freshness) => ({ ...freshness, recommendedAction: FRESHNESS_ACTIONS[freshness.state] || null })
// Lê graphify-out/graph.json UMA vez: freshness (vs git HEAD) + métricas (nós/arestas/comunidades).
function graphInfo(cwd, head) {
  const graphPath = join(cwd, "graphify-out", "graph.json")
  if (!existsSync(graphPath)) return { freshness: withAction({ state: "absent" }), metrics: null }
  const g = readGraph(graphPath)
  if (!g) return { freshness: withAction({ state: "unknown", head: head || null }), metrics: null }
  const m = graphMetrics(g)
  return { freshness: withAction({ state: freshnessState(m.indexedCommit, head), builtAtCommit: m.indexedCommit, head: head || null }), metrics: m }
}
function probeGraphify(probe, cwd, head) {
  const res = probe("graphify", ["--version"])
  const gi = graphInfo(cwd, head)
  return toolEntry({
    status: classifyProbe(res, false), scope: "path", purpose: "code_topology",
    command: "graphify --version", res, extra: { freshness: gi.freshness, metrics: gi.metrics },
  })
}

function headroomExe(cwd) {
  const rel = process.platform === "win32" ? ["Scripts", "headroom.exe"] : ["bin", "headroom"]
  return join(cwd, ".gstack", "tools", "headroom-venv", ...rel)
}
// Roteamento por harness a partir da saída do `headroom doctor` (nunca assume):
// procura a linha do harness e classifica routed/not_routed. Só conta como global
// `routed` quando proxy roda E há tráfego roteado.
function harnessRouted(lower, harness) {
  const line = (lower.match(new RegExp(`${harness}[^\\n]*`, "i")) || [""])[0]
  if (!line) return "unknown"
  const negated = /not|nao|não/.test(line)
  return line.includes("routed") && !negated ? "routed" : "not_routed"
}
function headroomRouting(probe, exe) {
  const doc = probe(exe, ["doctor"])
  if (!doc.ok) return { proxyRunning: false, byHarness: {}, routed: false }
  const lower = doc.stdout.toLowerCase()
  const byHarness = { claude: harnessRouted(lower, "claude"), codex: harnessRouted(lower, "codex"), opencode: harnessRouted(lower, "opencode") }
  const proxyRunning = lower.includes("proxy running")
  return { proxyRunning, byHarness, routed: proxyRunning && lower.includes("routed") }
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
  const routing = headroomRouting(probe, exe)
  return toolEntry({
    status: routing.routed ? "routed" : "callable_not_routed", scope: "project", purpose: "token_proxy",
    command: `${exe} doctor`, res: ver, extra: { routed: routing.routed, routing },
  })
}

const num = (v) => (typeof v === "number" ? v : null)
const SOURCE_KEYS = ["adr", "prd", "plans", "research", "docs", "readme", "repo", "changelog"]
function bySourceCounts(src) {
  const out = {}
  for (const k of SOURCE_KEYS) out[k] = src[k] || 0
  return out
}
function parseContextStatus(json) {
  return {
    documents: num(json.documents), chunks: num(json.chunks),
    entities: num(json.entities), edges: num(json.edges),
    ftsEnabled: !!json.fts_enabled,
    bySource: bySourceCounts(json.by_source || {}),
  }
}
// Contagens tipadas do Context DB via `context_db.py status --db --json` (bounded).
function contextCounts(dbPath, runFull, probe) {
  const r = runFull(pyBin(probe), [INDEXER, "status", "--db", dbPath, "--json"])
  if (!r.ok || !r.stdout) return null
  try { return parseContextStatus(JSON.parse(r.stdout)) } catch { return null }
}
function probeContext(cwd, runFull, probe) {
  const dbPath = join(cwd, ".gstack", "context", "context.db")
  const exists = existsSync(dbPath)
  return {
    status: exists ? "callable" : "installed_not_callable",
    scope: "project", purpose: "offline_doc_search",
    validatedCommand: "context status --db --json",
    exitCode: null, stdout: "", stderr: "",
    artifact: exists ? dbPath : null,
    counts: exists ? contextCounts(dbPath, runFull, probe) : null,
  }
}

// MCP por ESCOPO (PRD24 24.5): distingue runtime_injected × project_local × global.
// Inclui o run context do GStack como fonte (nunca lê/escreve config global).
function buildMcpScope(cwd, home, inventoryFn) {
  const inv = (inventoryFn || buildMcpInventory)({ cwd, home, readers: mcpReaders() })
  const scopes = summarizeScopes(inv.servers, { cwd })
  return {
    byScope: scopes.byScope,
    total: scopes.total,
    hasRuntimeInjected: scopes.hasRuntimeInjected,
    note: "runtime_injected é do run context (.gstack/mcp/runtime.json) e NÃO aparece em `opencode mcp list`.",
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
const STALE_AFTER_SECONDS = 3600 // readiness expira em 1h (freshness declarada, não medida)
function buildTools(cwd, probe, runFull, head, fallowAudit) {
  return {
    fallow: probeFallow(probe, fallowAudit),
    graphify: probeGraphify(probe, cwd, head),
    gstackContext: probeContext(cwd, runFull, probe),
    headroom: probeHeadroom(probe, cwd),
  }
}
const readinessNow = (opts) => opts.now || (() => new Date().toISOString())
const readinessHead = (opts, cwd, probe) => (opts.git || (() => gitHead(cwd, probe)))()
export function buildReadiness(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const home = opts.home || homedir()
  const probe = opts.probe || defaultProbe
  const runFull = opts.runFull || runFullDefault
  const now = readinessNow(opts)
  const head = readinessHead(opts, cwd, probe)
  return {
    schemaVersion: 2,
    generatedAt: now(),
    lastUpdated: now(),
    staleAfterSeconds: STALE_AFTER_SECONDS,
    cleanMachine: opts.cleanMachine === true,
    guardrails: GUARDRAILS,
    statuses: STATUS_DESCRIPTIONS,
    env: readEnv(probe),
    tools: buildTools(cwd, probe, runFull, head, opts.fallowAudit),
    mcp: buildMcpScope(cwd, home, opts.mcpInventory),
    harnessDiscovery: harnessDiscovery(cwd, home),
  }
}
