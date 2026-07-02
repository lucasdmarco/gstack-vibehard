import { mkdirSync, appendFileSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { sanitizeRecord, isValidEntity, ENTITIES, STATE_SCHEMA_VERSION } from "./schema.js"
import { migrate } from "./migrations.js"
import { stripBom } from "../util/json.js"

/**
 * State Store operacional (PRD14 §4.4) — project-scoped, aditivo, sem secrets.
 *
 * Backends (declarados, nunca OK falso):
 *  - "sqlite": `node:sqlite` (Node ≥ 22.5) → `<dataHome>/state.db`;
 *  - "jsonl_fallback": Node sem sqlite nativo → `<dataHome>/state.jsonl`
 *    (mesma API; a degradação é DECLARADA em `store.backend`).
 *
 * `GSTACK_AGENT_DATA_HOME` (PRD14 §4.12): isola a memória por harness/projeto —
 * default seguro é `<projeto>/.gstack` (project-scoped).
 */

/** Onde o estado vive: env por harness ou `.gstack/` do projeto (default). */
export function resolveDataHome(projectDir, env = process.env) {
  const custom = env.GSTACK_AGENT_DATA_HOME
  return custom && String(custom).trim() ? String(custom).trim() : join(projectDir, ".gstack")
}

function loadSqlite() {
  try {
    // import dinâmico via require indireto: node <22.5 não tem node:sqlite
    return process.getBuiltinModule ? process.getBuiltinModule("node:sqlite") : null
  } catch { return null }
}

function sqliteBackend(dir) {
  const mod = loadSqlite()
  if (!mod || !mod.DatabaseSync) return null
  try {
    const db = new mod.DatabaseSync(join(dir, "state.db"))
    migrate(db)
    return {
      backend: "sqlite",
      file: join(dir, "state.db"),
      insert(entity, at, data) { db.prepare(`INSERT INTO ${entity} (at, data) VALUES (?, ?)`).run(at, JSON.stringify(data)) },
      list(entity, limit) {
        return db.prepare(`SELECT at, data FROM ${entity} ORDER BY id DESC LIMIT ?`).all(limit)
          .map((r) => ({ at: r.at, ...JSON.parse(r.data) }))
      },
      count(entity) {
        const r = db.prepare(`SELECT COUNT(*) AS n, MAX(at) AS last FROM ${entity}`).get()
        return { count: Number(r.n) || 0, lastAt: r.last || null }
      },
      close() { try { db.close() } catch { /* ok */ } },
    }
  } catch { return null }
}

function jsonlBackend(dir) {
  const file = join(dir, "state.jsonl")
  const readAll = () => {
    if (!existsSync(file)) return []
    return stripBom(readFileSync(file, "utf-8")).split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  }
  return {
    backend: "jsonl_fallback",
    file,
    insert(entity, at, data) { appendFileSync(file, JSON.stringify({ entity, at, ...data }) + "\n") },
    list(entity, limit) { return readAll().filter((r) => r.entity === entity).slice(-limit).reverse() },
    count(entity) {
      const rows = readAll().filter((r) => r.entity === entity)
      return { count: rows.length, lastAt: rows.length ? rows[rows.length - 1].at : null }
    },
    close() { /* nada a fechar */ },
  }
}

/**
 * Abre o store do projeto. → { backend, file, record, list, summary, close }.
 * `record` sanitiza SEMPRE (chaves proibidas fora, segredos redigidos, valores
 * truncados) — o produtor não consegue gravar secret nem transcript por engano.
 */
export function openStateStore(projectDir, opts = {}) {
  const dir = resolveDataHome(projectDir, opts.env)
  mkdirSync(dir, { recursive: true })
  const engine = (opts.forceJsonl ? null : sqliteBackend(dir)) || jsonlBackend(dir)
  return {
    backend: engine.backend,
    file: engine.file,
    schemaVersion: STATE_SCHEMA_VERSION,
    record(entity, data = {}) {
      if (!isValidEntity(entity)) throw new Error(`entidade desconhecida: ${entity} (válidas: ${ENTITIES.join(", ")})`)
      const clean = sanitizeRecord(data)
      engine.insert(entity, new Date().toISOString(), clean)
      return clean
    },
    list(entity, { limit = 50 } = {}) {
      if (!isValidEntity(entity)) throw new Error(`entidade desconhecida: ${entity}`)
      return engine.list(entity, limit)
    },
    /** Resumo JSON para dashboard futuro: contagem + último evento por entidade. */
    summary() {
      const entities = Object.fromEntries(ENTITIES.map((e) => [e, engine.count(e)]))
      return { schemaVersion: STATE_SCHEMA_VERSION, backend: engine.backend, file: engine.file, entities }
    },
    close() { engine.close() },
  }
}

/** Grava um evento best-effort (produtores nunca quebram por causa do store). */
export function recordStateEvent(projectDir, entity, data, opts = {}) {
  try {
    const store = openStateStore(projectDir, opts)
    const out = store.record(entity, data)
    store.close()
    return out
  } catch { return null }
}
