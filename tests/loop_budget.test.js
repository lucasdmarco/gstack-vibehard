import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const polMod = path.join(repoRoot, "src", "loop-budget", "policy.js")
const delMod = path.join(repoRoot, "src", "delegation", "opencode.js")

test("DEFAULT_LOOP_BUDGET: caps + delegacao desabilitada por default", async () => {
  const { DEFAULT_LOOP_BUDGET } = await import(`${pathToFileURL(polMod)}?t=${Date.now()}`)
  assert.equal(DEFAULT_LOOP_BUDGET.maxIterations, 3)
  assert.equal(DEFAULT_LOOP_BUDGET.delegation.enabled, false)
  assert.equal(DEFAULT_LOOP_BUDGET.delegation.requiresUserApproval, true)
})

test("validateLoopBudget rejeita invalidos e exige approval se delegacao on", async () => {
  const { validateLoopBudget, buildLoopBudget } = await import(`${pathToFileURL(polMod)}?t=${Date.now()}`)
  assert.equal(validateLoopBudget(buildLoopBudget()).valid, true)
  assert.equal(validateLoopBudget({ maxIterations: 0 }).valid, false)
  assert.equal(validateLoopBudget({ maxIterations: 3, maxWallTimeSeconds: 1, maxConsecutiveSameFailure: 1,
    delegation: { enabled: true, requiresUserApproval: false } }).valid, false)
})

test("normalizeLoopBudget preenche defaults em config parcial", async () => {
  const { normalizeLoopBudget } = await import(`${pathToFileURL(polMod)}?t=${Date.now()}`)
  const n = normalizeLoopBudget({ maxIterations: 5 })
  assert.equal(n.maxIterations, 5)
  assert.equal(n.maxConsecutiveSameFailure, 2, "default preenchido")
  assert.equal(n.delegation.enabled, false)
})

test("delegation policy: default off, validacao e task segura", async () => {
  const { buildDelegationPolicy, validateDelegation, isSafeTask } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  const p = buildDelegationPolicy()
  assert.equal(p.enabled, false)
  assert.equal(validateDelegation(p).valid, true)
  assert.equal(validateDelegation({ enabled: true, requiresUserApproval: false }).valid, false)
  // task com espacos OK; com newline rejeitada
  assert.equal(isSafeTask("corrigir o bug de auth"), true)
  assert.equal(isSafeTask("a\nb"), false)
  assert.equal(isSafeTask(""), false)
})
