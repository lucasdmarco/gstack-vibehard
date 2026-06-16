import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { buildContextRegistry, countDocs, DOC_SOURCES } from "../context-docs/registry.js"
import { success, warn, error, info, section } from "../cli/index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEXER = join(__dirname, "..", "context-docs", "py", "context_db.py")

function resolvePythonCmd() {
  try { execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 3000 }); return "python3" } catch { return "python" }
}

function dbPath(cwd) {
  return join(cwd, ".gstack", "context", "context.db")
}

/** Invoca o indexer Python. Retorna { ok, stdout } e degrada gracioso. */
function runIndexer(subArgs, opts = {}) {
  const py = resolvePythonCmd()
  try {
    const out = execFileSync(py, [INDEXER, ...subArgs], { stdio: "pipe", shell: false, timeout: opts.timeout || 120000, encoding: "utf-8" })
    return { ok: true, stdout: (out || "").toString() }
  } catch (e) {
    return { ok: false, stdout: (e.stdout || "").toString(), error: (e.stderr || e.message || "").toString() }
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

export async function contextCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const sub = args[0]

  switch (sub) {
    case "init": {
      section("context init — fundação de context docs")
      mkdirSync(join(cwd, ".gstack"), { recursive: true })
      const p = contextPath(cwd)
      // Idempotente: não sobrescreve se já existe
      if (!existsSync(p)) {
        writeFileSync(p, JSON.stringify(buildContextRegistry(), null, 2) + "\n")
        success("Criado .gstack/context.json")
      } else {
        info(".gstack/context.json já existe — preservado")
      }
      ensureDocDirs(cwd)
      success(`Diretórios de docs prontos: ${Object.values(DOC_SOURCES).join(", ")}`)
      info("Coloque ADRs/PRDs/plans/research em docs/* — o session_start injeta só um resumo.")
      return
    }

    case "status": {
      const withDb = args.includes("--db")
      section("context status")
      const p = contextPath(cwd)
      if (!existsSync(p)) {
        warn("Sem .gstack/context.json. Rode `gstack_vibehard context init`.")
        return
      }
      let reg
      try { reg = JSON.parse(readFileSync(p, "utf-8")) } catch (e) { warn(`context.json ilegível: ${e.message}`); return }
      const c = countDocs(cwd)
      info(`injectMode: ${reg.sessionStart?.injectMode || "summary-only"}`)
      info(`ADR: ${c.adr} · PRD: ${c.prd} · plans: ${c.plans} · research: ${c.research} · total: ${c.total}`)
      if (withDb) {
        if (!existsSync(dbPath(cwd))) { info("índice: não criado (rode `context index`)"); return }
        const r = runIndexer(["status", "--db", dbPath(cwd)])
        if (r.ok) info(`índice: ${r.stdout.trim()}`)
      }
      return
    }

    case "index": {
      section("context index — Document Graph local (SQLite/FTS5)")
      mkdirSync(dirname(dbPath(cwd)), { recursive: true })
      const extra = args.includes("--reindex") ? ["--reindex"] : []
      const r = runIndexer(["index", "--db", dbPath(cwd), "--root", cwd, ...extra])
      if (r.ok) success(r.stdout.trim() || "Índice atualizado.")
      else error(`Falha ao indexar: ${r.error || "ver python"}`)
      return
    }

    case "search": {
      const q = args[1]
      section(`context search — ${q || ""}`)
      if (!q) { error("Forneça o termo: context search \"...\""); return }
      if (!existsSync(dbPath(cwd))) { warn("Índice não existe. Rode `context index` antes."); return }
      const json = args.includes("--json")
      const r = runIndexer(["search", "--db", dbPath(cwd), "--query", q, ...(json ? ["--json"] : [])])
      if (r.ok) process.stdout.write(r.stdout)
      else error(`Busca falhou: ${r.error}`)
      return
    }

    case "related": {
      const ent = args[1]
      section(`context related — ${ent || ""}`)
      if (!ent) { error("Forneça a entidade: context related <Nome>"); return }
      if (!existsSync(dbPath(cwd))) { warn("Índice não existe. Rode `context index` antes."); return }
      const r = runIndexer(["related", "--db", dbPath(cwd), "--entity", ent, ...(args.includes("--json") ? ["--json"] : [])])
      if (r.ok) process.stdout.write(r.stdout)
      else error(`Falha: ${r.error}`)
      return
    }

    case "explain": {
      const topic = args[1]
      section(`context explain — ${topic || ""}`)
      if (!topic) { error("Forneça o tópico: context explain \"...\""); return }
      if (!existsSync(dbPath(cwd))) { warn("Índice não existe. Rode `context index` antes."); return }
      info("Documentos relevantes:")
      process.stdout.write(runIndexer(["search", "--db", dbPath(cwd), "--query", topic]).stdout)
      info("Entidades relacionadas:")
      process.stdout.write(runIndexer(["related", "--db", dbPath(cwd), "--entity", topic]).stdout)
      return
    }

    default:
      section("context — Document Graph local (offline, sem LLM)")
      info("  gstack_vibehard context init             Criar .gstack/context.json + docs/{adr,prd,plans,research}")
      info("  gstack_vibehard context index            Indexar docs em SQLite/FTS5 (.gstack/context/context.db)")
      info("  gstack_vibehard context search \"<termo>\"  Buscar (FTS5, offline)")
      info("  gstack_vibehard context related <Nome>   Entidades/relações de um termo")
      info("  gstack_vibehard context explain \"<top>\"   Docs + entidades de um tópico")
      info("  gstack_vibehard context status [--db]    Contagem (e grafo indexado com --db)")
  }
}
