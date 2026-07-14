/**
 * Artifact Review Pipeline (PRD42 S42.5). Um artefato passa por revisões em estágios
 * `spec → plan → compliance → quality`. Dois invariantes fecham a porta contra teatro de revisão:
 *
 *  1. PRODUTOR ≠ REVISOR — quem produziu o artefato não pode aprovar o próprio trabalho.
 *  2. Revisão de LLM é ADVISORY — nunca BLOQUEIA por si só; só uma revisão DETERMINÍSTICA (ex.:
 *     compliance conferido contra os aceites do brief) pode gatear (`changes_requested`).
 *
 * PURO/testável: sem LLM, sem I/O.
 */
export const REVIEW_SCHEMA = "gstack.artifact-review.v1"
export const REVIEW_STAGES = Object.freeze(["spec", "plan", "compliance", "quality"])
export const REVIEW_KINDS = Object.freeze(["deterministic", "llm"])
export const REVIEW_VERDICTS = Object.freeze(["approved", "changes_requested", "advisory"])

/** Valida um review: estágio conhecido, producer/reviewer presentes e DISTINTOS. */
export function validateReview(review = {}) {
  const errors = []
  if (!REVIEW_STAGES.includes(review.stage)) errors.push(`stage inválido: ${review.stage}`)
  if (!review.producer || !review.reviewer) errors.push("producer e reviewer são obrigatórios")
  if (review.producer && review.producer === review.reviewer) errors.push("producer não pode revisar o próprio artefato")
  return { ok: errors.length === 0, errors }
}

/** Só review DETERMINÍSTICO com `changes_requested` gateia. LLM é sempre advisory (nunca bloqueia). */
export function reviewGates(review) {
  if (review.kind === "llm") return false
  return review.verdict === "changes_requested"
}

/**
 * Agrega o pipeline de revisões. `ok` só quando nenhum review é inválido (producer=reviewer etc.)
 * E nenhum review determinístico está gateando. Reviews de LLM entram como `advisory` (registrados,
 * nunca bloqueantes).
 */
export function aggregateReviews(reviews = []) {
  const invalid = reviews.map((r) => ({ r, v: validateReview(r) })).filter((x) => !x.v.ok)
  const gating = reviews.filter(reviewGates)
  return {
    schema: REVIEW_SCHEMA,
    ok: invalid.length === 0 && gating.length === 0,
    invalid: invalid.map((x) => ({ stage: x.r.stage, errors: x.v.errors })),
    gating: gating.map((r) => r.stage),
    advisory: reviews.filter((r) => r.kind === "llm").map((r) => ({ stage: r.stage, verdict: r.verdict })),
  }
}
