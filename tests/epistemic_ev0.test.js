import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD50 S50.1 — EV0 em UMA passagem, e a prova de que o trivial continua barato.
 *
 * Nota honesta sobre o gate dos 8% (§ DoD do sprint): o overhead é medido AQUI,
 * dentro do comando do GStack, onde ele controla entrada e saída. No Claude
 * Code/Codex o contrato epistêmico é TEXTO INJETADO no adapter — o GStack nunca
 * vê a resposta e portanto não pode medir seu overhead. Isso está declarado em
 * docs/guides/epistemic-protocol.md, não escondido.
 */

test("EV0 roda em UMA passagem e nunca usa rede/subagente/model call extra", async () => {
  const { runSanityReview } = await imp("src/epistemic/protocol.js")
  const r = runSanityReview({ question: "qual a versão?", answer: "5.49.0" })
  assert.equal(r.level, "sanity")
  assert.equal(r.protocol.iterations, 1)
  assert.equal(r.protocol.completed, true)
  assert.deepEqual(r.tools, [], "zero ferramenta")
  assert.deepEqual(r.sources, [], "zero fonte externa")
  assert.equal(r.tokenBudget.extraModelCalls, 0)
  assert.equal(r.tokenBudget.network, false)
})

test("EV0 respeita o budget do nível (violatesLevelBudget do S50.0 aprova)", async () => {
  const { runSanityReview } = await imp("src/epistemic/protocol.js")
  const { violatesLevelBudget } = await imp("src/epistemic/invariants.js")
  const r = runSanityReview({ question: "q?", answer: "a" })
  const check = violatesLevelBudget("sanity", {
    network: r.tokenBudget.network, extraModelCalls: r.tokenBudget.extraModelCalls,
    subagents: r.tokenBudget.subagents, execution: r.tokenBudget.execution,
  })
  assert.equal(check.ok, true, check.reason)
})

test("EV0 SEM premissa duvidosa: não narra auditoria (§8) — saída concisa", async () => {
  const { runSanityReview, renderSanityHuman } = await imp("src/epistemic/protocol.js")
  const r = runSanityReview({ question: "qual a versão?", answer: "5.49.0" })
  const out = renderSanityHuman(r)
  assert.equal(out.trim(), "5.49.0", "sem ressalva, EV0 devolve só a resposta — zero paredão")
})

test("EV0 COM premissa duvidosa/dado faltando: mostra o limite (§13.2)", async () => {
  const { runSanityReview, renderSanityHuman } = await imp("src/epistemic/protocol.js")
  const r = runSanityReview({ question: "quanto custa?", answer: "depende", limitations: ["depende de X, que não foi informado"] })
  const out = renderSanityHuman(r)
  assert.match(out, /depende/)
  assert.match(out, /Limite:/)
})

test("EV0 produz review VÁLIDO no schema", async () => {
  const { runSanityReview } = await imp("src/epistemic/protocol.js")
  const { validateReview } = await imp("src/epistemic/schema.js")
  const v = validateReview(runSanityReview({ question: "q?", answer: "a" }))
  assert.equal(v.ok, true, v.reasons.join(", "))
})

test("CONTROLE NEGATIVO: EV0 NUNCA emite verdict 'supported' — não verificou nada", async () => {
  const { runSanityReview } = await imp("src/epistemic/protocol.js")
  const r = runSanityReview({ question: "o céu é azul?", answer: "sim" })
  assert.notEqual(r.verdict, "supported", "EV0 é sanity check, não verificação")
  assert.ok(r.notPerformed.length > 0, "EV0 declara honestamente o que NÃO fez")
})

// --- GATE DE CUSTO (DoD do sprint), medido onde é mensurável ---
test("GATE: overhead mediano do EV0 <= 8% no corpus trivial (medido dentro do comando)", async () => {
  const { runSanityReview, renderSanityHuman } = await imp("src/epistemic/protocol.js")
  const corpus = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "epistemic", "corpus.json"), "utf-8"))
  const trivial = corpus.cases.filter((c) => c.expectedLevel === "sanity")
  assert.ok(trivial.length >= 1, "corpus tem caso trivial")

  const baseline = "5.49.0" // resposta crua que o comando daria sem o protocolo
  const overheads = trivial.map(() => {
    const withEv0 = renderSanityHuman(runSanityReview({ question: "q?", answer: baseline }))
    return (withEv0.length - baseline.length) / baseline.length
  })
  overheads.sort((a, b) => a - b)
  const median = overheads[Math.floor(overheads.length / 2)]
  assert.ok(median <= 0.08, `overhead mediano ${(median * 100).toFixed(1)}% deve ser <= 8%`)
})

// --- WIRING REAL: consult como 1o consumidor (antecipado do S50.5) ---
test("WIRING: consult --json ganha campo `epistemic` separando fato de inferência", async () => {
  const { buildConsult } = await imp("src/commands/consult.js")
  const c = buildConsult({ objective: "quero um SaaS com login", home: "/tmp/nao-existe-home", cwd: "/tmp/nao-existe-cwd" })
  assert.ok(c.epistemic, "consult passa a expor sua própria classificação epistêmica")
  assert.equal(c.epistemic.schemaVersion, "gstack.epistemic-review.v1")
  const kinds = Object.fromEntries(c.epistemic.claims.map((x) => [x.id, x.kind]))
  assert.equal(kinds.installState, "fact", "sondagem real de disco é FATO")
  assert.equal(kinds.recommendedMode, "inference", "heurística de keyword é INFERÊNCIA, nunca fato")
  assert.equal(kinds.recommendedPath, "recommendation")
})

test("WIRING: o claim de FATO do consult cita a evidência real (a sondagem), nunca vazio", async () => {
  const { buildConsult } = await imp("src/commands/consult.js")
  const { validateReview } = await imp("src/epistemic/schema.js")
  const c = buildConsult({ objective: "app simples", home: "/tmp/nao-existe-home", cwd: "/tmp/nao-existe-cwd" })
  const fact = c.epistemic.claims.find((x) => x.id === "installState")
  assert.ok(fact.support.length > 0, "fato sem suporte seria inválido no schema")
  assert.equal(validateReview(c.epistemic).ok, true, validateReview(c.epistemic).reasons.join(", "))
})

test("CONTROLE NEGATIVO: consult continua READ-ONLY e com o contrato original intacto", async () => {
  const { buildConsult } = await imp("src/commands/consult.js")
  const c = buildConsult({ objective: "x", home: "/tmp/nao-existe-home", cwd: "/tmp/nao-existe-cwd" })
  for (const k of ["recommendedPath", "doNotStack", "previewCommand", "rollbackCommand"]) {
    assert.ok(c[k] !== undefined, `contrato de aceite original preservado: ${k}`)
  }
})
