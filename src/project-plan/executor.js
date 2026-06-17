import { execFileSync } from "child_process"
import { resolve, join, dirname } from "path"
import { fileURLToPath } from "url"
import { appendPlanEvent, completedSteps } from "./journal.js"
import { setStepStatus, setPlanStatus } from "./state.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// Único binário permitido em planos. Planos são persistidos/editáveis em
// .gstack/plans/*.json — a allowlist impede que um plano adulterado rode outra coisa.
const ALLOWED_BIN = "gstack_vibehard"
const CLI_ENTRY = join(__dirname, "..", "index.js")

const SECRET_FLAG = /(token|key|secret|password|pat|apikey|api-key|authorization|bearer)/i

/** Redige valores sensíveis do comando antes de ir ao journal (defense-in-depth). */
export function sanitizeCommand(command) {
  const parts = Array.isArray(command) ? command.slice() : [String(command)]
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const p = String(parts[i])
    // flag de segredo → redige o PRÓXIMO token (o valor)
    if (/^--?\w/.test(p) && SECRET_FLAG.test(p)) { out.push(p); if (i + 1 < parts.length) { out.push("***"); i++ } continue }
    // KEY=VALUE com chave sensível
    const kv = p.match(/^([A-Za-z0-9_]+)=(.+)$/)
    if (kv && SECRET_FLAG.test(kv[1])) { out.push(`${kv[1]}=***`); continue }
    // URL com credencial embutida user:pass@host
    out.push(p.replace(/\/\/[^/@\s]+:[^/@\s]+@/g, "//***:***@"))
  }
  return out.join(" ")
}

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

/**
 * Runner padrão: invoca a PRÓPRIA CLI via Node (array de argumentos puro, SEM
 * shell/cmd.exe) — cross-platform e imune a quoting/injeção do cmd.exe. Só aceita
 * o binário da allowlist; qualquer outro comando (plano adulterado) é rejeitado.
 */
function defaultRunner(command, opts) {
  if (!Array.isArray(command) || command.length === 0 || command[0] !== ALLOWED_BIN) {
    throw new Error(`comando não permitido no plano: ${Array.isArray(command) ? command[0] : command}`)
  }
  return execFileSync(process.execPath, [CLI_ENTRY, ...command.slice(1)], { stdio: "pipe", timeout: 600000, ...opts })
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

    // Journal só com RESUMO sanitizado — nunca o comando bruto (defense-in-depth).
    appendPlanEvent(planDir, { event: "step_started", stepId: step.id, command: sanitizeCommand(step.command) })
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
