import { execFileSync } from "child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs"
import { join, resolve, dirname, basename } from "path"
import { fileURLToPath } from "url"
import { buildCanonicalContract, findOrphans, renderCanonicalMarkdown } from "../skills/agents-canonical.js"
import { hasExecutionContract } from "../agents/factory.js"
import { getAdapterInfo, isInstructional } from "../agents/adapter-matrix.js"
import { capabilityRow, validateScorecard } from "../harness/capabilities.js"
import { stripBom } from "../util/json.js"
import { runP0Conformance } from "../skills/behavioral-conformance.js"
import { section, success, warn, error, info } from "../cli/index.js"

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPT = join(PKG_ROOT, "scripts", "scripts", "build_agents.js")
const GEN = join(PKG_ROOT, "agents", "generated")
const SRC_AGENTS = join(PKG_ROOT, "agents", "agents")

function runScript(args, opts = {}) {
  // Spawna o compilador com o MESMO node (sem depender do PATH). Root = pacote.
  return execFileSync(process.execPath, [SCRIPT, ...args], { stdio: opts.stdio || "inherit", cwd: PKG_ROOT, encoding: "utf-8" })
}

function readManifest() {
  const p = join(GEN, "manifest.json")
  if (!existsSync(p)) return null
  try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null }
}

function listSourceAgents() {
  if (!existsSync(SRC_AGENTS)) return []
  return readdirSync(SRC_AGENTS).filter((f) => f.endsWith(".md")).map((f) => {
    const text = readFileSync(join(SRC_AGENTS, f), "utf-8")
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const meta = {}
    if (m) for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "") }
    return { id: (meta.name || basename(f, ".md")).toLowerCase(), description: meta.description || "", file: `agents/agents/${f}` }
  })
}

