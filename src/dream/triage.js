/**
 * PRD46 S46.1 — triagem determinística (§7.3): classifica um run em `skill|memory|skip
 * |undetermined` a partir de SINAIS TIPADOS, nunca de popularidade, tamanho de texto ou
 * "opinião" de LLM. Puro e desacoplado do candidate — o detector (S46.2) fornece os sinais.
 */

export const CLASSIFICATIONS = Object.freeze(["skill", "memory", "skip", "undetermined"])

const MIN_SKILL_STEPS = 2

/**
 * @param {{hasEvidence?:boolean, stepCount?:number, recurring?:boolean, verifiable?:boolean, oneOff?:boolean}} signals
 * @returns {"skill"|"memory"|"skip"|"undetermined"}
 */
export function classify(signals = {}) {
  const { hasEvidence = false, stepCount = 0, recurring = false, verifiable = false, oneOff = false } = signals
  if (!hasEvidence) return "undetermined"
  if (oneOff) return "skip"
  if (!verifiable) return "memory" // sem passing check confirmado, no máximo fato/memória
  if (stepCount >= MIN_SKILL_STEPS && recurring) return "skill"
  return "memory"
}

function statusFor(classification, hasEvidence, verifiable) {
  if (classification === "skip") return "skipped"
  if (!hasEvidence || !verifiable) return "tentative"
  if (classification === "skill" || classification === "memory") return "eligible"
  return "tentative"
}

/**
 * Deriva classificação + próximo status do candidate (§7.2) a partir dos mesmos sinais.
 * Sem evidência OU sem passing check verificável, o candidate NUNCA fica "eligible" —
 * no máximo "tentative" (ou "skipped" para eventos únicos sem chance de reuso).
 */
export function deriveStatus(signals = {}) {
  const classification = classify(signals)
  const { hasEvidence = false, verifiable = false } = signals
  return { classification, status: statusFor(classification, hasEvidence, verifiable) }
}
