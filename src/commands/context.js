import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { buildContextRegistry, countDocs, DOC_SOURCES } from "../context-docs/registry.js"
import { setObsidianPath, getObsidianPath, obsidianDetected, getGlobalObsidianDefault, chooseObsidian } from "../context-docs/obsidian.js"
import { findGraphifyOutput } from "../context-docs/graphify.js"
import { scout } from "../context-docs/scout.js"
import { resolveModel } from "../model-policy/index.js"
import { success, warn, error, info, section, select, prompt } from "../cli/index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEXER = join(__dirname, "..", "context-docs", "py", "context_db.py")

function resolvePythonCmd() {
  try { execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 3000 }); return "python3" } catch { return "python" }
}

function dbPath(cwd) {
  return join(cwd, ".gstack", "context", "context.db")
}

const asStr = (x) => (x || "").toString()
/** Invoca o indexer Python. Retorna { ok, stdout } e degrada gracioso. */
function runIndexer(subArgs, opts = {}) {
  const py = resolvePythonCmd()
  try {
    const out = execFileSync(py, [INDEXER, ...subArgs], { stdio: "pipe", shell: false, timeout: opts.timeout || 120000, encoding: "utf-8" })
    return { ok: true, stdout: asStr(out) }
  } catch (e) {
    return { ok: false, stdout: asStr(e.stdout), error: asStr(e.stderr || e.message) }
  }
}

function contextPath(cwd) {
  return join(cwd, ".gstack", "context.json")
}

function ensureDocDirs(cwd) {
  for (const rel of Object.values(DOC_SOURCES)) {
    const dir = join(cwd, rel)
    mkdirSync(dir, { recursive: true })
    const keep = join(dir, ".gitkeep")
    if (!existsSync(keep)) writeFileSync(keep, "")
  }
}

// ── Sub-handlers de `context` (registry de subcomandos; --json sempre puro) ──────

const ctxJson = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")
const jsonFlag = (json) => (json ? ["--json"] : [])
const orEmpty = (x) => x || ""
/** Falha padronizada: JSON puro com `error:code`, ou mensagem humana. */
function ctxFail(json, code, human) {
  if (json) return ctxJson({ error: code })
  human()
}

async function initObsidianInteractive(cwd) {
  const chosen = await chooseObsidian({ select, prompt })
  if (!chosen) return info("Obsidian: pulado. Configure depois com `context obsidian set <pasta>`.")
  setObsidianPath(cwd, chosen)
  success(`Obsidian configurado (read-only): ${chosen}`)
}
// Obsidian: escolha (com 'pular') se detectado e ainda não configurado.
async function initObsidian(cwd) {
  if (getObsidianPath(cwd)) return
  const globalDefault = getGlobalObsidianDefault()
  if (globalDefault) { setObsidianPath(cwd, globalDefault); return info(`Obsidian herdado do default global: ${globalDefault} (read-only)`) }
  if (obsidianDetected() && process.stdin.isTTY) return initObsidianInteractive(cwd)
  if (obsidianDetected()) info("Obsidian detectado (não-interativo) — rode `context obsidian set <pasta>` para indexar.")
}
function ctxInit(args, cwd) {
  section("context init — fundação de context docs")
  mkdirSync(join(cwd, ".gstack"), { recursive: true })
  const p = contextPath(cwd)
  // Idempotente: não sobrescreve se já existe.
  if (!existsSync(p)) { writeFileSync(p, JSON.stringify(buildContextRegistry(), null, 2) + "\n"); success("Criado .gstack/context.json") }
  else info(".gstack/context.json já existe — preservado")
  ensureDocDirs(cwd)
  success(`Diretórios de docs prontos: ${Object.values(DOC_SOURCES).join(", ")}`)
  info("Coloque ADRs/PRDs/plans/research em docs/* — o session_start injeta só um resumo.")
  return initObsidian(cwd)
}

function statusDb(cwd) {
  if (!existsSync(dbPath(cwd))) return info("índice: não criado (rode `context index`)")
  const r = runIndexer(["status", "--db", dbPath(cwd)])
  if (r.ok) info(`índice: ${r.stdout.trim()}`)
}
function ctxStatus(args, cwd) {
  section("context status")
  const p = contextPath(cwd)
  if (!existsSync(p)) return warn("Sem .gstack/context.json. Rode `gstack_vibehard context init`.")
  let reg
  try { reg = JSON.parse(readFileSync(p, "utf-8")) } catch (e) { return warn(`context.json ilegível: ${e.message}`) }
  const c = countDocs(cwd)
  info(`injectMode: ${reg.sessionStart?.injectMode || "summary-only"}`)
  info(`ADR: ${c.adr} · PRD: ${c.prd} · plans: ${c.plans} · research: ${c.research} · total: ${c.total}`)
  if (args.includes("--db")) statusDb(cwd)
}

