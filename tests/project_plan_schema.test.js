import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("modes: lite e full existem com copy completa", async () => {
  const { MODES, getMode } = await imp("src/project-plan/modes.js")
  for (const id of ["lite", "full"]) {
    const m = MODES[id]
    assert.ok(m, `${id} existe`)
    assert.ok(m.includes.length > 0 && m.bestFor.length > 0 && m.tradeoffs.length > 0)
    assert.ok(Array.isArray(m.deps))
  }
  assert.equal(getMode("full").label, "Completo")
  assert.equal(getMode("inexistente"), null)
})

test("recipes: todas usam templates REAIS e integrações reais", async () => {
  const { RECIPES } = await imp("src/project-plan/recipes.js")
  const { SUGGESTIONS_BY_TEMPLATE } = await imp("src/printing-press/registry.js")
  const real = new Set(Object.keys(SUGGESTIONS_BY_TEMPLATE))
  assert.ok(RECIPES.length >= 7, "ao menos 7 recipes MVP")
  for (const r of RECIPES) {
    assert.ok(real.has(r.template), `${r.id} usa template real: ${r.template}`)
    assert.ok(["lite", "full"].includes(r.recommendedMode))
    assert.ok(r.intentKeywords.length > 0)
    // integrações sugeridas batem com a fonte de verdade do template
    for (const i of r.suggestedIntegrations) {
      assert.ok(SUGGESTIONS_BY_TEMPLATE[r.template].includes(i), `${r.id}: ${i} é real`)
    }
  }
})

test("schema: validatePlan aceita plano mínimo e rejeita inválidos", async () => {
  const { makePlan, makeStep, validatePlan } = await imp("src/project-plan/schema.js")

  const ok = makePlan({ objective: "x", mode: "lite", steps: [{ id: "doctor", label: "Doctor", command: ["gstack_vibehard", "doctor"] }] })
  assert.equal(validatePlan(ok).ok, true)

  // sem steps
  assert.equal(validatePlan(makePlan({ objective: "x" })).ok, false)

  // step pendingFeature COM command → inválido
  const bad = makePlan({ objective: "x", steps: [makeStep({ id: "rt", label: "rt", pendingFeature: true, command: ["x"] })] })
  assert.equal(validatePlan(bad).ok, false)

  // step destrutivo → inválido (execução segura)
  const destr = makePlan({ objective: "x", steps: [makeStep({ id: "d", label: "d", command: ["rm"], destructive: true })] })
  assert.equal(validatePlan(destr).ok, false)
})
