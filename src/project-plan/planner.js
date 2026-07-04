/**
 * Planner determinístico: objetivo + nome + modo → plano com PASSOS REAIS.
 *
 * Não chama LLM. Não executa nada (PR5/executor faz isso). Resolve a recipe via
 * classifier, escolhe o modo (explícito ou recomendado) e expande os step-ids em
 * comandos reais do gstack_vibehard. `runtime:*` expande para o supervisor real
 * (`dev`/`logs`/`open`); só dashboard/deploy continuam pendingFeature.
 */
import { makePlan, validatePlan, MODE_IDS } from "./schema.js"
import { classify } from "./classifier.js"
import { getRecipe, DEFAULT_RECIPE_ID } from "./recipes.js"
import { isPendingFeature, getPendingFeature } from "./pending-features.js"

const CLI = "gstack_vibehard"

/** Diretório de trabalho do step após o create (relativo). "." antes de existir o projeto. */
function projectCwd(projectName) {
  return projectName ? `./${projectName}` : "."
}

// Steps FIXOS (id → fábrica): expansão declarativa em comando real. `cwd` default é
// o diretório do projeto (pós-create); `doctor` sobrepõe com "." (roda antes).
// runtime:* é REAL (PRD14 §4.14): todo template do `create` declara .gstack/runtime.json
// e `dev` sobe os serviços destacados e RETORNA (não bloqueia o executor).
const FIXED_STEPS = {
  "doctor": () => ({ label: "Diagnosticar ambiente", command: [CLI, "doctor"], cwd: ".", required: true }),
  "context:init": () => ({ label: "Inicializar contexto do projeto", command: [CLI, "context", "init"], required: true }),
  "context:index": () => ({ label: "Indexar Document Graph local", command: [CLI, "context", "index"], required: true }),
  "tools:suggested": () => ({ label: "Listar integrações sugeridas", command: [CLI, "tools", "suggested"], required: true }),
  "runtime:start": () => ({ label: "Iniciar runtime do projeto (dev)", command: [CLI, "dev"], required: false }),
  "runtime:logs": () => ({ label: "Ver logs do runtime", command: [CLI, "logs"], required: false }),
  "runtime:open": () => ({ label: "Abrir o app do runtime", command: [CLI, "open"], required: false }),
}

// Steps por PREFIXO (prefixo → fábrica que recebe o sufixo).
const PREFIX_STEPS = [
  ["tools:install:", (tool) => ({ label: `Instalar integração: ${tool}`, command: [CLI, "tools", "install", tool], required: false })],
  ["tools:mcp:enable:", (tool) => ({ label: `Habilitar MCP: ${tool}`, command: [CLI, "tools", "mcp", "enable", tool], required: false })],
]

function expandCreate(projectName, template, mode) {
  const cmd = [CLI, "create", projectName || "meu-app", "--template", template]
  if (mode === "lite") cmd.push("--lite")
  return { id: "create", label: `Criar projeto (${template}${mode === "lite" ? ", leve" : ""})`, command: cmd, cwd: ".", required: true }
}
// Features futuras / desconhecidos: nunca carregam comando — o executor as pula.
const pendingStep = (stepId, cwd, label) => ({ id: stepId, label, command: null, cwd, required: false, pendingFeature: true })
/** Expande um step-id declarativo para um step concreto (comando real ou pendingFeature). */
export function expandStep(stepId, ctx) {
  const { projectName, template, mode } = ctx
  const cwd = projectCwd(projectName)
  if (stepId === "create") return expandCreate(projectName, template, mode)
  if (FIXED_STEPS[stepId]) return { id: stepId, cwd, ...FIXED_STEPS[stepId]() }
  const prefixed = PREFIX_STEPS.find(([prefix]) => stepId.startsWith(prefix))
  if (prefixed) return { id: stepId, cwd, ...prefixed[1](stepId.slice(prefixed[0].length)) }
  if (isPendingFeature(stepId)) return pendingStep(stepId, cwd, `${getPendingFeature(stepId).label} — ainda não implementado`)
  return pendingStep(stepId, cwd, `Passo não mapeado: ${stepId}`)
}

/**
 * @param {object} opts { objective, projectName?, mode?, recipeId? }
 * @returns {{ plan, validation }}
 */
// Recipe: explícita ou classificada. Fallback duplo garante recipe sempre válida.
function resolveRecipe(objective, opts) {
  const cls = classify(objective)
  const recipeId = opts.recipeId || cls.recipeId || DEFAULT_RECIPE_ID
  const recipe = getRecipe(recipeId) || getRecipe(DEFAULT_RECIPE_ID)
  return { cls, recipe }
}
// Modo: explícito (válido) ou recomendado pela recipe.
const resolveMode = (opts, recipe) => (MODE_IDS.includes(opts.mode) ? opts.mode : recipe.recommendedMode)
const modeReasonOf = (recipe) => recipe.modeReasons[0] || `modo ${recipe.recommendedMode} recomendado para ${recipe.label}`

export function buildPlan(opts = {}) {
  const objective = opts.objective || ""
  const projectName = opts.projectName || ""
  const { cls, recipe } = resolveRecipe(objective, opts)
  const mode = resolveMode(opts, recipe)
  const modeReason = modeReasonOf(recipe)

  const ctx = { projectName, template: recipe.template, mode }
  const steps = recipe.requiredSteps.map((s) => expandStep(s, ctx))
  const optionalSteps = recipe.optionalSteps.map((s) => expandStep(s, ctx))

  const plan = makePlan({
    objective,
    projectName,
    intent: recipe.id,
    template: recipe.template,
    mode,
    recommendedMode: recipe.recommendedMode,
    modeReason,
    status: "ready",
    steps,
    optionalSteps,
    suggestedIntegrations: recipe.suggestedIntegrations,
    nextActions: [`Revise o plano e rode os passos com confirmação. Recipe: ${recipe.id} (${cls.score} keyword(s) casadas).`],
  })

  return { plan, validation: validatePlan(plan) }
}
