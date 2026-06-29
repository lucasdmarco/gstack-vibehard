import { execFileSync } from "child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join, resolve, dirname, basename } from "path"
import { fileURLToPath } from "url"
import { hasExecutionContract } from "../agents/factory.js"
import { getCapability } from "../dream/capabilities.js"
import { stripBom } from "../util/json.js"
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

export async function agentsCommand(args = [], opts = {}) {
  const sub = args.find((a) => !a.startsWith("-")) || "doctor"
  const json = args.includes("--json")

  if (sub === "build") {
    section("agents build")
    try { runScript(args.includes("--dry-run") ? ["--dry-run"] : []); success("Adapters gerados (agents/generated/).") }
    catch { error("Falha no build dos agentes."); process.exitCode = 1 }
    return
  }
  if (sub === "check") {
    const d = checkDrift()
    if (json) { process.stdout.write(JSON.stringify(d) + "\n"); if (!d.ok) process.exitCode = 1; return }
    section("agents check")
    if (d.ok) success("OK — generated em dia com core/knowledge/agents.")
    else { error(`Drift: ${d.detail}`); info("  Corrija com `gstack_vibehard agents build`."); process.exitCode = 1 }
    return
  }
  if (sub === "diff") {
    section("agents diff (dry-run)")
    try { runScript(["--dry-run"]) } catch { /* dry-run não bloqueia */ }
    return
  }
  if (sub === "list") return listCmd(json)
  if (sub === "explain") return explainCmd(args.filter((a) => !a.startsWith("-"))[1], json)
  if (sub === "doctor") return doctorCmd(json)

  warn(`Subcomando desconhecido: ${sub}`)
  info("  Use: agents <build|check|diff|doctor|list|explain>")
}

function listCmd(json) {
  const agents = listSourceAgents()
  if (json) { process.stdout.write(JSON.stringify({ agents }) + "\n"); return }
  section(`agents list — ${agents.length} agente(s) fonte`)
  for (const a of agents) info(`  • ${a.id}${a.description ? ` — ${a.description}` : ""}`)
}

function explainCmd(id, json) {
  if (!id) { error("Uso: agents explain <agent>"); return }
  const a = listSourceAgents().find((x) => x.id === id)
  if (!a) { warn(`Agente não encontrado: ${id}`); return }
  const adapters = {
    claude: join(GEN, "claude", id, "SKILL.md"),
    codex: join(GEN, "codex", `${id}.toml`),
    cursor: join(GEN, "cursor", "rules", `${id}.mdc`),
  }
  const status = {}
  for (const [k, p] of Object.entries(adapters)) {
    status[k] = existsSync(p) ? (hasExecutionContract(readFileSync(p, "utf-8")) ? "ok+contract" : "SEM contrato") : "ausente"
  }
  if (json) { process.stdout.write(JSON.stringify({ id, description: a.description, source: a.file, adapters: status }) + "\n"); return }
  section(`agents explain — ${id}`)
  info(`  Descrição: ${a.description || "(sem descrição)"}`)
  info(`  Fonte: ${a.file}`)
  for (const [k, s] of Object.entries(status)) (s.startsWith("ok") ? success : warn)(`  ${k}: ${s}`)
}

function doctorCmd(json) {
  const manifest = readManifest()
  const drift = checkDrift()
  const adapters = manifest && manifest.adapters ? manifest.adapters : {}
  // matriz honesta: status do manifest + trustLevel real do harness (capabilities.js)
  const matrix = Object.entries(adapters).map(([id, a]) => ({
    harness: id, status: a.status, files: (a.files || []).length, trustLevel: getCapability(id).trustLevel,
  }))
  // contrato presente em todos os adapters POR-AGENTE gerados? (AGENTS.md é índice, não conta)
  const adapterFilesToCheck = []
  const claudeDir = join(GEN, "claude")
  if (existsSync(claudeDir)) for (const d of readdirSync(claudeDir)) { const f = join(claudeDir, d, "SKILL.md"); if (existsSync(f)) adapterFilesToCheck.push(f) }
  const codexDir = join(GEN, "codex")
  if (existsSync(codexDir)) for (const f of readdirSync(codexDir)) if (f.endsWith(".toml")) adapterFilesToCheck.push(join(codexDir, f))
  const cursorRules = join(GEN, "cursor", "rules")
  if (existsSync(cursorRules)) for (const f of readdirSync(cursorRules)) if (f.endsWith(".mdc")) adapterFilesToCheck.push(join(cursorRules, f))
  let missingContract = 0
  const checked = adapterFilesToCheck.length
  for (const f of adapterFilesToCheck) { try { if (!hasExecutionContract(readFileSync(f, "utf-8"))) missingContract += 1 } catch { missingContract += 1 } }
  const report = {
    schemaVersion: manifest ? manifest.schemaVersion : null,
    compilerVersion: manifest ? manifest.compilerVersion : null,
    agents: manifest ? manifest.agents : 0,
    drift: drift.ok ? null : drift.detail,
    contract: { checked, missing: missingContract },
    security: manifest ? manifest.security : null,
    matrix,
    ok: !!manifest && manifest.schemaVersion === 2 && drift.ok && missingContract === 0,
  }
  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); if (!report.ok) process.exitCode = 1; return }
  section("agents doctor")
  if (!manifest) { error("manifest.json ausente — rode `agents build`."); process.exitCode = 1; return }
  info(`  Manifest: schemaVersion ${manifest.schemaVersion} · compiler ${manifest.compilerVersion} · ${manifest.agents} agentes`)
  ;(drift.ok ? success : error)(`  Drift: ${drift.ok ? "nenhum (generated em dia)" : drift.detail}`)
  ;(missingContract === 0 ? success : error)(`  Execution Contract: ${checked - missingContract}/${checked} adapters`)
  if (manifest.security) (manifest.security.verdict === "pass" ? success : error)(`  Security: ${manifest.security.verdict} (crit ${manifest.security.critical}, alto ${manifest.security.high})`)
  section("Adapter matrix (status × confiança real)")
  for (const r of matrix) info(`  • ${r.harness}: ${r.status} · ${r.files} arquivo(s) · trust=${r.trustLevel}`)
  if (!report.ok) { process.exitCode = 1; warn("Há pendências acima — rode `agents build`.") }
  else success("Agent Factory saudável.")
}
