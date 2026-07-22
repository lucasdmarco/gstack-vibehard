/**
 * PRD48 S48.5 — usage accounting tipado. `unknown` NUNCA carrega um número (não vira 0
 * nem ilimitado — `value` fica `null` sempre); estimativa NUNCA se apresenta como
 * economia comprovada (mesma disciplina do `handoff.js`, S42.10 — token é sempre
 * `estimated` até haver medição real do provider).
 */
export const USAGE_ACCOUNTING_SCHEMA = "gstack.usage-accounting.v1"
export const USAGE_QUALITIES = Object.freeze(["measured", "provider_reported", "estimated", "unknown"])

/** Um valor de uso TIPADO — `quality:"unknown"` nunca carrega número, mesmo se um for passado. */
export function usageValue(value, quality) {
  if (!USAGE_QUALITIES.includes(quality)) throw new Error(`quality de uso inválida: ${quality}`)
  return { value: quality === "unknown" ? null : value, quality }
}

/** Estimativa heurística (~4 chars/token) — SEMPRE `estimated`, nunca "medido". */
export function estimateTokenUsage(text) {
  return usageValue(Math.ceil(String(text || "").length / 4), "estimated")
}

/** Usage reportado pela API oficial do provider. Sem valor real -> `unknown`, nunca inventado. */
export function providerReportedUsage(value) {
  return typeof value === "number" ? usageValue(value, "provider_reported") : usageValue(null, "unknown")
}
