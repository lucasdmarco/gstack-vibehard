/**
 * PRD51 S51.8.3 — avaliação cega dupla, concordância e adjudicação
 * (§51.8, ações 2, 3 e 8).
 *
 * O PRD é explícito: a validação da fatia subjetiva do PRD50 não pode ser
 * fechada por autoavaliação (§2.3 item 1). Este módulo constrói a MECÂNICA
 * dessa validação e a torna verificável — mas **não produz rótulo nenhum**.
 * Os rótulos humanos reais continuam pendentes e declarados como tal; fabricar
 * rótulos aqui seria exatamente a circularidade que o protocolo rejeita.
 *
 * O que é enforced:
 *  - **≥2 avaliadores independentes** (ação 2). Um só avaliador nunca fecha.
 *  - **Concordância medida e divergência adjudicada** (ação 3). Divergência sem
 *    adjudicação registrada fica `unresolved` — nunca é resolvida por maioria
 *    silenciosa nem pelo primeiro rótulo que apareceu.
 *  - **Anti-autoavaliação** (ação 8): rótulo produzido pelo próprio sistema sob
 *    teste — ou por quem o construiu — é INELEGÍVEL. Não "conta menos": não
 *    conta.
 *  - **Cegueira**: o rótulo não pode carregar de onde veio a resposta, senão a
 *    avaliação deixa de ser cega.
 */
export const BLIND_EVALUATION_SCHEMA = "gstack.blind-evaluation.v1"

/** Mínimo do §51.8 ação 2. Menos que isso não é avaliação independente. */
export const MIN_INDEPENDENT_EVALUATORS = 2

/**
 * Os cinco estados que o §4.6 do PRD51 pede. `pendingHumanValidation` e
 * `unobservableByDesign` já vieram no S51.8.1; `validated`/`rejected` só podem
 * ser alcançados por este pipeline, e `outOfScope` é decisão declarada.
 */
export const CLAIM_STATES = Object.freeze([
  "validated", "rejected", "pendingHumanValidation", "unobservableByDesign", "outOfScope",
])

// Campos que revelariam a origem da resposta e quebrariam a cegueira.
const BLINDNESS_LEAK_KEYS = Object.freeze(["systemId", "producedBy", "modelId", "harness", "isGstack"])

/** Rótulos que vazam a origem da resposta. Lista os ofensores, não só um booleano. */
export function blindnessViolations(labels = []) {
  return labels.flatMap((l) => {
    const leaked = BLINDNESS_LEAK_KEYS.filter((k) => l[k] !== undefined)
    return leaked.length ? [{ caseId: l.caseId, evaluatorId: l.evaluatorId, leaked }] : []
  })
}

/**
 * Ação 8. Inelegível quando: é o próprio sistema sob teste, é um modelo com o
 * mesmo `modelId` do avaliado, ou é quem construiu o sistema. Sem `id`, também
 * inelegível — avaliador não-identificável não sustenta independência.
 */
const INELIGIBILITY_RULES = Object.freeze([
  { reason: "evaluator_without_identity", hit: (ev) => !ev.id },
  { reason: "authored_the_system_under_test", hit: (ev) => ev.authoredSystem === true },
  { reason: "same_model_as_system_under_test", hit: (ev, sut) => ev.kind === "model" && Boolean(ev.modelId) && ev.modelId === sut.modelId },
  { reason: "is_the_system_under_test", hit: (ev, sut) => ev.id === sut.id },
])

export function evaluatorEligibility(evaluator = {}, systemUnderTest = {}) {
  const broken = INELIGIBILITY_RULES.find((r) => r.hit(evaluator, systemUnderTest))
  return broken ? { eligible: false, reason: broken.reason } : { eligible: true, reason: null }
}

/** Avaliadores elegíveis e distintos entre si. */
export function independentEvaluators(evaluators = [], systemUnderTest = {}) {
  const seen = new Set()
  const eligible = []
  const rejected = []
  for (const ev of evaluators) {
    const verdict = evaluatorEligibility(ev, systemUnderTest)
    if (!verdict.eligible) { rejected.push({ id: ev.id ?? null, reason: verdict.reason }); continue }
    if (seen.has(ev.id)) { rejected.push({ id: ev.id, reason: "duplicate_evaluator" }); continue }
    seen.add(ev.id)
    eligible.push(ev)
  }
  return { eligible, rejected }
}

