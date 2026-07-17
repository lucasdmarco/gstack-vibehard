import test from "node:test"
import assert from "node:assert/strict"
import { buildCleanMachineReport, CAP_STATUS, JOURNEY_STATUS } from "../src/installer/clean-machine-pack.js"

// PRD45 S45.0 ("sem placeholder") — o pack marcava `casdoor-rbac`/`atomic-merge`/
// `agentmemory-persist` como **passed** só porque `docker info` respondia:
//   const engine = dockerAvailable() ? "passed" : "blocked_missing_engine"
// Daemon presente NÃO é prova de RBAC/merge/persistência. O falso-verde foi flagrado ao
// descobrir que o Casdoor sequer bootava — a capacidade era "passed" com o backend MORTO.
// `not_proved` = engine presente, E2E real NÃO executado. Nunca verde, nunca "ready".

const req = (id, status) => ({ id, required: true, platformSupport: { win32: "supported", darwin: "supported", linux: "supported" }, result: { status } })
const okJourneys = [{ id: "j1", status: JOURNEY_STATUS.PASSED }]

test("not_proved é status de primeira classe e NUNCA conta como passed", () => {
  assert.equal(CAP_STATUS.NOT_PROVED, "not_proved")
  const r = buildCleanMachineReport({ platform: "win32", capabilities: [req("casdoor-rbac", CAP_STATUS.NOT_PROVED)], journeys: okJourneys })
  assert.equal(r.summary.capabilities.passed, 0, "CONTROLE NEGATIVO: not_proved não infla o placar de passed")
  assert.equal(r.summary.capabilities.notProved, 1, "aparece no seu próprio contador")
  assert.equal(r.summary.capabilities.total, 1)
})

test("capacidade REQUIRED not_proved => veredito não pode ser `ready`", () => {
  const r = buildCleanMachineReport({ platform: "win32", capabilities: [req("atomic-merge", CAP_STATUS.NOT_PROVED)], journeys: okJourneys })
  assert.notEqual(r.verdict, "ready", "CONTROLE NEGATIVO: prometer 'ready' sem prova é o bug que este sprint mata")
  assert.equal(r.verdict, "capabilities_unproven")
})

test("engine ausente segue `blocked_missing_engine` (não vira not_proved) — distinção honesta", () => {
  const r = buildCleanMachineReport({ platform: "win32", capabilities: [req("casdoor-rbac", CAP_STATUS.BLOCKED_MISSING_ENGINE)], journeys: okJourneys })
  assert.equal(r.verdict, "ready_engines_blocked", "sem Docker é parcial honesto, não 'não provado'")
})

test("falha real e incompletude continuam mandando mais que not_proved (fail-closed preservado)", () => {
  const failed = buildCleanMachineReport({
    platform: "win32",
    capabilities: [req("casdoor-rbac", CAP_STATUS.FAILED), req("atomic-merge", CAP_STATUS.NOT_PROVED)],
    journeys: okJourneys,
  })
  assert.equal(failed.verdict, "not_ready", "falha de required > not_proved")
  const incomplete = buildCleanMachineReport({
    platform: "win32",
    capabilities: [req("atomic-merge", CAP_STATUS.NOT_PROVED)],
    journeys: [{ id: "j1", status: JOURNEY_STATUS.NOT_RUN }],
  })
  assert.equal(incomplete.verdict, "incomplete", "jornada não rodada > not_proved")
})

test("tudo provado de verdade => `ready` (o gate não é impossível de satisfazer)", () => {
  const r = buildCleanMachineReport({ platform: "win32", capabilities: [req("casdoor-rbac", CAP_STATUS.PASSED)], journeys: okJourneys })
  assert.equal(r.verdict, "ready")
  assert.equal(r.summary.capabilities.passed, 1)
})

test("not_proved em capacidade OPCIONAL não bloqueia o veredito", () => {
  const opt = { id: "openhands-sandbox", required: false, platformSupport: { win32: "supported" }, result: { status: CAP_STATUS.NOT_PROVED } }
  const r = buildCleanMachineReport({ platform: "win32", capabilities: [opt], journeys: okJourneys })
  assert.equal(r.verdict, "ready", "opcional não provado é honesto, mas não trava release")
})
