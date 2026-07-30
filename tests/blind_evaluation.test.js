import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.8.3 — ações 2, 3 e 8 do Sprint 51.8.
 *
 * O módulo constrói a MECÂNICA da avaliação cega dupla e a torna verificável,
 * mas não produz rótulo nenhum: os rótulos humanos reais continuam pendentes e
 * declarados. Fabricar rótulos aqui seria exatamente a circularidade que o
 * PRD50 §2.3 item 1 rejeita — e é isso que os controles negativos travam.
 */

const SUT = { id: "gstack", modelId: "modelo-avaliado" }
const A = { id: "aval-a", kind: "human" }
const B = { id: "aval-b", kind: "human" }
const C = { id: "aval-c", kind: "human" }
const CASOS = ["c1", "c2", "c3"]
const lbl = (evaluatorId, caseId, value) => ({ evaluatorId, caseId, value })

// ── ação 8: anti-autoavaliação ───────────────────────────────────────────
test("AÇÃO 8: modelo com o MESMO modelId do sistema avaliado é INELEGÍVEL (não 'conta menos')", async () => {
  const { evaluatorEligibility } = await imp("src/epistemic/blind-evaluation.js")
  const r = evaluatorEligibility({ id: "x", kind: "model", modelId: "modelo-avaliado" }, SUT)
  assert.equal(r.eligible, false)
  assert.equal(r.reason, "same_model_as_system_under_test")
})

test("AÇÃO 8: quem CONSTRUIU o sistema é inelegível", async () => {
  const { evaluatorEligibility } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(evaluatorEligibility({ id: "autor", kind: "human", authoredSystem: true }, SUT).reason, "authored_the_system_under_test")
})

test("AÇÃO 8: o próprio sistema sob teste é inelegível", async () => {
  const { evaluatorEligibility } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(evaluatorEligibility({ id: "gstack", kind: "model" }, SUT).reason, "is_the_system_under_test")
})

test("avaliador sem identidade é inelegível (independência não-verificável)", async () => {
  const { evaluatorEligibility } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(evaluatorEligibility({ kind: "human" }, SUT).reason, "evaluator_without_identity")
})

test("modelo DIFERENTE do avaliado é elegível (a regra é circularidade, não 'nada de modelo')", async () => {
  const { evaluatorEligibility } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(evaluatorEligibility({ id: "outro", kind: "model", modelId: "outro-modelo" }, SUT).eligible, true)
})

test("independentEvaluators desduplica e reporta o motivo de cada rejeição", async () => {
  const { independentEvaluators } = await imp("src/epistemic/blind-evaluation.js")
  const r = independentEvaluators([A, B, A, { id: "gstack" }], SUT)
  assert.deepEqual(r.eligible.map((e) => e.id), ["aval-a", "aval-b"])
  assert.deepEqual(r.rejected.map((x) => x.reason), ["duplicate_evaluator", "is_the_system_under_test"])
})

// ── ação 2: mínimo de dois ───────────────────────────────────────────────
test("AÇÃO 2: UM avaliador só NUNCA fecha a validação", async () => {
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const v = blindEvaluationVerdict({
    evaluators: [A], labels: CASOS.map((c) => lbl("aval-a", c, "supports")),
    systemUnderTest: SUT, labelableIds: CASOS,
  })
  assert.equal(v.complete, false)
  assert.ok(v.problems.includes("insufficient_independent_evaluators"))
})

test("dois avaliadores independentes com concordância total e cobertura completa -> complete", async () => {
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [...CASOS.map((c) => lbl("aval-a", c, "supports")), ...CASOS.map((c) => lbl("aval-b", c, "supports"))]
  const v = blindEvaluationVerdict({ evaluators: [A, B], labels, systemUnderTest: SUT, labelableIds: CASOS })
  assert.equal(v.complete, true, v.problems.join(","))
  assert.equal(v.agreement.rawAgreement, 1)
})

test("CONTROLE NEGATIVO: cobertura incompleta do conjunto rotulável NÃO fecha", async () => {
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [lbl("aval-a", "c1", "supports"), lbl("aval-b", "c1", "supports")]
  const v = blindEvaluationVerdict({ evaluators: [A, B], labels, systemUnderTest: SUT, labelableIds: CASOS })
  assert.equal(v.complete, false)
  assert.ok(v.problems.includes("incomplete_coverage"))
  assert.deepEqual(v.uncovered, ["c2", "c3"])
})

