import { tierSpec } from "./quality-profile.js"

/**
 * Budget Policy (PRD42 S42.8). Cada tier tem um orçamento de tempo (`maxSeconds`). O gasto REAL é
 * medido (não estimado sem base). Estourar o orçamento é uma DECISÃO tipada — nunca ignorado.
 * `unknown` (sem medição) NUNCA vira "dentro do orçamento". PURO/testável.
 */
export const BUDGET_POLICY_SCHEMA = "gstack.budget-policy.v1"

/**
 * Avalia o gasto contra o orçamento do tier. `elapsedSeconds` null/negativo ⇒ `unknown` (não ok).
 * Retorna { ok, status: within|over|unknown, overBy, maxSeconds }.
 */
export function evaluateBudget(tier, elapsedSeconds) {
  const { budget } = tierSpec(tier)
  const max = budget.maxSeconds
  if (typeof elapsedSeconds !== "number" || elapsedSeconds < 0) {
    return { schema: BUDGET_POLICY_SCHEMA, tier, status: "unknown", ok: false, maxSeconds: max, reason: "gasto não medido — unknown nunca é 'dentro do orçamento'" }
  }
  const over = elapsedSeconds > max
  return { schema: BUDGET_POLICY_SCHEMA, tier, status: over ? "over" : "within", ok: !over, overBy: over ? elapsedSeconds - max : 0, maxSeconds: max, elapsedSeconds }
}
