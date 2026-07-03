/**
 * modelPolicy (PRD18 Sprint 2 / PRD15 §7.4): roteamento AGNÓSTICO de modelo por
 * tipo de tarefa. Nenhum modelo externo vira obrigatório — sem tier configurado,
 * o fallback é LOCAL/determinístico (o gate continua decidindo, não a LLM).
 */

export const MODEL_POLICY_SCHEMA_VERSION = "gstack.modelpolicy.v1"

export const TASK_KINDS = Object.freeze(["explore", "review", "implement", "architecture", "security"])
export const TIERS = Object.freeze(["cheap", "default", "strong"])

export const DEFAULT_MODEL_POLICY = Object.freeze({
  schemaVersion: MODEL_POLICY_SCHEMA_VERSION,
  modelPolicy: Object.freeze({
    explore: "cheap",
    review: "cheap",
    implement: "default",
    architecture: "strong",
    security: "strong",
  }),
  // Mapeamento tier → modelo é do USUÁRIO (opcional). Vazio = fallback local.
  models: Object.freeze({}),
})

function validateRoutes(mp, errors) {
  for (const [kind, tier] of Object.entries(mp)) {
    if (!TASK_KINDS.includes(kind)) errors.push(`tipo de tarefa desconhecido: ${kind}`)
    if (!TIERS.includes(tier)) errors.push(`tier inválido em ${kind}: ${tier} (use ${TIERS.join("|")})`)
  }
}

const isObj = (x) => !!x && typeof x === "object"

/** Valida shape. Não lança. */
export function validateModelPolicy(obj) {
  if (!isObj(obj)) return { valid: false, errors: ["model-policy não é objeto"] }
  const errors = []
  if (!isObj(obj.modelPolicy)) errors.push("modelPolicy ausente")
  else validateRoutes(obj.modelPolicy, errors)
  if (obj.models !== undefined && !isObj(obj.models)) errors.push("models deve ser objeto tier→modelo")
  return { valid: errors.length === 0, errors }
}
