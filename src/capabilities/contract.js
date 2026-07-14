/**
 * Capability Truth Contract (PRD42 §5.11 / S42.0B). Fonte ÚNICA da verdade de uma
 * capacidade: instalação, runtime, enforcement, suporte por plataforma e a EVIDÊNCIA.
 * Invariante central: `claim: real` SÓ com backend EXERCITADO (runtime healthy + probe +
 * controle negativo). Presença de arquivo/config é no máximo `configured` → `not_proved`.
 * Nenhum booleano `active=true` deriva de presença em disco. Sucesso numa plataforma NÃO
 * promove outra.
 */
export const CAPABILITY_CONTRACT_SCHEMA = "gstack.capability-contract.v1"

export const OBLIGATIONS = Object.freeze(["required", "optional", "experimental", "excluded"])
export const INSTALL_STATES = Object.freeze(["absent", "configured", "installed", "failed"])
export const RUNTIME_STATES = Object.freeze(["not_started", "healthy", "degraded", "failed", "unsupported"])
export const ENFORCEMENTS = Object.freeze(["real_hooks", "adapter_enforced", "advisory", "none"])
export const CLAIMS = Object.freeze(["real", "not_proved", "degraded", "unsupported", "excluded"])

const REQUIRED_FIELDS = Object.freeze([
  "component", "mode", "obligation", "installState", "runtimeState",
  "enforcement", "platformSupport", "evidence", "claim",
])

const isBlank = (v) => v === undefined || v === null
const enumError = (val, allow, key) => (val && !allow.includes(val) ? [`${key}:${val}`] : [])

/** Valida a forma do contrato (campos obrigatórios + enums conhecidos). */
export function validateCapabilityContract(c) {
  if (!c || typeof c !== "object") return { valid: false, errors: ["not_object"] }
  const errors = REQUIRED_FIELDS.filter((f) => isBlank(c[f])).map((f) => `missing:${f}`)
  errors.push(...enumError(c.obligation, OBLIGATIONS, "obligation"))
  errors.push(...enumError(c.claim, CLAIMS, "claim"))
  return { valid: errors.length === 0, errors }
}

const platformClaim = (c) => (c.platform && c.platformSupport ? c.platformSupport[c.platform] : undefined)
// Backend exercitado de verdade = probe vivo + CONTROLE NEGATIVO (prova que a capacidade
// realmente age; sem o negativo, "healthy" só diz que subiu, não que governa/funciona).
const hasBackendEvidence = (e) => Boolean(e && e.probe && e.negativeControl)

/**
 * Deriva o `claim` HONESTO do contrato. `real` exige runtime healthy + evidência de backend
 * (probe + controle negativo). Excluído/plataforma-sem-suporte/degradado têm precedência.
 */
export function gradeCapabilityClaim(c) {
  if (c.obligation === "excluded") return "excluded"
  if (platformClaim(c) === "unsupported") return "unsupported"
  if (c.runtimeState === "degraded") return "degraded"
  if (c.runtimeState === "healthy" && hasBackendEvidence(c.evidence)) return "real"
  return "not_proved"
}
