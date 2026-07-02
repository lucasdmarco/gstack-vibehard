import { hasSecret } from "../security/redact.js"

/**
 * Schema do State Store operacional (PRD14 §4.4). Entidades project-scoped
 * para sessões, runs, serviços, worktrees, governança, gates, decisões e
 * work items. NUNCA grava secrets/env/tokens/transcripts (guard de redação).
 */

export const STATE_SCHEMA_VERSION = 1

export const ENTITIES = Object.freeze([
  "sessions",
  "workflow_runs",
  "runtime_services",
  "worktrees",
  "governance_events",
  "quality_gates",
  "decisions",
  "work_items",
])

// Chaves que NUNCA entram no store (mesmo que o produtor mande).
const FORBIDDEN_KEY = /(token|secret|password|passwd|api[-_]?key|cookie|authorization|bearer|credential|private[-_]?key|^env$|transcript)/i
const MAX_VALUE_CHARS = 2000 // anti-transcript: valor gigante é truncado

export function isValidEntity(entity) {
  return ENTITIES.includes(entity)
}

function sanitizeValue(v) {
  if (typeof v !== "string") return v
  if (hasSecret(v)) return "***REDACTED***"
  return v.length > MAX_VALUE_CHARS ? v.slice(0, MAX_VALUE_CHARS) + "…[truncado]" : v
}

/**
 * Sanitiza um registro ANTES de persistir: remove chaves proibidas, redige
 * valores com segredo detectável e trunca strings gigantes. Raso por design —
 * objetos aninhados são serializados e passam pela mesma régua como string.
 */
export function sanitizeRecord(data = {}) {
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (FORBIDDEN_KEY.test(k)) continue
    out[k] = typeof v === "object" && v !== null ? sanitizeValue(JSON.stringify(v)) : sanitizeValue(v)
  }
  return out
}