// Fontes opcionais opt-in: Obsidian (configurado) + Graphify (auto-detect).
function indexExtraArgs(cwd) {
  const extra = []
  const obs = getObsidianPath(cwd)
  if (obs) extra.push("--obsidian", obs)
  const gpath = findGraphifyOutput(cwd)
  if (gpath) extra.push("--graphify", gpath)
  return { extra, obs, gpath }
}
const indexFailMsg = (r) => `Falha ao indexar: ${r.error || "ver python"}`
const indexOkMsg = (r) => r.stdout.trim() || "Índice atualizado."
function ctxIndex(args, cwd) {
  section("context index — Document Graph local (SQLite/FTS5)")
  mkdirSync(dirname(dbPath(cwd)), { recursive: true })
  const reindex = args.includes("--reindex") ? ["--reindex"] : []
  const { extra, obs, gpath } = indexExtraArgs(cwd)
  const r = runIndexer(["index", "--db", dbPath(cwd), "--root", cwd, ...reindex, ...extra])
  if (!r.ok) return error(indexFailMsg(r))
  success(indexOkMsg(r))
  if (obs) info(`Obsidian indexado (read-only): ${obs}`)
  if (gpath) info(`Graphify bridge: ${gpath}`)
}

function ctxObsidianSet(cwd, folder) {
  if (!folder) return error("Forneça a pasta: context obsidian set <pasta>")
  if (!existsSync(folder)) warn(`Pasta não existe: ${folder} (registrada mesmo assim; será ignorada até existir)`)
  setObsidianPath(cwd, folder)
  success(`Obsidian registrado (read-only, opt-in): ${folder}`)
  info("Rode `context index` para indexar. Nada é aberto/criado; só leitura.")
}
function ctxObsidian(args, cwd) {
  const action = args[1]
  section(`context obsidian ${action || ""}`)
  if (action === "set") return ctxObsidianSet(cwd, args[2])
  if (action === "status") {
    const p = getObsidianPath(cwd)
    return info(p ? `Obsidian configurado: ${p}` : "Obsidian: não configurado (opcional).")
  }
  info("Uso: context obsidian set <pasta> | context obsidian status")
}

const scoutMaxResults = (args) => {
  const mi = args.indexOf("--max")
  return mi !== -1 && args[mi + 1] ? parseInt(args[mi + 1], 10) : 12
}
const isFastcontextBackend = (args) => args.includes("--backend") && args[args.indexOf("--backend") + 1] === "fastcontext"
function scoutError(msg, json) {
  const err = { ok: false, error: msg }
  if (json) ctxJson(err)
  else error(msg)
  return err
}
// Camada de docs (SQLite/FTS) injetada quando o índice existe — degrada sem quebrar.
function makeFtsSearch(cwd) {
  if (!existsSync(dbPath(cwd))) return null
  return (question) => {
    const r = runIndexer(["search", "--db", dbPath(cwd), "--query", question, "--json"])
    if (!r.ok) return []
    try {
      const parsed = JSON.parse(r.stdout)
      return (parsed.results || []).slice(0, 5).map((d) => ({ file: d.path, reason: `doc: ${String(d.heading || "").slice(0, 80)}`, confidence: 0.5 }))
    } catch { return [] }
  }
}
const scoutRouting = (report) =>
  `${report.modelRouting.tier}${report.modelRouting.fallback ? ` → ${report.modelRouting.fallback}` : ` (${report.modelRouting.model})`}`
function renderScout(report, q) {
  section(`context scout — ${q}`)
  if (!report.ok) return error(report.error)
  info(`  keywords: ${report.keywords.join(", ")} · backends: ${report.backendsUsed.join(", ")}`)
  for (const r of report.results) info(`  ${r.file}${r.lineStart ? `:${r.lineStart}-${r.lineEnd}` : ""} — ${r.reason} (${r.confidence.toFixed(2)}, ${r.backend})`)
  if (report.results.length === 0) warn("  nenhum hit — refine a pergunta")
  info(`  tokens evitados (estimativa): ~${report.tokensAvoided.estimate}`)
  info(`  roteamento: ${scoutRouting(report)}`)
}
function ctxScout(args, cwd) {
  const q = args[1]
  const json = args.includes("--json")
  if (!q) return scoutError('pergunta obrigatória: context scout "como X funciona?"', json)
  // FastContext/remoto NUNCA por default (PRD18) — opt-in explícito ainda não implementado.
  if (isFastcontextBackend(args)) return scoutError("backend remoto (fastcontext) requer opt-in explícito e ainda não é suportado — o scout é local-first", json)
  const report = scout({ cwd, question: q, ftsSearch: makeFtsSearch(cwd), maxResults: scoutMaxResults(args) })
  report.modelRouting = resolveModel(cwd, "explore") // cheap/local — nunca modelo forte p/ explorar
  if (json) { ctxJson(report); return report }
  renderScout(report, q)
  return report
}

