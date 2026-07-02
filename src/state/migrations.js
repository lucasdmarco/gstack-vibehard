import { ENTITIES, STATE_SCHEMA_VERSION } from "./schema.js"

/**
 * Migrações do state.db (backend sqlite). Cada migração é idempotente por
 * versão; a versão corrente vive em `gstack_meta`. O backend JSONL não precisa
 * de migração (schema por linha). Journals existentes (.gstack/plans/*)
 * NUNCA são tocados — o store é aditivo.
 */

export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    up(db) {
      db.exec("CREATE TABLE IF NOT EXISTS gstack_meta (key TEXT PRIMARY KEY, value TEXT)")
      for (const e of ENTITIES) {
        db.exec(`CREATE TABLE IF NOT EXISTS ${e} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          data TEXT NOT NULL
        )`)
      }
    },
  },
])

export function currentVersion(db) {
  try {
    const row = db.prepare("SELECT value FROM gstack_meta WHERE key = 'schema_version'").get()
    return row ? parseInt(row.value, 10) || 0 : 0
  } catch { return 0 }
}

/** Aplica as migrações pendentes. Retorna a versão final. */
export function migrate(db) {
  for (const m of MIGRATIONS) {
    if (currentVersion(db) >= m.version) continue
    m.up(db)
    db.prepare("INSERT OR REPLACE INTO gstack_meta (key, value) VALUES ('schema_version', ?)").run(String(m.version))
  }
  return STATE_SCHEMA_VERSION
}
