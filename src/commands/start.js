import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { runWizard } from "../project-plan/wizard.js"
import { executePlan } from "../project-plan/executor.js"
import { modeWizardText } from "../project-plan/modes.js"
import { printPlanHuman } from "./plan.js"
import { prompt, select, confirm, success, error, info, section } from "../cli/index.js"

/**
 * `start` — entrada guiada (Replit-like) para usuário leigo. Orquestra o wizard
 * (objetivo → nome → modo), mostra o plano e SÓ executa após confirmação.
 * Reusa planner + executor (não reimplementa nada). UI injetável p/ testes.
 */
export async function startCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const ui = { prompt: opts.prompt || prompt, select: opts.select || select }
  const doConfirm = opts.confirm || confirm

  // start é interativo: sem TTY e sem entradas injetadas → orienta a usar `plan`.
  const injected = opts.objective !== undefined || opts.prompt
  if (!process.stdin.isTTY && !injected) {
    section("start")
    info("start é interativo. Em modo não-interativo use:")
    info('  gstack_vibehard plan "<objetivo>"      # gera o plano')
    info("  gstack_vibehard plan run <id> --yes    # executa")
    return
  }

  section("start — assistente guiado")
  info(modeWizardText())
  info("")

  const res = await runWizard(ui, { objective: opts.objective, projectName: opts.projectName, mode: opts.mode })
  if (res.cancelled) { info("Cancelado — nenhum objetivo informado."); return }
  if (!res.validation.ok) { error(`Plano inválido: ${res.validation.errors.join("; ")}`); return }

  // Persiste para que `plan status/run` enxerguem o plano depois.
  const planDir = join(cwd, ".gstack", "plans", res.plan.id)
  mkdirSync(planDir, { recursive: true })
  writeFileSync(join(planDir, "plan.json"), JSON.stringify(res.plan, null, 2) + "\n")
  writeFileSync(join(planDir, "status.json"), JSON.stringify({ id: res.plan.id, status: "ready", steps: {} }, null, 2) + "\n")

  printPlanHuman(res.plan)

  const autoYes = opts.yes === true
  if (!autoYes) {
    const ok = await doConfirm(`Executar este plano (${res.plan.steps.length} passos)?`, false)
    if (!ok) { info(`Plano salvo. Execute quando quiser: gstack_vibehard plan run ${res.plan.id}`); return { plan: res.plan, executed: false } }
  }

  const result = executePlan({ plan: res.plan, planDir, cwd, exec: opts.exec })
  if (result.status === "done") success(`Concluído: ${result.completed.length} passo(s), ${result.skipped.length} pulado(s).`)
  else error(`Parou em '${result.failed?.stepId}': ${result.failed?.summary}. Retome com: plan run ${res.plan.id}`)
  return { plan: res.plan, result, executed: true }
}
