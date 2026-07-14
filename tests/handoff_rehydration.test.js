import test from "node:test"
import assert from "node:assert/strict"
import { estimateTokens, buildHandoff, resumeBenchmark, headroomClaim, HANDOFF_SCHEMA } from "../src/project-plan/handoff.js"

// PRD42 S42.10 — Handoff/reidratação. Honestidade: (1) tokens SEMPRE 'estimated'; (2) economia
// Headroom só com routing + delta medido; (3) benchmark rotula a economia como estimada.

test("estimateTokens: sempre rotulado 'estimated' (nunca measured)", () => {
  const e = estimateTokens("abcdefgh") // 8 chars → ~2 tokens
  assert.equal(e.source, "estimated")
  assert.equal(e.tokens, 2)
  assert.equal(estimateTokens("").tokens, 0)
})

test("buildHandoff: brief vivo (objetivo/mode/aceites) + threads abertas", () => {
  const brief = { objective: "SaaS", mode: "full", acceptances: [{ id: "quality-gate", verifier: {} }] }
  const h = buildHandoff({ brief, state: { branch: "master" }, openThreads: ["revisar RBAC"] })
  assert.equal(h.schema, HANDOFF_SCHEMA)
  assert.equal(h.objective, "SaaS")
  assert.equal(h.mode, "full")
  assert.equal(h.acceptances.length, 1)
  assert.deepEqual(h.openThreads, ["revisar RBAC"])
  // sem brief: campos nulos, não inventa
  assert.equal(buildHandoff({}).objective, null)
})

test("resumeBenchmark: economia rotulada 'estimated' (nunca medida)", () => {
  const b = resumeBenchmark({ handoffText: "x".repeat(400), fullText: "y".repeat(4000) })
  assert.equal(b.handoffTokens.source, "estimated")
  assert.equal(b.savings.source, "estimated")
  assert.ok(b.ratio < 1, "handoff é menor que ler tudo")
  assert.match(b.note, /estimativa|estimad/i)
})

test("CONTROLE NEGATIVO: headroom sem routing → nenhum claim de economia", () => {
  const r = headroomClaim({ routed: false })
  assert.equal(r.claimed, false)
  assert.match(r.reason, /callable_not_routed|sem routing/i)
})

test("CONTROLE NEGATIVO: routed mas sem delta medido → ainda sem claim", () => {
  const r = headroomClaim({ routed: true, ledgerDelta: null })
  assert.equal(r.claimed, false)
  assert.match(r.reason, /delta medido/i)
})

test("headroom claim válido: routed + delta medido no ledger", () => {
  const r = headroomClaim({ routed: true, ledgerDelta: 1234 })
  assert.equal(r.claimed, true)
  assert.equal(r.delta, 1234)
  assert.equal(r.source, "measured_ledger")
})
