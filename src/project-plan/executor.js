import { execFileSync } from "child_process"
import { resolve } from "path"
import { appendPlanEvent, completedSteps } from "./journal.js"
import { setStepStatus, setPlanStatus } from "./state.js"

/**
 * Executor de plano (PR5). Roda os PASSOS REAIS em ordem, com journal/estado e
 * retomada. Regras de execução segura (PRD §15):
 *  - para no primeiro erro (não esconde falha);
 *  - passos opcionais só rodam com includeOptional (opt-in);
 *  - passos pendingFeature são pulados (sem comando);
 *  - só RESUMO vai pro journal — nunca output bruto/secrets;
 *  - retomável: passos já concluídos viram journal_hit.
 *
 * A CONFIRMAÇÃO do usuário acontece na camada de comando (plan run), não aqui —
 * o executor é puro e determinístico (exec injetável para testes herméticos).
 */

/** Runner padrão win32-aware: comandos `gstack_vibehard ...` via cmd.exe no Windows. */
function defaultRunner(command, opts) {
  if (process.platform === "win32") {
    return execFileSync("cmd.exe", ["/c", ...command], { stdio: "pipe", timeout: 600000, ...opts })
  }
  return execFileSync(command[0], command.slice(1), { stdio: "pipe", timeout: 600000, ...opts })
}

export function executePlan(opts = {}) {
  const { plan, planDir } = opts
  const baseCwd = opts.cwd || process.cwd()
  const run = opts.exec || defaultRunner
  const includeOptional = opts.includeOptional === true

  if (!plan || !planDir) throw new Error("executePlan: plan e planDir são obrigatórios")

  const done = completedSteps(planDir)
  setPlanStatus(planDir, plan.id, "running")
  appendPlanEvent(planDir, { event: "run_started", planId: plan.id, resumed: done.size > 0 })

  const queue = [...plan.steps, ...(includeOptional ? plan.optionalSteps : [])]
  const result = { planId: plan.id, status: "done", completed: [], failed: null, skipped: [] }

  for (const step of queue) {
    // pendingFeature: sem comando — pula honestamente.
    if (step.pendingFeature || !Array.isArray(step.command)) {
      appendPlanEvent(planDir, { event: "step_skipped", stepId: step.id, reason: "pending_feature" })
      setStepStatus(planDir, step.id, "skipped")
      result.skipped.push(step.id)
      continue
    }
    // Retomada: já concluído → journal_hit, não re-executa.
    if (done.has(step.id)) {
      appendPlanEvent(planDir, { event: "journal_hit", stepId: step.id })
      result.completed.push(step.id)
      continue
    }

    appendPlanEvent(planDir, { event: "step_started", stepId: step.id, command: step.command.join(" ") })
    const cwd = resolve(baseCwd, step.cwd || ".")
    try {
      run(step.command, { cwd })
      appendPlanEvent(planDir, { event: "step_completed", stepId: step.id }) // só resumo
      setStepStatus(planDir, step.id, "completed")
      result.completed.push(step.id)
    } catch (e) {
      // Resumo do erro (sem despejar stdout/stderr bruto no journal).
      const summary = (e.message || "falhou").split("\n")[0].slice(0, 160)
      appendPlanEvent(planDir, { event: "step_failed", stepId: step.id, summary })
      setStepStatus(planDir, step.id, "failed")
      // Passo opcional que falha NÃO derruba o plano; obrigatório derruba.
      if (step.required === false) {
        result.skipped.push(step.id)
        continue
      }
      result.status = "failed"
      result.failed = { stepId: step.id, summary }
      setPlanStatus(planDir, plan.id, "failed")
      appendPlanEvent(planDir, { event: "run_ended", planId: plan.id, status: "failed", stoppedAt: step.id })
      return result
    }
  }

  setPlanStatus(planDir, plan.id, "done")
  appendPlanEvent(planDir, { event: "run_ended", planId: plan.id, status: "done" })
  return result
}
