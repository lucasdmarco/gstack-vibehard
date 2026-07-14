import test from "node:test"
import assert from "node:assert/strict"
import { validateChain, linkChain, TRACE_STAGES } from "../src/project-plan/traceability.js"
import { validateReview, reviewGates, aggregateReviews, REVIEW_SCHEMA } from "../src/project-plan/artifact-review.js"

// PRD42 S42.5 — Artifact Review Pipeline + traceability determinística.
// Invariantes: (1) produtor ≠ revisor; (2) revisão LLM é advisory (nunca gate); (3) só review
// determinístico com changes_requested gateia; (4) a cadeia brief→...→evidence é rastreável e
// uma quebra de ref / estágio ausente reprova.

test("traceability: cadeia completa e encadeada é ok", () => {
  const chain = linkChain({ brief: "b1", spec: "s1", task: "t1", diff: "d1", test: "te1", evidence: "e1" })
  const r = validateChain(chain)
  assert.equal(r.ok, true)
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.breaks, [])
  // cada nó referencia o id anterior
  assert.equal(chain.find((n) => n.stage === "spec").ref, "b1")
})

test("CONTROLE NEGATIVO: estágio ausente reprova a rastreabilidade", () => {
  const chain = linkChain({ brief: "b1", spec: "s1", task: "t1", diff: "d1", test: "te1" }) // falta evidence
  const r = validateChain(chain)
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ["evidence"])
})

test("CONTROLE NEGATIVO: ref quebrado (não aponta o id anterior) reprova", () => {
  const chain = [
    { stage: "brief", id: "b1", ref: null }, { stage: "spec", id: "s1", ref: "b1" },
    { stage: "task", id: "t1", ref: "XXX" }, // ref errado
    { stage: "diff", id: "d1", ref: "t1" }, { stage: "test", id: "te1", ref: "d1" }, { stage: "evidence", id: "e1", ref: "te1" },
  ]
  const r = validateChain(chain)
  assert.equal(r.ok, false)
  assert.equal(r.breaks.length, 1)
  assert.equal(r.breaks[0].stage, "task")
  assert.equal(r.breaks[0].expected, "s1")
})

test("review: producer ≠ reviewer é obrigatório", () => {
  assert.equal(validateReview({ stage: "spec", producer: "agentA", reviewer: "agentB" }).ok, true)
  const same = validateReview({ stage: "spec", producer: "agentA", reviewer: "agentA" })
  assert.equal(same.ok, false)
  assert.match(same.errors.join(" "), /não pode revisar o próprio/)
  assert.equal(validateReview({ stage: "spec", producer: "a" }).ok, false, "falta reviewer")
  assert.equal(validateReview({ stage: "invalid", producer: "a", reviewer: "b" }).ok, false)
})

test("reviewGates: LLM é advisory (nunca gate); determinístico com changes gateia", () => {
  assert.equal(reviewGates({ kind: "llm", verdict: "changes_requested", stage: "quality" }), false, "LLM nunca bloqueia")
  assert.equal(reviewGates({ kind: "deterministic", verdict: "changes_requested", stage: "compliance" }), true)
  assert.equal(reviewGates({ kind: "deterministic", verdict: "approved", stage: "compliance" }), false)
})

test("aggregateReviews: ok quando válidos+aprovados; LLM changes vira advisory, não bloqueia", () => {
  const reviews = [
    { stage: "spec", kind: "deterministic", producer: "a", reviewer: "b", verdict: "approved" },
    { stage: "quality", kind: "llm", producer: "a", reviewer: "b", verdict: "changes_requested" },
  ]
  const agg = aggregateReviews(reviews)
  assert.equal(agg.schema, REVIEW_SCHEMA)
  assert.equal(agg.ok, true, "LLM changes é advisory, não bloqueia")
  assert.deepEqual(agg.advisory, [{ stage: "quality", verdict: "changes_requested" }])
})

test("CONTROLE NEGATIVO: producer=reviewer OU compliance determinístico com changes bloqueia", () => {
  const selfReview = aggregateReviews([{ stage: "spec", kind: "deterministic", producer: "a", reviewer: "a", verdict: "approved" }])
  assert.equal(selfReview.ok, false)
  assert.equal(selfReview.invalid[0].stage, "spec")

  const gated = aggregateReviews([{ stage: "compliance", kind: "deterministic", producer: "a", reviewer: "b", verdict: "changes_requested" }])
  assert.equal(gated.ok, false)
  assert.deepEqual(gated.gating, ["compliance"])
})

test("TRACE_STAGES é a cadeia canônica de 6", () => {
  assert.deepEqual(TRACE_STAGES, ["brief", "spec", "task", "diff", "test", "evidence"])
})
