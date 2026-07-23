import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD50 S50.3 — protocolo balanceado (§11.2): support + refute + boundary +
 * abstain, com caps do Loop Engine. Sem novo motor: usa o adapter.
 */

const supportingSource = { sourceId: "s1", excerpt: "o método X reduz Y", state: "supports" }

test("balanced: busca suporte E refutação — as duas trilhas sempre rodam (§2.2)", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "X reduz Y?", level: "grounded",
    claimTexts: ["o método X reduz Y"],
    deps: { findSupport: () => [supportingSource], findRefutation: () => [], findBoundaries: () => [] },
  })
  assert.equal(r.protocol.trails.support, true)
  assert.equal(r.protocol.trails.refutation, true, "a trilha de refutação sempre roda, mesmo com suporte achado")
})

test("suporte real e sem contraevidência -> claim supported", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "q", level: "grounded", claimTexts: ["c"],
    deps: { findSupport: () => [supportingSource], findRefutation: () => [], findBoundaries: () => [] },
  })
  assert.equal(r.claims[0].status, "supported")
  assert.equal(r.verdict, "supported")
})

test("CONTROLE NEGATIVO: contraevidência achada -> refuted, mesmo havendo suporte parcial", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "q", level: "adversarial", claimTexts: ["c"],
    deps: {
      findSupport: () => [supportingSource],
      findRefutation: () => [{ sourceId: "s2", excerpt: "X não reduz Y", state: "contradicts" }],
      findBoundaries: () => [],
    },
  })
  assert.equal(r.claims[0].status, "refuted", "contraevidência domina suporte")
  assert.ok(r.claims[0].counterevidence.length > 0)
})

test("CONTROLE NEGATIVO: nenhuma evidência -> inconclusive (abstenção honesta), nunca supported", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "q", level: "grounded", claimTexts: ["c"],
    deps: { findSupport: () => [], findRefutation: () => [], findBoundaries: () => [] },
  })
  assert.equal(r.claims[0].status, "inconclusive")
  assert.equal(r.verdict, "inconclusive")
  assert.equal(r.protocol.stopReason, "insufficient_data")
})

test("CONTROLE NEGATIVO: fonte que só menciona NÃO conta como suporte", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "q", level: "grounded", claimTexts: ["c"],
    deps: {
      findSupport: () => [{ sourceId: "s3", excerpt: "menciona X", state: "mentions_only" }],
      findRefutation: () => [], findBoundaries: () => [],
    },
  })
  assert.equal(r.claims[0].status, "inconclusive", "mentions_only nunca sustenta (§12.2)")
  assert.equal(r.claims[0].support.length, 0)
})

test("boundary cases achados são registrados no claim", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "q", level: "adversarial", claimTexts: ["c"],
    deps: {
      findSupport: () => [supportingSource], findRefutation: () => [],
      findBoundaries: () => ["falha quando Y = 0"],
    },
  })
  assert.deepEqual(r.claims[0].boundaryCases, ["falha quando Y = 0"])
})

test("caps: EV2 nunca excede 3 iterações (usa iterationCapFor do adapter)", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "q", level: "adversarial", claimTexts: ["c"],
    deps: { findSupport: () => [], findRefutation: () => [], findBoundaries: () => [] },
  })
  assert.ok(r.protocol.iterations <= 3)
})

test("EV0 continua funcionando pelo caminho de uma passagem (não regrediu)", async () => {
  const { runSanityReview } = await imp("src/epistemic/protocol.js")
  const r = runSanityReview({ question: "q", answer: "a" })
  assert.equal(r.level, "sanity")
  assert.equal(r.protocol.iterations, 1)
})

test("resultado do protocolo balanceado é VÁLIDO no schema", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const { validateReview } = await imp("src/epistemic/schema.js")
  const r = runBalancedProtocol({
    question: "q", level: "grounded", claimTexts: ["c"],
    deps: { findSupport: () => [supportingSource], findRefutation: () => [], findBoundaries: () => [] },
  })
  const v = validateReview(r)
  assert.equal(v.ok, true, v.reasons.join(", "))
})

test("CONTROLE NEGATIVO: worker que FALHA não produz claim supported", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const r = runBalancedProtocol({
    question: "q", level: "grounded", claimTexts: ["c"],
    deps: {
      findSupport: () => { throw new Error("worker quebrou") },
      findRefutation: () => [], findBoundaries: () => [],
    },
  })
  assert.notEqual(r.verdict, "supported")
  assert.equal(r.protocol.stopReason, "insufficient_data")
  assert.ok(r.notPerformed.some((n) => /falh/i.test(n)), "a falha é declarada, não engolida")
})

test("tokenBudget do nível é respeitado e reportado", async () => {
  const { runBalancedProtocol } = await imp("src/epistemic/protocol.js")
  const { violatesLevelBudget } = await imp("src/epistemic/invariants.js")
  const r = runBalancedProtocol({
    question: "q", level: "grounded", claimTexts: ["c"],
    deps: { findSupport: () => [supportingSource], findRefutation: () => [], findBoundaries: () => [] },
  })
  const check = violatesLevelBudget("grounded", {
    network: r.tokenBudget.network, extraModelCalls: r.tokenBudget.extraModelCalls,
    subagents: r.tokenBudget.subagents, execution: r.tokenBudget.execution,
  })
  assert.equal(check.ok, true, check.reason)
})