const labelsByCase = (labels) => labels.reduce((acc, l) => {
  (acc[l.caseId] ||= []).push(l)
  return acc
}, {})

/**
 * Kappa de Cohen para dois avaliadores. Devolve `null` quando não é definível
 * (sem itens, ou concordância esperada = 1 porque todos usaram uma só
 * categoria) — jamais um número inventado para preencher a métrica.
 */
export function cohenKappa(a = [], b = []) {
  if (a.length === 0 || a.length !== b.length) return null
  const n = a.length
  const agree = a.filter((v, i) => v === b[i]).length / n
  const cats = new Set([...a, ...b])
  let expected = 0
  for (const c of cats) {
    expected += (a.filter((v) => v === c).length / n) * (b.filter((v) => v === c).length / n)
  }
  if (expected === 1) return null
  return (agree - expected) / (1 - expected)
}

/**
 * Concordância por caso.
 *
 * O critério é **≥2 avaliadores independentes por caso**, e NÃO "todos os
 * elegíveis rotularam tudo". A distinção é real e foi achada por um controle
 * negativo: um adjudicador terceiro é elegível mas normalmente NÃO rotula o
 * corpus — só desempata. Exigir cobertura de todos os elegíveis faria a
 * simples presença de um adjudicador marcar cada caso como sub-coberto.
 *
 * Caso rotulado por um só avaliador entra em `insufficientCoverage`, nunca em
 * `agreed`.
 */
export function agreementReport({ labels = [], evaluatorIds = [] } = {}) {
  const eligibleLabels = labels.filter((l) => evaluatorIds.includes(l.evaluatorId))
  const grouped = labelsByCase(eligibleLabels)
  const agreed = []
  const diverged = []
  const insufficientCoverage = []
  for (const [caseId, ls] of Object.entries(grouped)) {
    const raters = new Set(ls.map((l) => l.evaluatorId))
    if (raters.size < MIN_INDEPENDENT_EVALUATORS) { insufficientCoverage.push(caseId); continue }
    const values = new Set(ls.map((l) => l.value))
    ;(values.size === 1 ? agreed : diverged).push(caseId)
  }
  const comparable = [...agreed, ...diverged].sort()
  // Quem de fato rotulou (não quem seria elegível). Kappa de Cohen só existe
  // para exatamente 2 avaliadores — com 3+, reportamos `null` em vez de
  // escolher um par arbitrário e chamar de "a" concordância.
  const raters = [...new Set(eligibleLabels.map((l) => l.evaluatorId))].sort()
  const kappa = raters.length === 2
    ? cohenKappa(
      comparable.map((c) => grouped[c].find((l) => l.evaluatorId === raters[0])?.value),
      comparable.map((c) => grouped[c].find((l) => l.evaluatorId === raters[1])?.value),
    )
    : null
  return {
    agreed, diverged, insufficientCoverage, raters,
    rawAgreement: comparable.length ? agreed.length / comparable.length : null,
    kappa,
  }
}

/**
 * Ação 3. Divergência só é resolvida por adjudicação REGISTRADA de um terceiro
 * — o adjudicador não pode ser um dos dois que divergiram (seria voto de
 * desempate do próprio interessado) e precisa dar um motivo.
 */
const ADJUDICATION_DEFECTS = Object.freeze([
  { reason: "no_adjudication_recorded", hit: (adj) => !adj },
  { reason: "adjudicator_without_identity", hit: (adj) => !adj.adjudicatorId },
  { reason: "adjudicator_was_one_of_the_raters", hit: (adj, raters) => raters.has(adj.adjudicatorId) },
  { reason: "adjudication_without_rationale", hit: (adj) => !adj.rationale },
])

