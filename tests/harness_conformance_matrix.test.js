import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("PUBLIC_ENFORCEMENT_LEVELS: exatamente os 5 valores do DoD do sprint 47.10", async () => {
  const { PUBLIC_ENFORCEMENT_LEVELS } = await imp("src/dream/harness-conformance-matrix.js")
  assert.deepEqual([...PUBLIC_ENFORCEMENT_LEVELS], ["native_enforced", "adapter_enforced", "instructional_advisory", "unsupported", "not_tested"])
})

test("buildConformanceMatrix: harness NUNCA testado nesta sessão -> 'not_tested' mesmo com enforcement real_hooks interno (claim limitado ao medido, DoD)", async () => {
  const { buildConformanceMatrix } = await imp("src/dream/harness-conformance-matrix.js")
  const registry = { harnesses: [{ id: "claude", adapter: { enforcement: "real_hooks" }, driftStatus: "consistent" }], driftCount: 0 }
  const m = buildConformanceMatrix({ registry, testedHarnesses: [] })
  assert.equal(m.harnesses[0].publicLevel, "not_tested")
})

test("buildConformanceMatrix: harness TESTADO com real_hooks interno -> native_enforced público", async () => {
  const { buildConformanceMatrix } = await imp("src/dream/harness-conformance-matrix.js")
  const registry = { harnesses: [{ id: "claude", adapter: { enforcement: "real_hooks" }, driftStatus: "consistent" }], driftCount: 0 }
  const m = buildConformanceMatrix({ registry, testedHarnesses: ["claude"] })
  assert.equal(m.harnesses[0].publicLevel, "native_enforced")
})

test("buildConformanceMatrix: enforcement 'instructional' testado NUNCA vira enforced público (harness instrucional não é Zero-Trust)", async () => {
  const { buildConformanceMatrix } = await imp("src/dream/harness-conformance-matrix.js")
  const registry = { harnesses: [{ id: "copilot", adapter: { enforcement: "instructional" }, driftStatus: "consistent" }], driftCount: 0 }
  const m = buildConformanceMatrix({ registry, testedHarnesses: ["copilot"] })
  assert.equal(m.harnesses[0].publicLevel, "instructional_advisory")
})

test("buildConformanceMatrix: enforcement 'detection_only' testado -> unsupported (nunca inflado pra adapter_enforced)", async () => {
  const { buildConformanceMatrix } = await imp("src/dream/harness-conformance-matrix.js")
  const registry = { harnesses: [{ id: "x", adapter: { enforcement: "detection_only" }, driftStatus: "consistent" }], driftCount: 0 }
  const m = buildConformanceMatrix({ registry, testedHarnesses: ["x"] })
  assert.equal(m.harnesses[0].publicLevel, "unsupported")
})

test("buildConformanceMatrix: sem adapter algum -> not_tested (nunca presume)", async () => {
  const { buildConformanceMatrix } = await imp("src/dream/harness-conformance-matrix.js")
  const registry = { harnesses: [{ id: "y", adapter: null, driftStatus: "capabilities_only" }], driftCount: 1 }
  const m = buildConformanceMatrix({ registry, testedHarnesses: ["y"] })
  assert.equal(m.harnesses[0].publicLevel, "not_tested")
})

test("buildConformanceMatrix: reusa buildHarnessRegistry real por default (não duplica a fonte de verdade do PRD46 S46.5)", async () => {
  const { buildConformanceMatrix } = await imp("src/dream/harness-conformance-matrix.js")
  const m = buildConformanceMatrix({ testedHarnesses: [] })
  assert.ok(Array.isArray(m.harnesses))
  assert.ok(m.harnesses.length > 0, "registro real do projeto tem harnesses")
  assert.ok(m.harnesses.every((h) => h.publicLevel === "not_tested"), "nada foi 'testado' nesta chamada -> tudo not_tested, honesto")
})
