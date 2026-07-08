import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("resolveEffortModel: low/medium/high → família; default medium", async () => {
  const { resolveEffortModel } = await imp("src/skills/model-preflight.js")
  assert.equal(resolveEffortModel("low"), "haiku")
  assert.equal(resolveEffortModel("high"), "opus")
  assert.equal(resolveEffortModel("xxx"), "sonnet")
})

test("preflightModel: --model auto resolve por esforço; unknown quando não dá p/ verificar", async () => {
  const { preflightModel } = await imp("src/skills/model-preflight.js")
  const auto = preflightModel({ model: "auto", effort: "high" })
  assert.equal(auto.model, "opus"); assert.equal(auto.status, "unknown"); assert.equal(auto.ok, true)
  const explicit = preflightModel({ model: "sonnet", availableModels: ["sonnet", "opus"] })
  assert.equal(explicit.status, "known"); assert.equal(explicit.ok, true)
})

test("preflightModel: unavailable e user_capped bloqueiam (ok:false)", async () => {
  const { preflightModel } = await imp("src/skills/model-preflight.js")
  const unavail = preflightModel({ model: "gpt-9", availableModels: ["sonnet"] })
  assert.equal(unavail.status, "unavailable"); assert.equal(unavail.ok, false)
  const capped = preflightModel({ model: "opus", budget: { cappedModels: ["opus"] }, availableModels: ["opus"] })
  assert.equal(capped.status, "user_capped"); assert.equal(capped.ok, false)
})

test("loadBudget: ausente = {} ; presente = lido", async () => {
  const { loadBudget } = await imp("src/skills/model-preflight.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-budget-"))
  try {
    assert.deepEqual(loadBudget(dir), {})
    mkdirSync(path.join(dir, ".gstack"), { recursive: true })
    writeFileSync(path.join(dir, ".gstack", "loop-budget.json"), JSON.stringify({ maxIterations: 5, maxDelegationsPerDay: 3 }))
    assert.equal(loadBudget(dir).maxIterations, 5)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("withinBudget: cota diária de delegações atingida bloqueia", async () => {
  const { withinBudget } = await imp("src/skills/model-preflight.js")
  assert.equal(withinBudget({ maxDelegationsPerDay: 3 }, { delegationsToday: 2 }).ok, true)
  assert.equal(withinBudget({ maxDelegationsPerDay: 3 }, { delegationsToday: 3 }).ok, false)
  assert.equal(withinBudget({}, {}).ok, true, "sem cota declarada nunca bloqueia")
})

test("delegate: --model auto resolve e bloqueia user_capped (wiring)", async () => {
  const { delegateCommand } = await imp("src/commands/delegate.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-deleg-"))
  try {
    mkdirSync(path.join(dir, ".gstack"), { recursive: true })
    writeFileSync(path.join(dir, ".gstack", "loop-budget.json"), JSON.stringify({ cappedModels: ["opus"] }))
    const r = await delegateCommand(["opencode", "--task", "x", "--model", "opus"], {
      cwd: dir, availableModels: ["opus", "sonnet"], confirm: async () => true, exec: () => "",
    })
    assert.equal(r.status, "model_user_capped", "modelo capado bloqueia antes de delegar")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
