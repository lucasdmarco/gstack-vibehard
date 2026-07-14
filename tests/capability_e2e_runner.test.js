import test from "node:test"
import assert from "node:assert/strict"

// PRD42 S42.0D — gating dos E2E de backend. O invariante: engine ausente NUNCA vira skip-verde;
// backend required sem engine BLOQUEIA. Testável sem Docker (a lógica é pura).

test("classifyE2E: sem Docker → blocked_missing_engine (nunca passed/skip)", async () => {
  const { classifyE2E } = await import("../src/capabilities/e2e-runner.js")
  const r = classifyE2E({ capability: "casdoor", dockerUp: false, result: { ok: true } })
  assert.equal(r.status, "blocked_missing_engine", "sem engine não passa mesmo com result.ok")
  assert.notEqual(r.status, "passed")
})

test("classifyE2E: com Docker, probe decide passed|failed", async () => {
  const { classifyE2E } = await import("../src/capabilities/e2e-runner.js")
  assert.equal(classifyE2E({ capability: "casdoor", dockerUp: true, result: { ok: true } }).status, "passed")
  assert.equal(classifyE2E({ capability: "casdoor", dockerUp: true, result: { ok: false, detail: "401 esperado não veio" } }).status, "failed")
  assert.equal(classifyE2E({ capability: "atomic", dockerUp: true, result: null }).status, "failed", "sem resultado de probe = failed, não passed")
})

test("dockerAvailable: fail-closed (probe lança/false → ausente)", async () => {
  const { dockerAvailable } = await import("../src/capabilities/e2e-runner.js")
  assert.equal(dockerAvailable(() => true), true)
  assert.equal(dockerAvailable(() => false), false)
  assert.equal(dockerAvailable(() => { throw new Error("no daemon") }), false)
})

test("aggregate: required blocked/failed derruba ready; opcional não", async () => {
  const { aggregateCapabilityE2E } = await import("../src/capabilities/e2e-runner.js")
  const obligations = { casdoor: "required", openhands: "optional" }
  const blockedReq = aggregateCapabilityE2E(
    [{ capability: "casdoor", status: "blocked_missing_engine" }, { capability: "openhands", status: "passed" }], obligations)
  assert.equal(blockedReq.ready, false, "required blocked → não ready")
  assert.deepEqual(blockedReq.blocked, [{ capability: "casdoor", status: "blocked_missing_engine" }])

  // CONTROLE NEGATIVO: opcional falho NÃO bloqueia; required tudo passed → ready.
  const okReq = aggregateCapabilityE2E(
    [{ capability: "casdoor", status: "passed" }, { capability: "openhands", status: "failed" }], obligations)
  assert.equal(okReq.ready, true, "required passed + opcional failed → ready")
})
