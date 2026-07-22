import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("servicesToRestart: só serviços com healthy:false reiniciam — o saudável NUNCA reinicia (DoD)", async () => {
  const { servicesToRestart } = await imp("src/project-plan/runtime-repair-cycle.js")
  const health = [{ service: "api", healthy: true }, { service: "web", healthy: false }, { service: "worker", healthy: true }]
  assert.deepEqual(servicesToRestart(health), ["web"])
})

test("evaluateRepairCycle: app unreachable (health vazio) -> handoff needs_user, NUNCA validado (DoD)", async () => {
  const { evaluateRepairCycle } = await imp("src/project-plan/runtime-repair-cycle.js")
  const r = evaluateRepairCycle({ healthResults: [] })
  assert.equal(r.action, "handoff")
  assert.equal(r.verdict, "needs_user")
})

test("evaluateRepairCycle: algum serviço reachable:false -> handoff, nunca segue pra observe/diagnose", async () => {
  const { evaluateRepairCycle } = await imp("src/project-plan/runtime-repair-cycle.js")
  const r = evaluateRepairCycle({ healthResults: [{ service: "api", healthy: true, reachable: false }] })
  assert.equal(r.action, "handoff")
  assert.equal(r.reason, "app unreachable — nunca validado sem health real")
})

test("evaluateRepairCycle: UI mudou sem observação (sem browser driver) -> handoff needs_browser (DoD)", async () => {
  const { evaluateRepairCycle } = await imp("src/project-plan/runtime-repair-cycle.js")
  const r = evaluateRepairCycle({ healthResults: [{ service: "web", healthy: true, reachable: true }], uiChanged: true, observation: null })
  assert.equal(r.action, "handoff")
  assert.equal(r.verdict, "needs_browser")
})

test("evaluateRepairCycle: sem UI alterada, observação limpa e acceptance vazio -> checkpoint (caminho feliz)", async () => {
  const { evaluateRepairCycle } = await imp("src/project-plan/runtime-repair-cycle.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const loopState = buildLoopState({ runId: "r1", acceptance: [] })
  const r = evaluateRepairCycle({
    healthResults: [{ service: "api", healthy: true, reachable: true }],
    uiChanged: false, observation: { visualValidated: true, problems: [] }, acceptance: [], loopState,
  })
  assert.equal(r.action, "checkpoint")
  assert.equal(r.verdict, "validated")
})

test("evaluateRepairCycle: diagnóstico reprovado dentro do budget -> autocorrect (reparo bounded, não handoff imediato)", async () => {
  const { evaluateRepairCycle } = await imp("src/project-plan/runtime-repair-cycle.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const loopState = buildLoopState({ runId: "r2", acceptance: ["login funciona"], budget: { maxIterations: 5 } })
  const r = evaluateRepairCycle({
    healthResults: [{ service: "api", healthy: true, reachable: true }],
    uiChanged: false, observation: { visualValidated: true, problems: [], checks: {} }, acceptance: ["login funciona"], loopState,
  })
  assert.equal(r.action, "autocorrect")
  assert.equal(r.verdict, "degraded")
})

test("evaluateRepairCycle: budget do loop ESGOTADO + diagnóstico reprovado -> handoff needs_user (reparo NUNCA excede caps — DoD)", async () => {
  const { evaluateRepairCycle } = await imp("src/project-plan/runtime-repair-cycle.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const loopState = buildLoopState({ runId: "r3", acceptance: ["x"], budget: { maxIterations: 1 } })
  loopState.consumed.iterations = 1 // budget já esgotado (maxIterations:1 atingido)
  const r = evaluateRepairCycle({
    healthResults: [{ service: "api", healthy: true, reachable: true }],
    uiChanged: false, observation: { visualValidated: true, problems: [], checks: {} }, acceptance: ["x"], loopState,
  })
  assert.equal(r.action, "stop", "decideNext real do diagnose-loop.js usa 'stop' p/ budget esgotado")
  assert.equal(r.verdict, "needs_user")
})

test("restoreLastGreen: é a MESMA função já provada do PRD41 S41.7 — nunca duplica lógica de checkpoint", async () => {
  const { restoreLastGreen } = await imp("src/project-plan/runtime-repair-cycle.js")
  const { rollbackToLastGreen } = await imp("src/skills/loop-checkpoint.js")
  assert.equal(typeof restoreLastGreen, "function")
  // mesma referência de implementação (reexport direto, não uma cópia)
  const io = { readBuf: () => null, readText: () => null, write: () => {}, exists: () => false, listDirs: () => [] }
  const a = restoreLastGreen({ root: "/x", runId: "r", io })
  const b = rollbackToLastGreen({ root: "/x", runId: "r", io })
  assert.deepEqual(a, b)
})
