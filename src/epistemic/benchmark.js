import { evaluateCitationSupport } from "./sources.js"
import { classifyLevel, signalsFromCorpusCase } from "./classifier.js"
import { citationSupportsClaim } from "./invariants.js"

/**
 * Benchmark do protocolo epistêmico (PRD50 S50.6).
 *
 * **Limite metodológico declarado, não escondido:** este benchmark mede o que
 * tem gabarito OBJETIVO — decidível por inspeção do fixture, independente de
 * quem construiu o sistema. Suporte semântico ambíguo e relevância de intenção
 * NÃO são medidos aqui: se o mesmo agente que construiu o protocolo desse a
 * nota, seria exatamente a autoconcordância que o §2.3 item 1 do PRD rejeita.
 * Esses casos saem em `pendingHumanLabeling`, com o corpus pronto para rótulo
 * humano cego.
 *
 * Também não se transfere score algum de Aletheia/Deep Think para cá (§17.2).
 */
export const EPISTEMIC_BENCHMARK_SCHEMA = "gstack.epistemic-benchmark.v1"

const pct = (num, den) => (den === 0 ? null : num / den)

/**
 * Falso-suporte: caso cujo gabarito é `false` mas o sistema marcaria como
 * sustentado. Zero é o gate — um controle deterministicamente falso jamais
 * pode sair como suportado.
 */
export function measureFalseSupported(cases, judge) {
  const objectiveFalse = cases.filter((c) => c.groundTruth === "false")
  const wrong = objectiveFalse.filter((c) => judge(c) === "supported")
  return { total: objectiveFalse.length, falseSupported: wrong.length, rate: pct(wrong.length, objectiveFalse.length), offenders: wrong.map((c) => c.id) }
}

/** Precisão de citation support sobre pares com gabarito objetivo. */
export function measureCitationPrecision(pairs) {
  const scored = pairs.map((p) => ({
    id: p.id,
    got: evaluateCitationSupport({ claim: p.claim, excerpt: p.excerpt, content: p.content }).state,
    want: p.expectedState,
  }))
  const hits = scored.filter((s) => s.got === s.want)
  return { total: scored.length, correct: hits.length, precision: pct(hits.length, scored.length), misses: scored.filter((s) => s.got !== s.want) }
}

/** Nenhuma citação `mentions_only`/`not_found` pode ser contada como suporte. */
export function measureNoFalseCitationSupport(pairs) {
  const nonSupporting = pairs.filter((p) => p.expectedState !== "supports")
  const leaked = nonSupporting.filter((p) => citationSupportsClaim(evaluateCitationSupport({ claim: p.claim, excerpt: p.excerpt, content: p.content }).state))
  return { total: nonSupporting.length, leaked: leaked.length, ok: leaked.length === 0 }
}

/** Classificação de nível bate com o gabarito do corpus (determinismo). */
export function measureClassificationAccuracy(cases) {
  const scored = cases.map((c) => ({ id: c.id, got: classifyLevel(signalsFromCorpusCase(c)).level, want: c.expectedLevel }))
  const hits = scored.filter((s) => s.got === s.want)
  return { total: scored.length, correct: hits.length, accuracy: pct(hits.length, scored.length), misses: scored.filter((s) => s.got !== s.want) }
}

/** Abstenção: caso `insufficient` deve virar inconclusive, nunca uma resposta afirmativa. */
export function measureAbstention(cases, judge) {
  const shouldAbstain = cases.filter((c) => c.groundTruth === "insufficient")
  const did = shouldAbstain.filter((c) => ["inconclusive", "needs_expert"].includes(judge(c)))
  return { total: shouldAbstain.length, abstained: did.length, recall: pct(did.length, shouldAbstain.length), missed: shouldAbstain.filter((c) => !["inconclusive", "needs_expert"].includes(judge(c))).map((c) => c.id) }
}

/** Toda alegação de uso de ferramenta precisa de recibo — gate de zero. */
export function measureToolClaimsWithoutReceipt(reviews) {
  const offenders = reviews.filter((r) => (r.tools || []).some((t) => !t.receiptId))
  return { total: reviews.length, withoutReceipt: offenders.length, ok: offenders.length === 0 }
}

/** Nenhum `proved` pode ter origem em LLM/review — gate de zero. */
export function measureProvedFromLlm(evidenceEntries) {
  const offenders = evidenceEntries.filter((e) => e.status === "proved" && ["llm", "review", "epistemic"].includes(e.source))
  return { total: evidenceEntries.length, provedFromLlm: offenders.length, ok: offenders.length === 0 }
}

/** O que NÃO é medível sem rótulo humano cego — declarado, nunca estimado. */
export function pendingHumanLabeling(cases) {
  const subjective = cases.filter((c) => c.requiresHumanLabel === true)
  return {
    count: subjective.length,
    ids: subjective.map((c) => c.id),
    metrics: ["citation_support_precision_on_ambiguous", "answer_relevance_to_intent"],
    reason: "julgamento subjetivo auto-avaliado pelo autor do sistema seria circular (PRD50 §2.3 item 1)",
    status: "pending_human_labeling",
  }
}

// Gates de promoção do §50.6 que são verificáveis com gabarito objetivo.
const PROMOTION_GATES = Object.freeze([
  { id: "zero_false_supported", pass: (r) => r.falseSupported.falseSupported === 0 },
  { id: "zero_tool_claim_without_receipt", pass: (r) => r.toolReceipts.ok },
  { id: "zero_proved_from_llm", pass: (r) => r.provedFromLlm.ok },
  { id: "no_false_citation_support", pass: (r) => r.citationLeak.ok },
  { id: "classification_deterministic", pass: (r) => r.classification.accuracy === 1 },
])

/** Agrega o relatório. `ready` só considera os gates OBJETIVOS. */
export function buildBenchmarkReport(results) {
  const gates = PROMOTION_GATES.map((g) => ({ id: g.id, passed: g.pass(results) }))
  return {
    schemaVersion: EPISTEMIC_BENCHMARK_SCHEMA,
    generatedAt: new Date().toISOString(),
    ...results,
    gates,
    objectiveGatesReady: gates.every((g) => g.passed),
    // Nunca `ready:true` global: a fatia humana continua aberta por design.
    fullyValidated: false,
    note: "gates objetivos medidos nesta máquina; métricas subjetivas exigem rótulo humano cego (ver pendingHumanLabeling)",
  }
}
