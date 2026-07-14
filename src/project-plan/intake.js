import { blockingDecisions, resolveDecision } from "./question-registry.js"
import { classify } from "./classifier.js"
import { getRecipe } from "./recipes.js"

/**
 * Intake estruturado (PRD42 S42.1). Roda as decisões BLOQUEANTES do registry rastreando a FONTE
 * de cada valor: `flag` (CLI explícito) · `user_answer` (respondida) · `recommended_default`
 * (--yes/não-interativo usou o default). PURO em I/O: a UI (prompt/select) é injetada.
 *
 * Regra de honestidade: `--yes` NUNCA inventa resposta — grava o default com fonte explícita
 * `recommended_default`, para o Product Brief e o closeout mostrarem o que foi DECIDIDO vs assumido.
 */
export const INTAKE_SOURCES = Object.freeze(["flag", "user_answer", "recommended_default"])
export const INTAKE_SCHEMA = "gstack.intake.v1"

const record = (decision, value, source, resolved) => ({
  id: decision.id, value, source, why: decision.why, consequence: decision.consequence,
  default: resolved.default,
})

/** Pergunta UMA decisão pela UI conforme o `kind`. Retorna o valor bruto escolhido. */
async function ask(decision, resolved, ui) {
  if (decision.kind === "text") {
    const a = String(await ui.prompt(`${decision.prompt} `)).trim()
    return a || resolved.default
  }
  if (decision.kind === "multi") {
    const choice = await ui.select(decision.prompt, ["Recomendadas", "Nenhuma"])
    return /nenhuma/i.test(String(choice)) ? [] : resolved.default
  }
  const labels = resolved.options.map((o) => o.label)
  const picked = await ui.select(`${decision.prompt} (recomendado: ${resolved.default})`, labels)
  const hit = resolved.options.find((o) => o.label === picked)
  return hit ? hit.value : resolved.default
}

/** Resolve UMA decisão: flag > pergunta (interativo) > default (--yes). */
async function resolveOne(decision, ctx) {
  const resolved = resolveDecision(decision, ctx)
  if (Object.prototype.hasOwnProperty.call(ctx.flags, decision.id) && ctx.flags[decision.id] !== undefined) {
    return record(decision, ctx.flags[decision.id], "flag", resolved)
  }
  if (ctx.nonInteractive) return record(decision, resolved.default, "recommended_default", resolved)
  return record(decision, await ask(decision, resolved, ctx.ui), "user_answer", resolved)
}

/** Monta o contexto do intake (objetivo + recipe + flags + UI com defaults). Extraído p/ cc≤6. */
function intakeCtx(opts, objective, recipe) {
  const ui = opts.ui || {}
  return {
    objective, recipe,
    flags: opts.flags || {},
    nonInteractive: Boolean(opts.nonInteractive),
    ui: { prompt: ui.prompt || (async () => ""), select: ui.select || (async (_q, o) => o[0]) },
  }
}

/**
 * Executa o intake completo. `opts`: { objective, flags?, ui?, nonInteractive? }.
 * Retorna { schema, objective, recipe, decisions[] } — não escreve nada.
 */
export async function runIntake(opts = {}) {
  const objective = String(opts.objective || "").trim()
  if (!objective) return { cancelled: true, reason: "objetivo vazio" }
  const recipe = getRecipe(classify(objective).recipeId)
  const ctx = intakeCtx(opts, objective, recipe)
  const decisions = []
  for (const d of blockingDecisions(ctx)) decisions.push(await resolveOne(d, ctx))
  return { schema: INTAKE_SCHEMA, cancelled: false, objective, recipe, decisions }
}

/** Acesso rápido ao valor de uma decisão pelo id. */
export const decisionValue = (decisions, id) => (decisions.find((d) => d.id === id) || {}).value