test("CONTROLE NEGATIVO: caso rotulado por UM avaliador só não conta como concordância", async () => {
  const { agreementReport } = await imp("src/epistemic/blind-evaluation.js")
  const r = agreementReport({
    labels: [lbl("aval-a", "c1", "supports"), lbl("aval-b", "c1", "supports"), lbl("aval-a", "c2", "supports")],
    evaluatorIds: ["aval-a", "aval-b"],
  })
  assert.deepEqual(r.agreed, ["c1"])
  assert.deepEqual(r.insufficientCoverage, ["c2"], "um rótulo sozinho nunca é acordo")
})

// ── ação 3: concordância e adjudicação ───────────────────────────────────
test("AÇÃO 3: kappa de Cohen é calculado de verdade (não é rawAgreement disfarçado)", async () => {
  const { cohenKappa } = await imp("src/epistemic/blind-evaluation.js")
  // 4 itens, 3 acordos: raw = 0.75. Com as marginais abaixo, pe = 0.5 -> kappa = 0.5.
  const k = cohenKappa(["s", "s", "n", "n"], ["s", "s", "s", "n"])
  assert.ok(Math.abs(k - 0.5) < 1e-9, `kappa esperado 0.5, veio ${k}`)
})

test("kappa é `null` quando NÃO é definível (categoria única) — nunca um número inventado", async () => {
  const { cohenKappa } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(cohenKappa(["s", "s"], ["s", "s"]), null, "pe=1 -> indefinido, não 1.0")
  assert.equal(cohenKappa([], []), null)
  assert.equal(cohenKappa(["s"], ["s", "n"]), null, "tamanhos diferentes -> indefinido")
})

test("AÇÃO 3: divergência SEM adjudicação registrada fica unresolved (nunca maioria silenciosa)", async () => {
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [
    lbl("aval-a", "c1", "supports"), lbl("aval-b", "c1", "supports"),
    lbl("aval-a", "c2", "supports"), lbl("aval-b", "c2", "contradicts"),
    lbl("aval-a", "c3", "supports"), lbl("aval-b", "c3", "supports"),
  ]
  const v = blindEvaluationVerdict({ evaluators: [A, B], labels, systemUnderTest: SUT, labelableIds: CASOS })
  assert.deepEqual(v.agreement.diverged, ["c2"])
  assert.equal(v.complete, false)
  assert.ok(v.problems.includes("unresolved_divergences"))
  assert.equal(v.adjudication.unresolved[0].reason, "no_adjudication_recorded")
})

test("divergência adjudicada por TERCEIRO com motivo -> resolvida, pipeline fecha", async () => {
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [
    lbl("aval-a", "c1", "supports"), lbl("aval-b", "c1", "supports"),
    lbl("aval-a", "c2", "supports"), lbl("aval-b", "c2", "contradicts"),
    lbl("aval-a", "c3", "supports"), lbl("aval-b", "c3", "supports"),
  ]
  const adjudications = [{ caseId: "c2", adjudicatorId: "aval-c", value: "supports", rationale: "o trecho afirma o claim literalmente" }]
  const v = blindEvaluationVerdict({ evaluators: [A, B, C], labels, adjudications, systemUnderTest: SUT, labelableIds: CASOS })
  assert.equal(v.adjudication.resolved.length, 1)
  assert.equal(v.adjudication.unresolved.length, 0)
})

// Este caso achou um ERRO DE DESIGN na 1a versão do módulo: ele exigia que
// TODOS os elegíveis rotulassem tudo, então a simples presença do adjudicador
// terceiro (que só desempata, não rotula) marcava cada caso como sub-coberto e
// zerava as divergências. O critério certo é ">=2 avaliadores POR CASO".
test("adjudicador elegível que NÃO rotula o corpus não pode marcar os casos como sub-cobertos", async () => {
  const { agreementReport } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [lbl("aval-a", "c1", "supports"), lbl("aval-b", "c1", "contradicts")]
  const r = agreementReport({ labels, evaluatorIds: ["aval-a", "aval-b", "aval-c"] })
  assert.deepEqual(r.diverged, ["c1"], "2 rotuladores já bastam para haver divergência")
  assert.deepEqual(r.insufficientCoverage, [])
  assert.deepEqual(r.raters, ["aval-a", "aval-b"], "raters = quem ROTULOU, não quem era elegível")
})

