/**
 * Delivery Scorecard (PRD42 S42.12). Transforma a evidência determinística do `proof`
 * num placar de entrega — MAS com uma invariante inegociável:
 *
 *   • A MÉDIA NUNCA ESCONDE UM P0. Existindo qualquer item P0 reprovado, o veredito é
 *     `blocked` — não importa quão alto seja o score dos demais.
 *   • Health pós-deploy SEM deploy = `not_applicable` — nunca conta como aprovado e
 *     nunca entra na média (N/A não é verde; herda a lição do S42.8).
 *
 * PURO / injetável.
 */
export const DELIVERY_SCORECARD_SCHEMA = "gstack.delivery-scorecard.v1"

const STATUS = { PASSED: "passed", FAILED: "failed", NOT_APPLICABLE: "not_applicable" }

/** Health pós-deploy: sem deploy ⇒ N/A (nunca verde). Com deploy ⇒ P0 (saudável×quebrado). */
function healthRow(deploy = {}) {
  if (!deploy || !deploy.happened) {
    return { id: "health-post-deploy", label: "Health pós-deploy", p0: false, status: STATUS.NOT_APPLICABLE, reason: "sem deploy — não avaliado" }
  }
  return { id: "health-post-deploy", label: "Health pós-deploy", p0: true, status: deploy.healthy ? STATUS.PASSED : STATUS.FAILED, reason: deploy.healthy ? "health check verde" : "health check falhou pós-deploy" }
}

/** N/A fica FORA da média (não infla nem desconta). */
function scoreOf(items) {
  const scored = items.filter((i) => i.status !== STATUS.NOT_APPLICABLE)
  const passed = scored.filter((i) => i.status === STATUS.PASSED).length
  return { passed, total: scored.length, pct: scored.length ? Math.round((100 * passed) / scored.length) : 0 }
}

const verdictFrom = (p0Failures, score) => {
  if (p0Failures.length > 0) return "blocked" // média NUNCA esconde P0
  return score.passed === score.total ? "ready" : "incomplete"
}

/** Monta o placar. `items` = [{ id, label, p0, status }]; `deploy` = { happened, healthy }. */
export function buildScorecard({ items = [], deploy = {} } = {}) {
  const all = [...items, healthRow(deploy)]
  const p0Failures = all.filter((i) => i.p0 && i.status === STATUS.FAILED)
  const score = scoreOf(all)
  return {
    schema: DELIVERY_SCORECARD_SCHEMA,
    verdict: verdictFrom(p0Failures, score),
    score,
    p0Failures: p0Failures.map((i) => i.id),
    items: all,
  }
}

// Checks do proof que são P0 (falha = bloqueio de entrega). graphify freshness é advisory.
const P0_CHECKS = new Set(["verify", "dreamAudit", "gitTree", "skillGates"])
const CHECK_LABELS = {
  verify: "Verificação (verify)", dreamAudit: "Dream audit (sem RISK/PLACEBO)",
  gitTree: "Árvore git limpa", skillGates: "Skill gates", graphifyFreshness: "Grafo atualizado",
}

const statusOf = (c) => (c && c.ok === true ? STATUS.PASSED : c && c.ok === false ? STATUS.FAILED : STATUS.NOT_APPLICABLE)

/** Adapta um resultado `gstack.proof.v1` em itens de placar (mesma evidência). */
export function scorecardFromProof(proof = {}, deploy = {}) {
  const checks = proof.checks || {}
  const items = Object.keys(CHECK_LABELS)
    .filter((id) => id in checks)
    .map((id) => ({ id, label: CHECK_LABELS[id], p0: P0_CHECKS.has(id), status: statusOf(checks[id]) }))
  return buildScorecard({ items, deploy })
}
