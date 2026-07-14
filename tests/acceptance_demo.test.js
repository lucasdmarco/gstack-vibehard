import test from "node:test"
import assert from "node:assert/strict"
import { buildScorecard, scorecardFromProof, DELIVERY_SCORECARD_SCHEMA } from "../src/skills/delivery-scorecard.js"
import { explainProof, ACCEPTANCE_DEMO_SCHEMA } from "../src/skills/acceptance-demo.js"

// PRD42 S42.12 — Acceptance Demo + scorecard + health pós-deploy. Honestidade:
// (1) a MÉDIA nunca esconde um P0; (2) sem deploy = not_applicable (nunca verde);
// (3) visão leiga e técnica são a MESMA evidência (não divergem no veredito).

const proofOf = (overrides = {}) => ({
  schemaVersion: "gstack.proof.v1",
  ready: true,
  blockers: [],
  warnings: [],
  gateRegistry: "gstack.gate-registry.v1",
  checks: {
    verify: { ok: true }, dreamAudit: { ok: true }, gitTree: { ok: true },
    skillGates: { ok: true }, graphifyFreshness: { ok: true },
  },
  ...overrides,
})

test("scorecard: schema e média básica (N/A fora da média)", () => {
  const sc = buildScorecard({ items: [{ id: "a", label: "A", p0: false, status: "passed" }], deploy: {} })
  assert.equal(sc.schema, DELIVERY_SCORECARD_SCHEMA)
  // health é not_applicable (sem deploy) → não entra na média → 1/1
  assert.equal(sc.score.total, 1)
  assert.equal(sc.score.passed, 1)
  assert.equal(sc.verdict, "ready")
})

test("CONTROLE NEGATIVO: média alta NÃO esconde um P0 reprovado", () => {
  const items = [
    { id: "1", label: "1", p0: false, status: "passed" },
    { id: "2", label: "2", p0: false, status: "passed" },
    { id: "3", label: "3", p0: false, status: "passed" },
    { id: "4", label: "4", p0: false, status: "passed" },
    { id: "5", label: "5", p0: false, status: "passed" },
    { id: "6", label: "6", p0: false, status: "passed" },
    { id: "7", label: "7", p0: false, status: "passed" },
    { id: "8", label: "8", p0: false, status: "passed" },
    { id: "9", label: "9", p0: false, status: "passed" },
    { id: "p0", label: "crítico", p0: true, status: "failed" },
  ]
  const sc = buildScorecard({ items, deploy: {} })
  assert.equal(sc.score.pct, 90, "9/10 verdes")
  assert.equal(sc.verdict, "blocked", "90% NÃO pode virar 'ready' com um P0 quebrado")
  assert.deepEqual(sc.p0Failures, ["p0"])
})

test("sem deploy ⇒ health not_applicable, nunca verde nem passed", () => {
  const sc = buildScorecard({ items: [], deploy: { happened: false } })
  const health = sc.items.find((i) => i.id === "health-post-deploy")
  assert.equal(health.status, "not_applicable")
  assert.notEqual(health.status, "passed")
  // N/A não conta como aprovado: sem outros itens, total scored = 0
  assert.equal(sc.score.total, 0)
})

test("deploy quebrado ⇒ health é P0 reprovado ⇒ blocked", () => {
  const sc = buildScorecard({ items: [{ id: "a", label: "A", p0: false, status: "passed" }], deploy: { happened: true, healthy: false } })
  assert.equal(sc.verdict, "blocked")
  assert.ok(sc.p0Failures.includes("health-post-deploy"))
})

test("scorecardFromProof: proof ready ⇒ scorecard ready", () => {
  const sc = scorecardFromProof(proofOf(), {})
  assert.equal(sc.verdict, "ready")
})

test("explainProof: visão leiga e técnica são a MESMA evidência (não divergem)", () => {
  const demo = explainProof(proofOf())
  assert.equal(demo.schema, ACCEPTANCE_DEMO_SCHEMA)
  assert.equal(demo.lay.ready, demo.technical.ready)
  assert.equal(demo.lay.ready, true)
  assert.match(demo.lay.veredito, /PRONTO/)
})

test("CONTROLE NEGATIVO: proof bloqueado ⇒ visão leiga NUNCA diz pronto", () => {
  const proof = proofOf({ ready: false, blockers: ["verify full: not_ready (failed: lint)"], checks: { ...proofOf().checks, verify: { ok: false } } })
  const demo = explainProof(proof)
  assert.equal(demo.lay.ready, false)
  assert.equal(demo.technical.ready, false)
  assert.match(demo.lay.veredito, /AINDA NÃO/)
  assert.ok(demo.lay.oQueFalta.length > 0, "a visão leiga lista o que falta")
  assert.equal(demo.technical.verdict, "blocked")
})