/** Drift via o compilador (--check) — autoridade do guard. { ok, detail }. */
function checkDrift() {
  try { runScript(["--check"], { stdio: "pipe" }); return { ok: true, detail: "generated em dia" } }
  catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`
    const line = out.split(/\r?\n/).find((l) => /desatualiz|ERRO|stale/i.test(l)) || "generated desatualizado"
    return { ok: false, detail: line.replace(/^\[build:agents\]\s*/, "").trim() }
  }
}

function agentsBuild(args) {
  section("agents build")
  try { runScript(args.includes("--dry-run") ? ["--dry-run"] : []); success("Adapters gerados (agents/generated/).") }
  catch { error("Falha no build dos agentes."); process.exitCode = 1 }
}
function agentsCheck(json) {
  const d = checkDrift()
  if (json) { process.stdout.write(JSON.stringify(d) + "\n"); if (!d.ok) process.exitCode = 1; return }
  section("agents check")
  if (d.ok) success("OK — generated em dia com core/knowledge/agents.")
  else { error(`Drift: ${d.detail}`); info("  Corrija com `gstack_vibehard agents build`."); process.exitCode = 1 }
}
function agentsDiff() {
  section("agents diff (dry-run)")
  try { runScript(["--dry-run"]) } catch { /* dry-run não bloqueia */ }
}
const explainId = (args) => args.filter((a) => !a.startsWith("-"))[1]

const verdictIcon = (v) => (v === "conformant" ? "✓" : v === "inconclusive" ? "?" : "✗")

// S42.4: conformance comportamental das skills P0 (RED/GREEN/REFACTOR sobre o verificador
// REAL). `inconclusive` NUNCA é verde. Sai 1 se alguma P0 não for conformant.
function conformanceCmd(json) {
  const agg = runP0Conformance()
  if (json) { process.stdout.write(JSON.stringify(agg) + "\n"); return }
  section(`agents conformance — ${agg.reports.length} skill(s) P0`)
  for (const r of agg.reports) info(`  ${verdictIcon(r.verdict)} ${r.skill}: ${r.verdict} (${r.phases.map((p) => `${p.phase}:${p.verdict}`).join(" ")})`)
  if (agg.ready) success("Todas as skills P0 conformes (comportamento medido).")
  else { error(`Não-conforme: ${agg.blocked.map((b) => `${b.skill}:${b.verdict}`).join(", ")}`); process.exitCode = 1 }
}

const AGENTS_HANDLERS = {
  build: (args) => agentsBuild(args),
  check: (args, json) => agentsCheck(json),
  diff: () => agentsDiff(),
  list: (args, json) => listCmd(json, args),
  explain: (args, json) => explainCmd(explainId(args), json),
  doctor: (args, json) => doctorCmd(json),
  conformance: (args, json) => conformanceCmd(json),
}

export async function agentsCommand(args = [], opts = {}) {
  const sub = args.find((a) => !a.startsWith("-")) || "doctor"
  const json = args.includes("--json")
  const handler = AGENTS_HANDLERS[sub]
  if (handler) return handler(args, json)
  warn(`Subcomando desconhecido: ${sub}`)
  info("  Use: agents <build|check|diff|doctor|list|explain|conformance>")
}

function listCmd(json, args = []) {
  const agents = listSourceAgents()
  if (args.includes("--canonical")) return canonicalList(agents, json)
  if (json) { process.stdout.write(JSON.stringify({ agents }) + "\n"); return }
  section(`agents list — ${agents.length} agente(s) fonte`)
  for (const a of agents) info(`  • ${a.id}${a.description ? ` — ${a.description}` : ""}`)
}
// F5-B: contrato canônico (papéis MEDIDOS; routers/packs não contam). Artefato
// project-scoped em .gstack/agents/ (gitignored, como o skill catalog).
function generatedClaudeIds() {
  const dir = join(GEN, "claude")
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "SKILL.md"))) : []
}
function canonicalList(agents, json) {
  const contract = buildCanonicalContract(agents)
  const orphans = findOrphans(contract, generatedClaudeIds())
  const dir = join(PKG_ROOT, ".gstack", "agents")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "canonical.json"), JSON.stringify({ ...contract, orphans }, null, 2) + "\n")
  writeFileSync(join(dir, "canonical.md"), renderCanonicalMarkdown(contract))
  if (json) { process.stdout.write(JSON.stringify({ ...contract, orphans }) + "\n"); return }
  section(`agents list --canonical — ${contract.count} papéis (medido)`)
  contract.canonicalRoles.forEach((r) => info(`  • ${r}`))
  info(`  Excluídos: ${contract.excluded.routers.length} routers, ${contract.excluded.packs.length} packs`)
  if (orphans.rolesWithoutAdapter.length) warn(`  Papéis sem adapter: ${orphans.rolesWithoutAdapter.join(", ")}`)
}

const adapterStatusOf = (p) => (existsSync(p) ? (hasExecutionContract(readFileSync(p, "utf-8")) ? "ok+contract" : "SEM contrato") : "ausente")
const descOr = (d) => d || "(sem descrição)"
function agentAdapterStatus(id) {
  const adapters = {
    claude: join(GEN, "claude", id, "SKILL.md"),
    codex: join(GEN, "codex", `${id}.toml`),
    cursor: join(GEN, "cursor", "rules", `${id}.mdc`),
  }
  const status = {}
  for (const [k, p] of Object.entries(adapters)) status[k] = adapterStatusOf(p)
  return status
}
function printAdapterStatus(status) {
  for (const [k, s] of Object.entries(status)) (s.startsWith("ok") ? success : warn)(`  ${k}: ${s}`)
}
function explainCmd(id, json) {
  if (!id) return error("Uso: agents explain <agent>")
  const a = listSourceAgents().find((x) => x.id === id)
  if (!a) return warn(`Agente não encontrado: ${id}`)
  const status = agentAdapterStatus(id)
  if (json) return process.stdout.write(JSON.stringify({ id, description: a.description, source: a.file, adapters: status }) + "\n")
  section(`agents explain — ${id}`)
  info(`  Descrição: ${descOr(a.description)}`)
  info(`  Fonte: ${a.file}`)
  printAdapterStatus(status)
}

// contrato presente em todos os adapters gerados? (per-agente + combinados
// copilot/gemini; AGENTS.md/índice não conta).
function collectClaudeAdapters(files) {
  const dir = join(GEN, "claude")
  if (!existsSync(dir)) return
  for (const d of readdirSync(dir)) { const f = join(dir, d, "SKILL.md"); if (existsSync(f)) files.push(f) }
}
function collectExtAdapters(files, dirParts, ext) {
  const dir = join(GEN, ...dirParts)
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir)) if (f.endsWith(ext)) files.push(join(dir, f))
}
function collectAdapterFiles() {
  const files = []
  collectClaudeAdapters(files)
  collectExtAdapters(files, ["codex"], ".toml")
  collectExtAdapters(files, ["cursor", "rules"], ".mdc")
  for (const combined of [join(GEN, "copilot", "copilot-instructions.md"), join(GEN, "gemini", "GEMINI.md")]) if (existsSync(combined)) files.push(combined)
  return files
}
function countMissingContract(files) {
  let missing = 0
  for (const f of files) { try { if (!hasExecutionContract(readFileSync(f, "utf-8"))) missing += 1 } catch { missing += 1 } }
  return { checked: files.length, missing }
}
// MATRIZ HONESTA V2 (PRD 14 §4.1): scorecard por harness; instrucional nunca é
// rotulado enforcement/Zero-Trust (invariante validada pelo scorecard).
const buildMatrix = (adapters) => Object.entries(adapters).map(([id, a]) => ({ ...capabilityRow(id), status: a.status, files: (a.files || []).length }))
const agentsDoctorOk = (manifest, drift, contract, scorecard) =>
  !!manifest && manifest.schemaVersion === 2 && drift.ok && contract.missing === 0 && scorecard.ok
function buildAgentsDoctorReport(manifest, drift, matrix, contract, scorecard) {
  return {
    schemaVersion: manifest ? manifest.schemaVersion : null,
    compilerVersion: manifest ? manifest.compilerVersion : null,
    agents: manifest ? manifest.agents : 0,
    drift: drift.ok ? null : drift.detail,
    contract,
    security: manifest ? manifest.security : null,
    matrix,
    matrixSchema: "gstack.capability.v2",
    scorecard,
    ok: agentsDoctorOk(manifest, drift, contract, scorecard),
  }
}

function renderDoctorHeader(manifest, drift) {
  info(`  Manifest: schemaVersion ${manifest.schemaVersion} · compilado por ${manifest.compilerVersion} · ${manifest.agents} agentes`)
  ;(drift.ok ? success : error)(`  Drift: ${drift.ok ? "nenhum (generated em dia)" : drift.detail}`)
}
function renderDoctorContract(contract) {
  ;(contract.missing === 0 ? success : error)(`  Execution Contract: ${contract.checked - contract.missing}/${contract.checked} adapters`)
}
function renderDoctorSecurity(manifest) {
  if (!manifest.security) return
  ;(manifest.security.verdict === "pass" ? success : error)(`  Security: ${manifest.security.verdict} (crit ${manifest.security.critical}, alto ${manifest.security.high})`)
}
function renderAgentsMatrix(matrix) {
  section("Capability matrix V2 (enforcement REAL — instrucional não é enforcement)")
  for (const r of matrix) {
    info(`  • ${r.harness}: ${r.status} · ${r.files} arquivo(s) · state=${r.state} · enforcement=${r.enforcement}`)
    if (r.riskNotes.length) info(`      risco: ${r.riskNotes[0]} · verificado: ${r.lastVerifiedAt} (${r.owner})`)
  }
}
function renderDoctorScorecard(scorecard) {
  ;(scorecard.ok ? success : error)(`  Scorecard: ${scorecard.ok ? "íntegro (nenhum instrucional reivindica hooks)" : scorecard.errors.join("; ")}`)
}
function renderDoctorVerdict(report) {
  if (!report.ok) { process.exitCode = 1; return warn("Há pendências acima — rode `agents build`.") }
  success("Agent Factory saudável.")
}
function renderAgentsDoctor(report, manifest, drift, scorecard) {
  section("agents doctor")
  renderDoctorHeader(manifest, drift)
  renderDoctorContract(report.contract)
  renderDoctorSecurity(manifest)
  renderAgentsMatrix(report.matrix)
  renderDoctorScorecard(scorecard)
  renderDoctorVerdict(report)
}

function doctorCmd(json) {
  const manifest = readManifest()
  const drift = checkDrift()
  const adapters = manifest && manifest.adapters ? manifest.adapters : {}
  const matrix = buildMatrix(adapters)
  const scorecard = validateScorecard()
  const contract = countMissingContract(collectAdapterFiles())
  const report = buildAgentsDoctorReport(manifest, drift, matrix, contract, scorecard)
  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); if (!report.ok) process.exitCode = 1; return }
  if (!manifest) { error("manifest.json ausente — rode `agents build`."); process.exitCode = 1; return }
  renderAgentsDoctor(report, manifest, drift, scorecard)
}
