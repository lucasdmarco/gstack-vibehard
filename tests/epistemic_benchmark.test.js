import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const readFixture = (n) => JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "epistemic", n), "utf-8"))

/**
 * PRD50 S50.6 — benchmark medido, não acreditado.
 *
 * Escopo honesto: só o que tem gabarito OBJETIVO. A fatia subjetiva sai como
 * `pending_human_labeling` — auto-rotular seria a autoconcordância que o §2.3
 * item 1 rejeita.
 */

// Juiz determinístico do corpus: usa o gabarito do fixture como comportamento
// esperado do sistema. É o que permite medir sem circularidade.
const judgeFromCorpus = (c) => ({
  true: "supported", false: "refuted", insufficient: "inconclusive", ambiguous: "inconclusive",
}[c.groundTruth])

test("GATE: falso-suporte é ZERO nos controles deterministicamente falsos", async () => {
  const { measureFalseSupported } = await imp("src/epistemic/benchmark.js")
  const { cases } = readFixture("corpus.json")
  const r = measureFalseSupported(cases, judgeFromCorpus)
  assert.ok(r.total >= 3, "há controles falsos suficientes")
  assert.equal(r.falseSupported, 0, `casos falsos marcados como suportados: ${r.offenders.join(", ")}`)
  assert.equal(r.rate, 0)
})

test("GATE: precisão de citation support nos pares objetivos", async () => {
  const { measureCitationPrecision } = await imp("src/epistemic/benchmark.js")
  const { pairs } = readFixture("citation-pairs.json")
  const r = measureCitationPrecision(pairs)
  assert.ok(r.total >= 6)
  assert.equal(r.precision, 1, `erros: ${JSON.stringify(r.misses)}`)
})

test("GATE: NENHUMA citação não-sustentadora vaza como suporte", async () => {
  const { measureNoFalseCitationSupport } = await imp("src/epistemic/benchmark.js")
  const { pairs } = readFixture("citation-pairs.json")
  const r = measureNoFalseCitationSupport(pairs)
  assert.equal(r.ok, true, `${r.leaked} citação(ões) vazaram como suporte`)
})

test("GATE: classificação de nível é 100% determinística no corpus", async () => {
  const { measureClassificationAccuracy } = await imp("src/epistemic/benchmark.js")
  const { cases } = readFixture("corpus.json")
  const r = measureClassificationAccuracy(cases)
  assert.equal(r.accuracy, 1, `erros: ${JSON.stringify(r.misses)}`)
})

test("abstenção: todo caso 'insufficient' resulta em inconclusive, nunca afirmação", async () => {
  const { measureAbstention } = await imp("src/epistemic/benchmark.js")
  const { cases } = readFixture("corpus.json")
  const r = measureAbstention(cases, judgeFromCorpus)
  assert.ok(r.total >= 2)
  assert.equal(r.recall, 1, `não abstiveram: ${r.missed.join(", ")}`)
})

test("GATE: zero tool claim sem recibo", async () => {
  const { measureToolClaimsWithoutReceipt } = await imp("src/epistemic/benchmark.js")
  assert.equal(measureToolClaimsWithoutReceipt([{ tools: [{ name: "rg", receiptId: "r1" }] }, { tools: [] }]).ok, true)
  const bad = measureToolClaimsWithoutReceipt([{ tools: [{ name: "rg" }] }])
  assert.equal(bad.ok, false, "ferramenta alegada sem recibo tem que reprovar")
})

test("GATE: zero `proved` originado de LLM/review/epistemic", async () => {
  const { measureProvedFromLlm } = await imp("src/epistemic/benchmark.js")
  assert.equal(measureProvedFromLlm([{ status: "proved", source: "test" }]).ok, true)
  for (const src of ["llm", "review", "epistemic"]) {
    assert.equal(measureProvedFromLlm([{ status: "proved", source: src }]).ok, false, `${src} não pode provar`)
  }
})

// --- honestidade metodológica ---
test("a fatia SUBJETIVA é declarada pendente de rótulo humano, nunca auto-avaliada", async () => {
  const { pendingHumanLabeling } = await imp("src/epistemic/benchmark.js")
  const { cases } = readFixture("corpus.json")
  const p = pendingHumanLabeling(cases)
  assert.ok(p.count >= 2, "há casos ambíguos no corpus")
  assert.equal(p.status, "pending_human_labeling")
  assert.match(p.reason, /circular/i)
  assert.ok(p.metrics.includes("answer_relevance_to_intent"))
})

test("CONTROLE NEGATIVO: o relatório NUNCA se declara plenamente validado", async () => {
  const { buildBenchmarkReport } = await imp("src/epistemic/benchmark.js")
  const report = buildBenchmarkReport({
    falseSupported: { falseSupported: 0 }, toolReceipts: { ok: true },
    provedFromLlm: { ok: true }, citationLeak: { ok: true }, classification: { accuracy: 1 },
  })
  assert.equal(report.objectiveGatesReady, true, "os gates objetivos passam")
  assert.equal(report.fullyValidated, false, "mas o relatório nunca alega validação completa")
  assert.match(report.note, /rótulo humano cego/i)
})

test("CONTROLE NEGATIVO: qualquer gate objetivo reprovado derruba objectiveGatesReady", async () => {
  const { buildBenchmarkReport } = await imp("src/epistemic/benchmark.js")
  const report = buildBenchmarkReport({
    falseSupported: { falseSupported: 1 }, toolReceipts: { ok: true },
    provedFromLlm: { ok: true }, citationLeak: { ok: true }, classification: { accuracy: 1 },
  })
  assert.equal(report.objectiveGatesReady, false)
  assert.equal(report.gates.find((g) => g.id === "zero_false_supported").passed, false)
})

test("CONTROLE NEGATIVO: nenhum score de Aletheia/Deep Think é transferido (§17.2)", async () => {
  const src = readFileSync(path.join(repoRoot, "src", "epistemic", "benchmark.js"), "utf-8")
  assert.ok(!/\b\d{2,3}\s*%/.test(src), "nenhum percentual fixo hardcoded como resultado")
  assert.match(src, /não se transfere score algum/i)
})