test("kappa é `null` com 3+ rotuladores — não escolhemos um par arbitrário e chamamos de 'a' concordância", async () => {
  const { agreementReport } = await imp("src/epistemic/blind-evaluation.js")
  const labels = ["aval-a", "aval-b", "aval-c"].flatMap((e) => [lbl(e, "c1", "supports"), lbl(e, "c2", "contradicts")])
  const r = agreementReport({ labels, evaluatorIds: ["aval-a", "aval-b", "aval-c"] })
  assert.equal(r.raters.length, 3)
  assert.equal(r.kappa, null)
  assert.equal(r.rawAgreement, 1, "a concordância bruta segue definida para N avaliadores")
})

test("CONTROLE NEGATIVO: lista de elegíveis longa com UM rotulador só não é avaliação independente", async () => {
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const v = blindEvaluationVerdict({
    evaluators: [A, B, C], labels: [lbl("aval-a", "c1", "supports")],
    systemUnderTest: SUT, labelableIds: ["c1"],
  })
  assert.equal(v.complete, false)
  assert.ok(v.problems.includes("insufficient_independent_evaluators"), "independência se mede em quem rotulou")
})

test("CONTROLE NEGATIVO: adjudicador que foi UM DOS QUE DIVERGIRAM não resolve nada", async () => {
  const { adjudicateDivergences } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [lbl("aval-a", "c2", "supports"), lbl("aval-b", "c2", "contradicts")]
  const r = adjudicateDivergences({
    diverged: ["c2"], labels,
    adjudications: [{ caseId: "c2", adjudicatorId: "aval-a", value: "supports", rationale: "eu estava certo" }],
  })
  assert.equal(r.resolved.length, 0)
  assert.equal(r.unresolved[0].reason, "adjudicator_was_one_of_the_raters")
})

test("CONTROLE NEGATIVO: adjudicação SEM motivo ou sem identidade não resolve", async () => {
  const { adjudicateDivergences } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [lbl("aval-a", "c2", "supports"), lbl("aval-b", "c2", "contradicts")]
  const semMotivo = adjudicateDivergences({ diverged: ["c2"], labels, adjudications: [{ caseId: "c2", adjudicatorId: "aval-c", value: "supports" }] })
  assert.equal(semMotivo.unresolved[0].reason, "adjudication_without_rationale")
  const semId = adjudicateDivergences({ diverged: ["c2"], labels, adjudications: [{ caseId: "c2", value: "supports", rationale: "porque sim" }] })
  assert.equal(semId.unresolved[0].reason, "adjudicator_without_identity")
})

// ── cegueira ─────────────────────────────────────────────────────────────
test("CONTROLE NEGATIVO: rótulo que revela a ORIGEM da resposta quebra a cegueira", async () => {
  const { blindEvaluationVerdict, blindnessViolations } = await imp("src/epistemic/blind-evaluation.js")
  const labels = [{ ...lbl("aval-a", "c1", "supports"), systemId: "gstack" }, lbl("aval-b", "c1", "supports")]
  assert.deepEqual(blindnessViolations(labels)[0].leaked, ["systemId"])
  const v = blindEvaluationVerdict({ evaluators: [A, B], labels, systemUnderTest: SUT, labelableIds: ["c1"] })
  assert.equal(v.complete, false)
  assert.ok(v.problems.includes("blindness_violated"))
})

test("CONTROLE NEGATIVO: corpus rotulável VAZIO não fecha por vacuidade", async () => {
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const v = blindEvaluationVerdict({ evaluators: [A, B], labels: [], systemUnderTest: SUT, labelableIds: [] })
  assert.equal(v.complete, false)
  assert.ok(v.problems.includes("no_labelable_corpus"))
})

