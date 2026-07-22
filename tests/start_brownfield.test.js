import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.2 — brownfield-plan: nenhuma descoberta escreve; ativação deriva Operation
// Plan do PRD45; dirty tree NUNCA é descartada; usuário sempre escolhe entre 3 opções.

test("proposeBrownfieldChoices: sempre exatamente 3 opções — nunca decide sozinho", async () => {
  const { proposeBrownfieldChoices } = await imp("src/onboarding/brownfield-plan.js")
  const discovery = { languages: ["javascript"], commands: { dev: "npm run dev", test: null, build: null }, git: { isRepo: true, branch: "main", dirty: false }, gstackActivated: false }
  const r = proposeBrownfieldChoices(discovery)
  assert.deepEqual(r.choices, ["plan_only", "activate_with_backup", "cancel"])
})

test("buildActivationPlan: projeto GStack já ativado -> nenhuma operação (idempotente, nunca reescreve)", async () => {
  const { buildActivationPlan } = await imp("src/onboarding/brownfield-plan.js")
  const discovery = { languages: ["javascript"], gstackActivated: true, git: { isRepo: true, branch: "main", dirty: false } }
  const p = buildActivationPlan(discovery)
  assert.deepEqual(p.ops, [])
})

test("buildActivationPlan: projeto NÃO ativado -> operação de ativação real, escopo SÓ .gstack/", async () => {
  const { buildActivationPlan } = await imp("src/onboarding/brownfield-plan.js")
  const discovery = { languages: ["javascript"], gstackActivated: false, git: { isRepo: true, branch: "main", dirty: false } }
  const p = buildActivationPlan(discovery)
  assert.ok(p.ops.length > 0)
  assert.ok(p.ops.every((op) => op.scope === "project"))
})

test("buildActivationPlan: dirty tree -> dirtyTreePreserved:true SEMPRE, nunca descartada (DoD)", async () => {
  const { buildActivationPlan } = await imp("src/onboarding/brownfield-plan.js")
  const dirty = buildActivationPlan({ languages: [], gstackActivated: false, git: { isRepo: true, branch: "main", dirty: true } })
  assert.equal(dirty.dirtyTreePreserved, true)
  const clean = buildActivationPlan({ languages: [], gstackActivated: false, git: { isRepo: true, branch: "main", dirty: false } })
  assert.equal(clean.dirtyTreePreserved, true)
})

test("decideBrownfieldOrNew: workspaceState reconhecido -> 'brownfield'; senão -> 'new'", async () => {
  const { decideBrownfieldOrNew } = await imp("src/onboarding/brownfield-plan.js")
  assert.equal(decideBrownfieldOrNew({ recognized: true }), "brownfield")
  assert.equal(decideBrownfieldOrNew({ recognized: false }), "new")
})
