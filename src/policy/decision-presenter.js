/**
 * PRD48 S48.4 — presenter de decisão. NUNCA decide sozinho: recebe a decisão JÁ REAL da
 * Policy DSL (`evaluate()`, `policy/schema.js`) e traduz em ação/alvo/risco/policy +
 * escolhas seguras. `deny` NUNCA aparece como opção aprovável. Categorias sensíveis
 * (destrutivo/secret/rede/cloud/deploy/fora-do-projeto) nunca permitem persistir
 * "permitir sempre" — mudança de policy permanente continua exclusiva do comando `policy`.
 */
export const DECISION_PRESENTER_SCHEMA = "gstack.decision-presenter.v1"

export const SENSITIVE_CATEGORIES = Object.freeze([
  "destructive", "secret", "network_sensitive", "cloud_handoff", "deploy", "outside_project",
])

/** Categoria sensível NUNCA pode virar "permitir sempre" persistido. */
export function canPersistChoice(category) {
  return !SENSITIVE_CATEGORIES.includes(category)
}

/** `--yes` (aprovação em lote) NUNCA ultrapassa uma categoria sensível — mesma lista,
 * proposito distinto: aqui é sobre aprovação de UMA execução, não persistência. */
export function yesFlagBypassesGate(category) {
  return !SENSITIVE_CATEGORIES.includes(category)
}

const CHOICES_BY_DECISION = Object.freeze({
  ask: Object.freeze(["allow_once", "deny_and_pause", "view_details"]),
  deny: Object.freeze(["acknowledge_denied", "view_details"]),
  allow: Object.freeze(["proceed"]),
  default: Object.freeze(["allow_once", "deny_and_pause", "view_details"]),
})

/** Traduz a decisão real (`evaluate()`) em presenter humano — nunca decide, só explica. */
export function presentDecision({ action, target, risk, evaluation } = {}) {
  const { decision, rule } = evaluation
  return {
    schemaVersion: DECISION_PRESENTER_SCHEMA,
    action, target, risk,
    policy: { decision, rule },
    choices: [...(CHOICES_BY_DECISION[decision] || CHOICES_BY_DECISION.default)],
  }
}
