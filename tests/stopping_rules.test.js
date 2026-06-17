import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("stopping-rules: mapeiam para campos reais do loop-budget", async () => {
  const { STOPPING_RULES, resolveStoppingRules } = await imp("src/project-plan/stopping-rules.js")
  const { DEFAULT_LOOP_BUDGET } = await imp("src/loop-budget/policy.js")
  // os mapsTo apontam para campos que existem no budget
  for (const r of Object.values(STOPPING_RULES)) {
    if (r.mapsTo) assert.ok(r.mapsTo in DEFAULT_LOOP_BUDGET, `${r.id} mapeia campo real: ${r.mapsTo}`)
  }
  const resolved = resolveStoppingRules(["maxIterations", "sameFailureLimit", "stopBeforeDestructiveCommand"], DEFAULT_LOOP_BUDGET)
  const byId = Object.fromEntries(resolved.map((x) => [x.id, x]))
  assert.equal(byId.maxIterations.value, DEFAULT_LOOP_BUDGET.maxIterations)
  assert.equal(byId.sameFailureLimit.value, DEFAULT_LOOP_BUDGET.maxConsecutiveSameFailure)
  assert.equal(byId.stopBeforeDestructiveCommand.value, null, "regra declarativa sem número")
})
