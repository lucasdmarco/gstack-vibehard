/**
 * Claude Video spike (PRD49 S49.8).
 *
 * `bradautomates/claude-video` só vira capacidade Full disponível se um
 * benchmark REAL provar melhora sobre a baseline Graphify/media em precisão
 * de QA visual com timestamp, respeitando os orçamentos de token e limpeza.
 * Sem benchmark real injetado, permanece `documented_external_reference` —
 * NUNCA promovido por decreto. Nenhum benchmark foi rodado nesta sessão.
 */
export const CLAUDE_VIDEO_SCHEMA = "gstack.claude-video-spike.v1"

export const CLAUDE_VIDEO_CAPABILITY_STATUS = "documented_external_reference"

/** Só promove com evidência REAL: acurácia melhor E budgets de token/cleanup respeitados. */
export function evaluatePromotionThreshold({ benchmarkResult } = {}) {
  if (!benchmarkResult) return { status: "documented_external_reference" }
  const { claudeVideoAccuracy, baselineAccuracy, tokenBudgetOk, cleanupOk } = benchmarkResult
  const improved = claudeVideoAccuracy > baselineAccuracy
  const status = improved && tokenBudgetOk && cleanupOk ? "promoted_full_capability" : "documented_external_reference"
  return { status }
}

/** Status atual REAL desta sessão — sempre a referência documentada (sem benchmark rodado). */
export function claudeVideoCapabilityStatus() {
  return CLAUDE_VIDEO_CAPABILITY_STATUS
}
