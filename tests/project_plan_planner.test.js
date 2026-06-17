import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("classifier: objetivos mapeiam para a recipe certa", async () => {
  const { classify } = await imp("src/project-plan/classifier.js")
  assert.equal(classify("quero um SaaS com login e Stripe").recipeId, "saas-auth-stripe")
  assert.equal(classify("app mobile para iOS e Android").recipeId, "mobile-backend")
  assert.equal(classify("plataforma de agentes de IA com RAG").recipeId, "ai-agent-platform")
  // sem keyword → default web-app, score 0
  const none = classify("algo totalmente genérico zzz")
  assert.equal(none.recipeId, "web-app")
  assert.equal(none.score, 0)
})

test("planner: plano de SaaS usa template e comandos reais + modo recomendado full", async () => {
  const { buildPlan } = await imp("src/project-plan/planner.js")
  const { plan, validation } = buildPlan({ objective: "SaaS com login e Stripe", projectName: "academiapro" })

  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(plan.intent, "saas-auth-stripe")
  assert.equal(plan.template, "saas-auth-stripe")
  assert.equal(plan.recommendedMode, "full")
  assert.equal(plan.mode, "full")
  assert.ok(plan.modeReason.length > 0)

  // create real com template e nome
  const create = plan.steps.find((s) => s.id === "create")
  assert.deepEqual(create.command, ["gstack_vibehard", "create", "academiapro", "--template", "saas-auth-stripe"])

  // todos os steps executáveis têm comando que começa por gstack_vibehard
  for (const s of plan.steps) {
    assert.ok(Array.isArray(s.command) && s.command[0] === "gstack_vibehard", `${s.id} comando real`)
  }
  // integrações sugeridas reais
  assert.ok(plan.suggestedIntegrations.includes("stripe"))
})

test("planner: modo lite adiciona --lite no create; runtime:start vira pendingFeature", async () => {
  const { buildPlan } = await imp("src/project-plan/planner.js")
  const { plan } = buildPlan({ objective: "app mobile", projectName: "meuapp", mode: "lite" })

  const create = plan.steps.find((s) => s.id === "create")
  assert.ok(create.command.includes("--lite"), "modo lite injeta --lite")

  const runtime = plan.optionalSteps.find((s) => s.id === "runtime:start")
  assert.ok(runtime, "mobile tem runtime:start opcional")
  assert.equal(runtime.pendingFeature, true)
  assert.equal(runtime.command, null, "feature futura não carrega comando")
})

test("planner: cwd dos passos pós-create aponta para o diretório do projeto", async () => {
  const { buildPlan } = await imp("src/project-plan/planner.js")
  const { plan } = buildPlan({ objective: "web app", projectName: "loja" })
  assert.equal(plan.steps.find((s) => s.id === "doctor").cwd, ".")
  assert.equal(plan.steps.find((s) => s.id === "context:init").cwd, "./loja")
})
