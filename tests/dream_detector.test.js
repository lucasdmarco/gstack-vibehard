import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("detectGoldenPath: run limpo de primeira (sem sinal) NÃO produz candidate (sem ruído)", async () => {
  const { detectGoldenPath } = await imp("src/dream/detector.js")
  const r = detectGoldenPath({ status: "done", events: [{ event: "pipeline_started" }, { event: "stage_done", stage: "test" }], runId: "r1" })
  assert.equal(r.candidate, null)
})

test("detectGoldenPath: duas tentativas falhas + sucesso final -> candidate bounded, eligible, NUNCA promovido (AC1)", async () => {
  const { detectGoldenPath } = await imp("src/dream/detector.js")
  const events = [
    { event: "attempt_started", attempt: 1 },
    { event: "attempt_failed", attempt: 1 },
    { event: "attempt_started", attempt: 2 },
    { event: "attempt_failed", attempt: 2 },
    { event: "attempt_started", attempt: 3 },
    { event: "stage_done", stage: "test", status: "passed" },
  ]
  const r = detectGoldenPath({ status: "done", events, runId: "r2" })
  assert.ok(r.candidate, "run com retry resolvido produz candidate")
  assert.equal(typeof r.candidate, "object")
  assert.equal(Array.isArray(r.candidate), false, "bounded a UM candidate, nunca lista")
  assert.equal(r.candidate.scope, "project")
  assert.equal(r.candidate.status, "observed", "closeout NUNCA promove — status fica observed")
  assert.equal(r.candidate.validity.status, "eligible")
  assert.ok(r.candidate.source.evidenceRefs !== undefined)
})

test("detectGoldenPath: handoff com tentativas falhas -> NO MÁXIMO tentative, nunca eligible (AC2)", async () => {
  const { detectGoldenPath } = await imp("src/dream/detector.js")
  const events = [
    { event: "attempt_failed", attempt: 1 },
    { event: "attempt_failed", attempt: 2 },
  ]
  const r = detectGoldenPath({ status: "handoff", events, runId: "r3" })
  if (r.candidate) {
    assert.notEqual(r.candidate.validity.status, "eligible")
    assert.equal(r.candidate.status, "observed", "nenhuma promoção em handoff")
  }
})

test("detectGoldenPath: failure (não handoff) com tentativas falhas -> também no máximo tentative", async () => {
  const { detectGoldenPath } = await imp("src/dream/detector.js")
  const events = [{ event: "attempt_failed", attempt: 1 }, { event: "attempt_failed", attempt: 2 }]
  const r = detectGoldenPath({ status: "failed", events, runId: "r4" })
  if (r.candidate) assert.notEqual(r.candidate.validity.status, "eligible")
})

test("detectGoldenPath: evento explícito 'remember' produz candidate mesmo sem falha", async () => {
  const { detectGoldenPath } = await imp("src/dream/detector.js")
  const events = [{ event: "remember", note: "usuário pediu para lembrar este passo" }]
  const r = detectGoldenPath({ status: "done", events, runId: "r5" })
  assert.ok(r.candidate)
  assert.equal(r.candidate.status, "observed")
})

test("detectGoldenPath: dead end com assinatura vira failurePattern redigido no candidate", async () => {
  const { detectGoldenPath } = await imp("src/dream/detector.js")
  const events = [{ event: "dead_end", signature: "dead-1", reason: "tentou X e não funcionou" }]
  const r = detectGoldenPath({ status: "done", events, runId: "r6" })
  assert.ok(r.candidate)
  assert.equal(r.candidate.failurePattern.id, "dead-1")
  assert.deepEqual(r.candidate.deadEnds[0].signature, "dead-1")
})

test("detectGoldenPath: nunca chama transition() — nenhuma promoção acontece na detecção", async () => {
  const mod = await imp("src/dream/detector.js")
  assert.equal(mod.transition, undefined, "detector.js não deve exportar/expor transition — closeout só observa")
})

test("detectSignalsFromEvents: conta falhas/dead-ends/remember sem interpretar transcript bruto", async () => {
  const { detectSignalsFromEvents } = await imp("src/dream/detector.js")
  const s = detectSignalsFromEvents([
    { event: "attempt_failed" }, { event: "attempt_failed" },
    { event: "dead_end", signature: "d1" },
    { event: "remember" },
    { event: "stage_done" }, // evento irrelevante, ignorado
  ])
  assert.equal(s.failedAttempts, 2)
  assert.equal(s.deadEnds.length, 1)
  assert.equal(s.explicitRemember, true)
})
