/**
 * PRD48 S48.5 — resumo de sessão (contrato §7.5): mostra o que será gasto e por que a
 * execução será sequencial ou paralela. Reusa `quotaSufficient` (adaptive-parallel.js,
 * PRD42 S42.11 — quota unknown NUNCA suficiente) e a disciplina de qualidade tipada de
 * `accounting.js` — nunca inventa número, nunca esconde que algo não foi medido.
 */
import { usageValue, providerReportedUsage, USAGE_ACCOUNTING_SCHEMA } from "./accounting.js"
import { quotaSufficient } from "../project-plan/adaptive-parallel.js"

function contextAvoidedFor(contextPackBytes, fullBytes) {
  if (contextPackBytes == null || fullBytes == null || fullBytes <= contextPackBytes) return usageValue(null, "unknown")
  return usageValue(fullBytes - contextPackBytes, "estimated")
}

function quotaFor(quota) {
  const q = quotaSufficient(quota)
  return {
    available: typeof quota.available === "number" ? quota.available : null,
    quality: typeof quota.available === "number" ? "provider_reported" : "unknown",
    sufficient: q.sufficient,
  }
}

/**
 * Monta o resumo tipado. `parallelRecommendation` reflete `quotaSufficient` de verdade —
 * `ask_user` sempre que a quota não é conhecida/suficiente, nunca decide sozinho a paralelizar.
 */
export function buildSessionSummary({ inputTokens = null, outputTokens = null, contextPackBytes = null, fullBytes = null, quota = {} } = {}) {
  const q = quotaFor(quota)
  return {
    schemaVersion: USAGE_ACCOUNTING_SCHEMA,
    inputTokens: providerReportedUsage(inputTokens ?? undefined),
    outputTokens: providerReportedUsage(outputTokens ?? undefined),
    contextAvoided: contextAvoidedFor(contextPackBytes, fullBytes),
    quota: { available: q.available, quality: q.quality },
    parallelRecommendation: q.sufficient ? "parallel_ok" : "ask_user",
  }
}
