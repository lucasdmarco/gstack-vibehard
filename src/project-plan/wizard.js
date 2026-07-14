import { buildPlan } from "./planner.js"
import { runIntake } from "./intake.js"
import { buildProductBrief } from "./product-brief.js"
import { modeWizardText } from "./modes.js"

/**
 * Wizard do `start` — fluxo guiado para usuário leigo (PRD §8; evoluído no PRD42 S42.1). Agora
 * é uma CASCA fina sobre o intake estruturado: pergunta o objetivo (seed) e delega as DECISÕES
 * bloqueantes a `runIntake` (fonte rastreada: flag/user_answer/recommended_default), depois monta
 * o Product Brief (aceites com verificador REAL ou `pending_verifier`). PURO em I/O (UI injetada).
 *
 * Retorna { cancelled, plan, validation, recipe, recommended, modeText, intake, brief } — NÃO
 * executa nada; a camada de comando confirma e chama o executor.
 */
function intakeFlags(opts) {
  const f = {}
  if (opts.projectName != null && String(opts.projectName).trim() !== "") f.projectName = String(opts.projectName).trim()
  if (opts.mode) f.mode = opts.mode
  return f
}

export async function runWizard(ui = {}, opts = {}) {
  const ask = ui.prompt || (async () => "")
  const objective = String(opts.objective ?? (await ask("O que você quer construir? "))).trim()

  const intake = await runIntake({ objective, flags: intakeFlags(opts), nonInteractive: Boolean(opts.nonInteractive), ui })
  if (intake.cancelled) return { cancelled: true, reason: intake.reason }

  const brief = buildProductBrief(intake)
  const { plan, validation } = buildPlan({ objective: brief.objective, projectName: brief.projectName, mode: brief.mode })
  return {
    cancelled: false, plan, validation,
    recipe: intake.recipe, recommended: intake.recipe.recommendedMode,
    modeText: modeWizardText(), intake, brief,
  }
}