// ── os 5 estados do §4.6 ─────────────────────────────────────────────────
test("§4.6: os cinco estados do PRD estão declarados", async () => {
  const { CLAIM_STATES } = await imp("src/epistemic/blind-evaluation.js")
  assert.deepEqual([...CLAIM_STATES].sort(), ["outOfScope", "pendingHumanValidation", "rejected", "unobservableByDesign", "validated"])
})

test("resolveClaimState: `validated` SÓ sai de pipeline completo", async () => {
  const { resolveClaimState } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(resolveClaimState({ claim: {}, verdict: null }).state, "pendingHumanValidation")
  assert.equal(resolveClaimState({ claim: {}, verdict: { complete: false, problems: ["x"] } }).state, "pendingHumanValidation")
  assert.equal(resolveClaimState({ claim: {}, verdict: { complete: true } }).state, "validated")
})

test("resolveClaimState: rótulos que NÃO sustentam o claim dão `rejected`, não pendência", async () => {
  const { resolveClaimState } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(resolveClaimState({ claim: { supportedByLabels: false }, verdict: { complete: true } }).state, "rejected")
})

test("resolveClaimState: inobservável e fora de escopo nunca entram no pipeline", async () => {
  const { resolveClaimState } = await imp("src/epistemic/blind-evaluation.js")
  assert.equal(resolveClaimState({ claim: { blockedBy: "not_measurable_by_design", missing: "estrutural" } }).state, "unobservableByDesign")
  assert.equal(resolveClaimState({ claim: { outOfScope: true, outOfScopeReason: "não é meta" } }).state, "outOfScope")
})

// Liga com o congelamento do S51.8.2: só se rotula o conjunto rotulável.
test("INTEGRAÇÃO com S51.8.2: labelableIds vem do freeze, e o holdout fica fora da cobertura exigida", async () => {
  const { freezeCorpus, labelableIds, holdoutIds } = await imp("src/epistemic/corpus-freeze.js")
  const { blindEvaluationVerdict } = await imp("src/epistemic/blind-evaluation.js")
  const cases = ["k1", "k2", "k3", "k4", "k5", "k6"].map((id) => ({ id, claim: `claim ${id}` }))
  const frozen = freezeCorpus({ cases, seed: "s51.8.3" })
  const alvo = labelableIds(frozen)
  const labels = [...alvo.map((c) => lbl("aval-a", c, "supports")), ...alvo.map((c) => lbl("aval-b", c, "supports"))]
  const v = blindEvaluationVerdict({ evaluators: [A, B], labels, systemUnderTest: SUT, labelableIds: alvo })
  assert.equal(v.complete, true, v.problems.join(","))
  assert.ok(holdoutIds(frozen).every((id) => !alvo.includes(id)), "holdout nunca entra no alvo de rotulagem")
})

test("fonte ÚNICA do vocabulário: validation-taxonomy reexporta os 5 estados, não redeclara", async () => {
  const tax = await imp("src/epistemic/validation-taxonomy.js")
  const be = await imp("src/epistemic/blind-evaluation.js")
  assert.deepEqual([...tax.CLAIM_STATES].sort(), [...be.CLAIM_STATES].sort())
  assert.equal(typeof tax.resolveClaimState, "function")
  const src = readFileSync(path.join(repoRoot, "src", "epistemic", "validation-taxonomy.js"), "utf-8")
  assert.ok(!/const CLAIM_STATES\s*=/.test(src), "sem cópia paralela do vocabulário — reexport, não redeclaração")
})

// Invariante de honestidade: o módulo é mecânica, não fábrica de rótulos.
test("CONTROLE NEGATIVO: o módulo NÃO fabrica rótulo nem avaliador embutido", async () => {
  const src = readFileSync(path.join(repoRoot, "src", "epistemic", "blind-evaluation.js"), "utf-8")
  assert.ok(!/DEFAULT_LABELS|SAMPLE_LABELS|const LABELS\s*=/.test(src), "nenhum rótulo embutido")
  assert.ok(!/Math\.random/.test(src), "nada de rótulo/avaliador sorteado")
  assert.match(src, /não produz rótulo nenhum/i, "o limite está declarado no próprio módulo")
})