export function adjudicateDivergences({ diverged = [], adjudications = [], labels = [] } = {}) {
  const byCase = labelsByCase(labels)
  const resolved = []
  const unresolved = []
  for (const caseId of diverged) {
    const adj = adjudications.find((a) => a.caseId === caseId)
    const raters = new Set((byCase[caseId] || []).map((l) => l.evaluatorId))
    const defect = ADJUDICATION_DEFECTS.find((d) => d.hit(adj, raters))
    if (defect) unresolved.push({ caseId, reason: defect.reason })
    else resolved.push({ caseId, value: adj.value, adjudicatorId: adj.adjudicatorId })
  }
  return { resolved, unresolved }
}

// Cada furo do pipeline com o nome que aparece no veredito. `insufficient_
// independent_evaluators` se mede em quem ROTULOU, não em quem estava
// disponível: lista longa de elegíveis com um rotulador só não é avaliação
// independente.
const PIPELINE_DEFECTS = Object.freeze([
  { name: "blindness_violated", hit: (c) => c.leaks.length > 0 },
  { name: "insufficient_independent_evaluators", hit: (c) => c.evaluatorIds.length < MIN_INDEPENDENT_EVALUATORS || c.agreement.raters.length < MIN_INDEPENDENT_EVALUATORS },
  { name: "no_labelable_corpus", hit: (c) => c.labelableIds.length === 0 },
  { name: "incomplete_coverage", hit: (c) => c.uncovered.length > 0 },
  { name: "cases_labeled_by_single_evaluator", hit: (c) => c.agreement.insufficientCoverage.length > 0 },
  { name: "unresolved_divergences", hit: (c) => c.adjudication.unresolved.length > 0 },
])
const pipelineProblems = (ctx) => PIPELINE_DEFECTS.filter((d) => d.hit(ctx)).map((d) => d.name)

/**
 * Veredito do pipeline. `complete` exige: cegueira preservada, ≥2 avaliadores
 * independentes, cobertura total do conjunto rotulável e nenhuma divergência
 * sem adjudicação válida. Qualquer furo devolve o motivo — nunca um `false`
 * mudo.
 */
export function blindEvaluationVerdict({ evaluators = [], labels = [], adjudications = [], systemUnderTest = {}, labelableIds = [] } = {}) {
  const leaks = blindnessViolations(labels)
  const { eligible, rejected } = independentEvaluators(evaluators, systemUnderTest)
  const evaluatorIds = eligible.map((e) => e.id)
  const agreement = agreementReport({ labels, evaluatorIds })
  const adjudication = adjudicateDivergences({ diverged: agreement.diverged, adjudications, labels })
  const covered = new Set(labels.filter((l) => evaluatorIds.includes(l.evaluatorId)).map((l) => l.caseId))
  const uncovered = labelableIds.filter((id) => !covered.has(id))
  const problems = pipelineProblems({ leaks, evaluatorIds, agreement, adjudication, labelableIds, uncovered })
  return {
    schemaVersion: BLIND_EVALUATION_SCHEMA,
    complete: problems.length === 0,
    problems,
    evaluators: { eligible: evaluatorIds, rejected },
    agreement,
    adjudication,
    blindnessViolations: leaks,
    uncovered,
  }
}

/**
 * Estado final do claim. `validated`/`rejected` SÓ saem de um pipeline
 * `complete`; qualquer outra situação continua `pendingHumanValidation`. Um
 * claim declarado fora de escopo ou estruturalmente inobservável nunca entra
 * no pipeline.
 */
const pendingReason = (verdict) => (verdict ? verdict.problems.join(", ") : "nenhuma avaliação cega registrada")

const STATE_RULES = Object.freeze([
  { hit: (claim) => claim.outOfScope === true, state: (claim) => ({ state: "outOfScope", reason: claim.outOfScopeReason || "declarado fora de escopo" }) },
  { hit: (claim) => claim.blockedBy === "not_measurable_by_design", state: (claim) => ({ state: "unobservableByDesign", reason: claim.missing || null }) },
  { hit: (claim, verdict) => !verdict?.complete, state: (claim, verdict) => ({ state: "pendingHumanValidation", reason: pendingReason(verdict) }) },
])

export function resolveClaimState({ claim = {}, verdict = null } = {}) {
  const rule = STATE_RULES.find((r) => r.hit(claim, verdict))
  if (rule) return rule.state(claim, verdict)
  return { state: claim.supportedByLabels === false ? "rejected" : "validated", reason: null }
}
