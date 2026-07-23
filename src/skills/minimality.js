import { PROTECTED_CONCERNS } from "./minimality-schema.js"

/**
 * Native minimality preflight/review gate (PRD49 S49.5).
 *
 * Bloqueia dependência/abstração nova SEM justificativa quando um caminho
 * local/nativo/stdlib já provado existe. NUNCA bloqueia um concern protegido
 * (segurança/validação/testes/a11y/observabilidade/escopo explícito do
 * usuário) — esses nunca esperam por uma "razão" registrada. Diff/LOC é só
 * sinal, nunca o veredito: `minimalityNeverOutranksCorrectness` garante que
 * código menor e QUEBRADO nunca supera código completo e verificado.
 */

function protectedConcernHit(decision) {
  const concerns = decision.protectedConcerns || []
  return concerns.length ? concerns[0] : null
}

function unexplainedDependency(decision) {
  return decision.introducesNewDependency === true && !decision.newDependencyReason
}

function redundantAbstraction(decision) {
  if (!decision.introducesNewAbstraction) return false
  const reuseAvailable = decision.existingReuse === true || decision.platformOrStdlib === true
  return reuseAvailable && decision.smallestCompleteApproach === false
}

/** Avalia uma decisão de implementação. PURO — nunca lê disco/rede. */
export function evaluateMinimality(decision = {}) {
  const concern = protectedConcernHit(decision)
  if (concern) return { verdict: "exempt", reason: `protected_concern:${concern}` }
  if (unexplainedDependency(decision)) return { verdict: "blocked", reason: "unexplained_new_dependency" }
  if (redundantAbstraction(decision)) return { verdict: "blocked", reason: "existing_reuse_available" }
  return { verdict: "pass" }
}

/**
 * Diff/LOC (`decision.smallestCompleteApproach` etc.) é só sinal — a correção
 * (testes/verify) SEMPRE vence. Minimality `blocked` nunca reescreve um
 * `correctnessVerdict:"passed"` como falho, e nunca resgata um "failed".
 */
export function minimalityNeverOutranksCorrectness({ correctnessVerdict }) {
  return correctnessVerdict
}

const STATUS_BY_VERDICT = Object.freeze({ pass: "passed", exempt: "passed", blocked: "failed" })

/** Item de scorecard NÃO-P0 (advisory) — minimality nunca gera um P0 falso sozinha. */
export function buildMinimalityReviewItem({ verdict, reason } = {}) {
  return { id: "minimality", label: "Minimality (dependência/abstração justificada)", p0: false, status: STATUS_BY_VERDICT[verdict] || "failed", reason: reason || null }
}

export { PROTECTED_CONCERNS }
