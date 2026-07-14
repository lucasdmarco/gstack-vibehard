import test from "node:test"
import assert from "node:assert/strict"
import {
  runConformance, aggregateVerdict, aggregateRelease, runP0Conformance,
  p0ConformanceSpecs, CONFORMANCE_SCHEMA,
} from "../src/skills/behavioral-conformance.js"

// PRD42 S42.4 — Behavioral Conformance. Provado: (1) as skills P0 se comportam (RED/GREEN/REFACTOR
// sobre o verificador REAL); (2) precedência nonconformant > inconclusive > conformant;
// (3) inconclusive NUNCA é verde no release; (4) uma fase quebrada reprova.

test("P0: design-system e skill-execution são conformant (comportamento medido)", () => {
  const agg = runP0Conformance()
  assert.equal(agg.schema, CONFORMANCE_SCHEMA)
  assert.equal(agg.ready, true)
  assert.deepEqual(agg.reports.map((r) => r.verdict), ["conformant", "conformant"])
  // cada spec exercitou RED/GREEN/REFACTOR
  for (const r of agg.reports) assert.deepEqual(r.phases.map((p) => p.phase), ["red", "green", "refactor"])
})

test("aggregateVerdict: fail domina; inconclusive ≠ verde; tudo pass = conformant", () => {
  assert.equal(aggregateVerdict([{ verdict: "pass" }, { verdict: "fail" }, { verdict: "inconclusive" }]), "nonconformant")
  assert.equal(aggregateVerdict([{ verdict: "pass" }, { verdict: "inconclusive" }]), "inconclusive")
  assert.equal(aggregateVerdict([{ verdict: "pass" }, { verdict: "pass" }]), "conformant")
})

test("CONTROLE NEGATIVO: inconclusive NÃO é ready no release", () => {
  const specInconclusive = { skill: "flaky", scenarios: [{ phase: "red", run: () => ({ inconclusive: true, reason: "sem fixture" }) }] }
  const r = runConformance(specInconclusive)
  assert.equal(r.verdict, "inconclusive")
  assert.equal(aggregateRelease([r]).ready, false, "inconclusive bloqueia o release")
})

test("CONTROLE NEGATIVO: fase quebrada → nonconformant → não ready", () => {
  const broken = { skill: "bad", scenarios: [{ phase: "green", run: () => ({ pass: false }) }] }
  const r = runConformance(broken)
  assert.equal(r.verdict, "nonconformant")
  const agg = aggregateRelease([r])
  assert.equal(agg.ready, false)
  assert.deepEqual(agg.blocked, [{ skill: "bad", verdict: "nonconformant" }])
})

test("erro dentro do cenário vira inconclusive (nunca verde)", () => {
  const throwing = { skill: "boom", scenarios: [{ phase: "red", run: () => { throw new Error("kaboom") } }] }
  const r = runConformance(throwing)
  assert.equal(r.verdict, "inconclusive")
  assert.match(r.phases[0].reason, /kaboom/)
})

test("bound maxMs: cenário lento → inconclusive", () => {
  const slow = { skill: "slow", scenarios: [{ phase: "red", run: () => { const t = Date.now(); while (Date.now() - t < 12) { /* ~12ms */ } return { pass: true } } }] }
  const r = runConformance(slow, { maxMs: 1, maxTurns: 3 })
  assert.equal(r.verdict, "inconclusive", "excedeu maxMs=1")
})

test("p0ConformanceSpecs: todas P0 com 3 fases", () => {
  for (const s of p0ConformanceSpecs()) {
    assert.equal(s.priority, "P0")
    assert.equal(s.scenarios.length, 3)
  }
})
