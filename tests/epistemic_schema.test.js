import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/** PRD50 S50.1 — schema `gstack.epistemic-review.v1` (§10) e seus invariantes (§10.1). */

test("vocabulário: kinds, status, verdicts, confidence e stopReasons conforme §10", async () => {
  const m = await imp("src/epistemic/schema.js")
  assert.equal(m.EPISTEMIC_REVIEW_SCHEMA, "gstack.epistemic-review.v1")
  assert.deepEqual([...m.CLAIM_KINDS], ["fact", "inference", "hypothesis", "recommendation"])
  for (const s of ["supported", "refuted", "ambiguous", "inconclusive", "not_applicable", "needs_expert"]) {
    assert.ok(m.CLAIM_STATUS.includes(s), `status ${s}`)
  }
  for (const v of ["supported", "refuted", "mixed", "inconclusive", "needs_expert"]) {
    assert.ok(m.VERDICTS.includes(v), `verdict ${v}`)
  }
  for (const r of ["sufficient", "cap", "same_failure", "insufficient_data", "expert_required"]) {
    assert.ok(m.STOP_REASONS.includes(r), `stopReason ${r}`)
  }
})

test("buildReview: monta o shape completo com defaults honestos", async () => {
  const { buildReview, EPISTEMIC_REVIEW_SCHEMA } = await imp("src/epistemic/schema.js")
  const r = buildReview({ question: "q?", level: "sanity" })
  assert.equal(r.schemaVersion, EPISTEMIC_REVIEW_SCHEMA)
  assert.equal(r.level, "sanity")
  assert.deepEqual(r.claims, [])
  assert.deepEqual(r.notPerformed, [])
  assert.equal(r.experimentPlan, null, "sem plano por default — nunca finge que planejou experimento")
  assert.equal(r.protocol.completed, false, "completed só vira true quando o protocolo termina de fato")
})

test("INVARIANTE §10.1: confidence 'high' SEM suporte verificável é inválido", async () => {
  const { validateReview, buildReview } = await imp("src/epistemic/schema.js")
  const r = buildReview({
    question: "q?", level: "grounded",
    claims: [{ id: "c1", text: "x", kind: "fact", status: "supported", support: [], confidence: "high" }],
  })
  const v = validateReview(r)
  assert.equal(v.ok, false)
  assert.match(v.reasons.join(" "), /confidence 'high' sem suporte/i)
})

test("INVARIANTE §10.1: confidence 'high' COM suporte real é válido (controle inverso)", async () => {
  const { validateReview, buildReview } = await imp("src/epistemic/schema.js")
  const r = buildReview({
    question: "q?", level: "grounded",
    claims: [{ id: "c1", text: "x", kind: "fact", status: "supported", support: [{ sourceId: "s1", excerpt: "trecho" }], confidence: "high" }],
  })
  assert.equal(validateReview(r).ok, true, validateReview(r).reasons.join(", "))
})

test("INVARIANTE §10.1: claim 'supported' sem NENHUM suporte é inválido — status nunca por decreto", async () => {
  const { validateReview, buildReview } = await imp("src/epistemic/schema.js")
  const r = buildReview({
    question: "q?", level: "grounded",
    claims: [{ id: "c1", text: "x", kind: "fact", status: "supported", support: [], confidence: "low" }],
  })
  assert.equal(validateReview(r).ok, false)
  assert.match(validateReview(r).reasons.join(" "), /supported sem suporte/i)
})

test("INVARIANTE: kind/status/confidence fora do vocabulário reprovam", async () => {
  const { validateReview, buildReview } = await imp("src/epistemic/schema.js")
  const bad = buildReview({ question: "q?", level: "sanity", claims: [{ id: "c1", text: "x", kind: "opiniao", status: "supported", support: [{ sourceId: "s" }] }] })
  assert.equal(validateReview(bad).ok, false)
  const badLevel = buildReview({ question: "q?", level: "turbo" })
  assert.equal(validateReview(badLevel).ok, false)
})

test("INVARIANTE §10.1: protocol.completed=true NÃO implica verdict supported", async () => {
  const { verdictFromClaims } = await imp("src/epistemic/schema.js")
  assert.equal(verdictFromClaims([{ status: "inconclusive" }]), "inconclusive")
  assert.equal(verdictFromClaims([{ status: "refuted" }]), "refuted")
  assert.equal(verdictFromClaims([{ status: "supported" }, { status: "refuted" }]), "mixed")
  assert.equal(verdictFromClaims([{ status: "needs_expert" }]), "needs_expert")
  assert.equal(verdictFromClaims([]), "inconclusive", "sem claim nenhum -> inconclusive, nunca supported")
})

test("INVARIANTE §10.1: inconclusive/needs_expert são conclusões honestas (exit 0), não erro", async () => {
  const { exitCodeForVerdict } = await imp("src/epistemic/schema.js")
  assert.equal(exitCodeForVerdict("inconclusive"), 0)
  assert.equal(exitCodeForVerdict("needs_expert"), 0)
  assert.equal(exitCodeForVerdict("refuted"), 0, "refutar é resultado válido do protocolo")
  assert.equal(exitCodeForVerdict("supported"), 0)
  assert.equal(exitCodeForVerdict("inconclusive", { strict: true }), 3, "--strict pode exigir supported")
  assert.equal(exitCodeForVerdict("supported", { strict: true }), 0)
})
