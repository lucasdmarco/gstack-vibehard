import { buildPlan } from "./planner.js"
import { classify } from "./classifier.js"
import { getRecipe } from "./recipes.js"
import { modeWizardText } from "./modes.js"

/**
 * Wizard do `start` — fluxo guiado para usuário leigo (PRD §8). No máximo 5
 * perguntas obrigatórias (objetivo + nome + modo). É PURO em relação a I/O: a UI
 * (prompt/select) é injetada, então o fluxo é testável sem TTY.
 *
 * Retorna { cancelled, plan, validation, recipe, recommended, modeText } — NÃO
 * executa nada; a camada de comando confirma e chama o executor.
 */
export async function runWizard(ui = {}, opts = {}) {
  const ask = ui.prompt || (async () => "")
  const choose = ui.select || (async (_q, optsList) => optsList[0])

  const objective = String(opts.objective ?? (await ask("O que você quer construir? "))).trim()
  if (!objective) return { cancelled: true, reason: "objetivo vazio" }

  const projectName = String(opts.projectName ?? (await ask("Nome do projeto? "))).trim()

  const cls = classify(objective)
  const recipe = getRecipe(cls.recipeId)
  const recommended = recipe.recommendedMode

  let mode = opts.mode
  // --yes / não-interativo: ZERO perguntas extras — usa o modo recomendado
  // (PRD34 §2: com --yes o select real penduraria esperando stdin).
  if (!mode && opts.nonInteractive) mode = recommended
  if (!mode) {
    const choice = await choose(
      `Modo (recomendado: ${recommended} — ${recipe.modeReasons[0] || recipe.label})`,
      ["Leve", "Completo", `Usar recomendado (${recommended})`]
    )
    mode = /leve/i.test(choice) ? "lite" : /completo/i.test(choice) ? "full" : recommended
  }

  const { plan, validation } = buildPlan({ objective, projectName, mode })
  return { cancelled: false, plan, validation, recipe, recommended, modeText: modeWizardText() }
}
