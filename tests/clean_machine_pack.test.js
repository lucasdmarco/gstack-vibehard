import test from "node:test"
import assert from "node:assert/strict"
import { buildCleanMachineReport, capabilityRow, CLEANMACHINE_SCHEMA, CAP_STATUS } from "../src/installer/clean-machine-pack.js"

// PRD42 S42.13 — Clean-Machine Test Pack. Honestidade: só `passed` é verde; N/A e
// blocked_missing_engine nunca contam; unsupported→N/A por plataforma; jornada falha→not_ready;
// jornada não-rodada→incomplete. Backend sem engine = blocked (nunca "ready" liso, nunca "not_ready").

const cap = (id, over = {}) => ({ id, required: true, platformSupport: { win32: "supported", linux: "supported", darwin: "supported" }, result: { status: "passed" }, ...over })
const journey = (id, status) => ({ id, status })

const okJourneys = () => [journey("create-lite", "passed"), journey("proof-full", "passed")]

test("relatório verde: schema, verdict ready, placar", () => {
  const rep = buildCleanMachineReport({ platform: "linux", capabilities: [cap("lite")], journeys: okJourneys() })
  assert.equal(rep.schema, CLEANMACHINE_SCHEMA)
  assert.equal(rep.verdict, "ready")
  assert.equal(rep.summary.capabilities.passed, 1)
  assert.equal(rep.summary.journeys.passed, 2)
})

test("unsupported na plataforma corrente ⇒ not_applicable, nunca passed", () => {
  const row = capabilityRow(cap("sandbox", { platformSupport: { win32: "unsupported" }, result: { status: "passed" } }), "win32")
  assert.equal(row.status, CAP_STATUS.NOT_APPLICABLE)
  assert.notEqual(row.status, CAP_STATUS.PASSED)
})

test("CONTROLE NEGATIVO: backend REQUIRED sem engine ⇒ blocked_missing_engine ⇒ ready_engines_blocked (nunca 'ready')", () => {
  const backend = cap("casdoor", { result: { status: "blocked_missing_engine", reason: "docker daemon ausente" } })
  const rep = buildCleanMachineReport({ platform: "linux", capabilities: [cap("lite"), backend], journeys: okJourneys() })
  assert.equal(rep.verdict, "ready_engines_blocked")
  assert.notEqual(rep.verdict, "ready")
  assert.equal(rep.summary.capabilities.blockedMissingEngine, 1)
  assert.equal(rep.summary.capabilities.passed, 1, "o backend bloqueado NÃO conta como passed")
})

test("CONTROLE NEGATIVO: jornada FALHA ⇒ not_ready mesmo com tudo verde", () => {
  const rep = buildCleanMachineReport({
    platform: "linux",
    capabilities: [cap("lite")],
    journeys: [journey("create-lite", "passed"), journey("dev-health", "failed")],
  })
  assert.equal(rep.verdict, "not_ready")
})

test("jornada declarada mas não rodada ⇒ incomplete (nunca 'ready')", () => {
  const rep = buildCleanMachineReport({
    platform: "linux",
    capabilities: [cap("lite")],
    journeys: [journey("create-lite", "passed"), { id: "checkpoint-rollback" }],
  })
  assert.equal(rep.journeys.find((j) => j.id === "checkpoint-rollback").status, "not_run")
  assert.equal(rep.verdict, "incomplete")
})

test("capacidade REQUIRED que FALHA de verdade ⇒ not_ready", () => {
  const rep = buildCleanMachineReport({
    platform: "linux",
    capabilities: [cap("lite", { result: { status: "failed", reason: "vazou casdoor" } })],
    journeys: okJourneys(),
  })
  assert.equal(rep.verdict, "not_ready")
})

test("sem result ⇒ blocked_missing_engine (engine não provado, não 'passed')", () => {
  const row = capabilityRow({ id: "atomic", required: true, platformSupport: { linux: "supported" } }, "linux")
  assert.equal(row.status, CAP_STATUS.BLOCKED_MISSING_ENGINE)
})