function ctxSearch(args, cwd) {
  const q = args[1]
  const json = args.includes("--json")
  // --json → stdout PURO (sem header/banner) para automação/MCP.
  if (!json) section(`context search — ${orEmpty(q)}`)
  if (!q) return ctxFail(json, "missing query", () => error("Forneça o termo: context search \"...\""))
  if (!existsSync(dbPath(cwd))) return ctxFail(json, "no_index", () => warn("Índice não existe. Rode `context index` antes."))
  const r = runIndexer(["search", "--db", dbPath(cwd), "--query", q, ...jsonFlag(json)])
  if (r.ok) return process.stdout.write(r.stdout)
  ctxFail(json, r.error || "search_failed", () => error(`Busca falhou: ${r.error}`))
}

function ctxRelated(args, cwd) {
  const ent = args[1]
  const json = args.includes("--json")
  if (!json) section(`context related — ${orEmpty(ent)}`)
  if (!ent) return ctxFail(json, "missing entity", () => error("Forneça a entidade: context related <Nome>"))
  if (!existsSync(dbPath(cwd))) return ctxFail(json, "no_index", () => warn("Índice não existe. Rode `context index` antes."))
  const r = runIndexer(["related", "--db", dbPath(cwd), "--entity", ent, ...jsonFlag(json)])
  if (r.ok) return process.stdout.write(r.stdout)
  ctxFail(json, r.error || "related_failed", () => error(`Falha: ${r.error}`))
}

function explainJson(cwd, topic) {
  const s = runIndexer(["search", "--db", dbPath(cwd), "--query", topic, "--json"])
  const rel = runIndexer(["related", "--db", dbPath(cwd), "--entity", topic, "--json"])
  const safe = (x) => { try { return JSON.parse(x) } catch { return null } }
  ctxJson({ topic, search: safe(s.stdout), related: safe(rel.stdout) })
}
function ctxExplain(args, cwd) {
  const topic = args[1]
  const json = args.includes("--json")
  if (!topic) return ctxFail(json, "missing topic", () => error("Forneça o tópico: context explain \"...\""))
  if (!existsSync(dbPath(cwd))) return ctxFail(json, "no_index", () => warn("Índice não existe. Rode `context index` antes."))
  if (json) return explainJson(cwd, topic)
  section(`context explain — ${topic || ""}`)
  info("Documentos relevantes:")
  process.stdout.write(runIndexer(["search", "--db", dbPath(cwd), "--query", topic]).stdout)
  info("Entidades relacionadas:")
  process.stdout.write(runIndexer(["related", "--db", dbPath(cwd), "--entity", topic]).stdout)
}

function ctxHelp() {
  section("context — Document Graph local (offline, sem LLM)")
  info("  gstack_vibehard context init             Criar .gstack/context.json + docs/{adr,prd,plans,research}")
  info("  gstack_vibehard context index            Indexar docs em SQLite/FTS5 (.gstack/context/context.db)")
  info("  gstack_vibehard context scout \"<pergunta>\" Explorador read-only: paths+linhas, não dumps (local-first)")
  info("  gstack_vibehard context search \"<termo>\"  Buscar (FTS5, offline)")
  info("  gstack_vibehard context related <Nome>   Entidades/relações de um termo")
  info("  gstack_vibehard context explain \"<top>\"   Docs + entidades de um tópico")
  info("  gstack_vibehard context status [--db]    Contagem (e grafo indexado com --db)")
}

const CONTEXT_HANDLERS = {
  init: ctxInit,
  status: ctxStatus,
  index: ctxIndex,
  obsidian: ctxObsidian,
  scout: ctxScout,
  search: ctxSearch,
  related: ctxRelated,
  explain: ctxExplain,
}

export async function contextCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const handler = CONTEXT_HANDLERS[args[0]]
  if (handler) return handler(args, cwd)
  return ctxHelp()
}
