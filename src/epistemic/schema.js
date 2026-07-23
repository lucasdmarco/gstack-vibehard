/**
 * Schema do resultado epistêmico (PRD50 S50.1, §10) — `gstack.epistemic-review.v1`.
 *
 * Puro: vocabulário + construção + validação. Nenhum I/O, nenhuma decisão de
 * protocolo (isso é `protocol.js`). Os invariantes de §10.1 são aplicados aqui
 * porque é o único ponto por onde todo resultado passa.
 *
 * Invariante que mais importa: status/confidence NUNCA valem por decreto —
 * `supported` exige suporte, `high` exige suporte. Sem isso o schema viraria
 * um lugar bonito pra registrar chute.
 */
export const EPISTEMIC_REVIEW_SCHEMA = "gstack.epistemic-review.v1"

export const LEVELS = Object.freeze(["sanity", "grounded", "adversarial"])
export const CLAIM_KINDS = Object.freeze(["fact", "inference", "hypothesis", "recommendation"])
export const CLAIM_STATUS = Object.freeze(["supported", "refuted", "ambiguous", "inconclusive", "not_applicable", "needs_expert"])
export const VERDICTS = Object.freeze(["supported", "refuted", "mixed", "inconclusive", "needs_expert"])
export const CONFIDENCE = Object.freeze(["low", "medium", "high"])
export const STOP_REASONS = Object.freeze(["sufficient", "cap", "same_failure", "insufficient_data", "expert_required"])

/** Monta um review com defaults honestos (nada "completo"/"planejado" por omissão). */
export function buildReview({
  reviewId = null, question = "", level = "grounded", classificationReasons = [],
  claims = [], sources = [], tools = [], experimentPlan = null,
  protocol = {}, notPerformed = [], tokenBudget = {}, provenance = {},
} = {}) {
  return {
    schemaVersion: EPISTEMIC_REVIEW_SCHEMA,
    reviewId, question, level, classificationReasons,
    claims, sources, tools, experimentPlan,
    protocol: { completed: false, iterations: 0, stopReason: null, ...protocol },
    verdict: verdictFromClaims(claims),
    notPerformed, tokenBudget, provenance,
  }
}

const hasSupport = (c) => Array.isArray(c.support) && c.support.length > 0

// Cada regra devolve uma razão quando VIOLADA (null = ok). §10.1.
const CLAIM_RULES = Object.freeze([
  { id: "kind", check: (c) => !CLAIM_KINDS.includes(c.kind), reason: (c) => `claim ${c.id}: kind inválido (${c.kind})` },
  { id: "status", check: (c) => !CLAIM_STATUS.includes(c.status), reason: (c) => `claim ${c.id}: status inválido (${c.status})` },
  { id: "confidence", check: (c) => c.confidence != null && !CONFIDENCE.includes(c.confidence), reason: (c) => `claim ${c.id}: confidence inválida (${c.confidence})` },
  { id: "high-needs-support", check: (c) => c.confidence === "high" && !hasSupport(c), reason: (c) => `claim ${c.id}: confidence 'high' sem suporte verificável` },
  { id: "supported-needs-support", check: (c) => c.status === "supported" && !hasSupport(c), reason: (c) => `claim ${c.id}: status supported sem suporte` },
])

function claimReasons(claims) {
  const out = []
  for (const c of claims || []) {
    for (const rule of CLAIM_RULES) if (rule.check(c)) out.push(rule.reason(c))
  }
  return out
}

const stopReasonOf = (review) => (review.protocol ? review.protocol.stopReason : null)

// Regras de nível-review (mesma forma das CLAIM_RULES: viola → devolve razão).
const REVIEW_RULES = Object.freeze([
  { check: (r) => r.schemaVersion !== EPISTEMIC_REVIEW_SCHEMA, reason: (r) => `schemaVersion inválido: ${r.schemaVersion}` },
  { check: (r) => !LEVELS.includes(r.level), reason: (r) => `level inválido: ${r.level}` },
  { check: (r) => r.verdict != null && !VERDICTS.includes(r.verdict), reason: (r) => `verdict inválido: ${r.verdict}` },
  { check: (r) => stopReasonOf(r) != null && !STOP_REASONS.includes(stopReasonOf(r)), reason: (r) => `stopReason inválido: ${stopReasonOf(r)}` },
])

/** Valida o review inteiro. → { ok, reasons }. */
export function validateReview(review) {
  if (!review || typeof review !== "object") return { ok: false, reasons: ["review ausente"] }
  const reasons = REVIEW_RULES.filter((rule) => rule.check(review)).map((rule) => rule.reason(review))
  reasons.push(...claimReasons(review.claims))
  return { ok: reasons.length === 0, reasons }
}

// Precedência do veredito, do mais forte ao mais fraco. `mixed` antes de
// `refuted` porque supported+refuted convivendo é misto, não refutação.
const VERDICT_RULES = Object.freeze([
  { verdict: "needs_expert", when: (s) => s.has("needs_expert") },
  { verdict: "mixed", when: (s) => s.has("supported") && s.has("refuted") },
  { verdict: "refuted", when: (s) => s.has("refuted") },
  { verdict: "inconclusive", when: (s) => s.has("inconclusive") || s.has("ambiguous") },
  { verdict: "supported", when: (s) => s.has("supported") },
])

/**
 * Veredito agregado. Nunca otimista: sem claim nenhum → `inconclusive`
 * (jamais `supported`), e qualquer necessidade de especialista domina.
 */
export function verdictFromClaims(claims = []) {
  if (!claims.length) return "inconclusive"
  const statuses = new Set(claims.map((c) => c.status))
  const hit = VERDICT_RULES.find((rule) => rule.when(statuses))
  return hit ? hit.verdict : "inconclusive"
}

/**
 * Exit code (§13.4). `refuted`/`inconclusive`/`needs_expert` são conclusões
 * HONESTAS do protocolo → 0. Só `--strict`, quando o consumidor exige
 * `supported`, devolve 3.
 */
export function exitCodeForVerdict(verdict, { strict = false } = {}) {
  if (strict && verdict !== "supported") return 3
  return 0
}
