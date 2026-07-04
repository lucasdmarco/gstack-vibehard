import { execFileSync } from "child_process"
import { resolve, join, dirname } from "path"
import { fileURLToPath } from "url"
import { appendPlanEvent, completedSteps } from "./journal.js"
import { setStepStatus, setPlanStatus } from "./state.js"
import { recordStateEvent } from "../state/store.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// Único binário permitido em planos. Planos são persistidos/editáveis em
// .gstack/plans/*.json — a allowlist impede que um plano adulterado rode outra coisa.
const ALLOWED_BIN = "gstack_vibehard"
const CLI_ENTRY = join(__dirname, "..", "index.js")

const SECRET_FLAG = /(token|key|secret|password|pat|apikey|api-key|authorization|bearer)/i

// Redige UM token. @returns { push:[...], skipNext } (skipNext redige o valor após a flag).
function sanitizePart(p, hasNext) {
  // flag de segredo → redige o PRÓXIMO token (o valor)
  if (/^--?\w/.test(p) && SECRET_FLAG.test(p)) return hasNext ? { push: [p, "***"], skipNext: true } : { push: [p], skipNext: false }
  // KEY=VALUE com chave sensível
  const kv = p.match(/^([A-Za-z0-9_]+)=(.+)$/)
  if (kv && SECRET_FLAG.test(kv[1])) return { push: [`${kv[1]}=***`], skipNext: false }
  // URL com credencial embutida user:pass@host
  return { push: [p.replace(/\/\/[^/@\s]+:[^/@\s]+@/g, "//***:***@")], skipNext: false }
}
/** Redige valores sensíveis do comando antes de ir ao journal (defense-in-depth). */
export function sanitizeCommand(command) {
  const parts = Array.isArray(command) ? command.slice() : [String(command)]
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const r = sanitizePart(String(parts[i]), i + 1 < parts.length)
    out.push(...r.push)
    if (r.skipNext) i++
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

function resolveRunOpts(opts) {
  return {
    baseCwd: opts.cwd || process.cwd(),
    run: opts.exec || defaultRunner,
    includeOptional: opts.includeOptional === true,
  }
}
function beginRun(planDir, plan, includeOptional) {
  const done = completedSteps(planDir)
  setPlanStatus(planDir, plan.id, "running")
  appendPlanEvent(planDir, { event: "run_started", planId: plan.id, resumed: done.size > 0 })
  const queue = [...plan.steps, ...(includeOptional ? plan.optionalSteps : [])]
  const result = { planId: plan.id, status: "done", completed: [], failed: null, skipped: [] }
  return { done, queue, result }
}
// pendingFeature: sem comando — pula honestamente.
function skipStep(planDir, step, result) {
  appendPlanEvent(planDir, { event: "step_skipped", stepId: step.id, reason: "pending_feature" })
  setStepStatus(planDir, step.id, "skipped")
  result.skipped.push(step.id)
}
// Retomada: já concluído → journal_hit, não re-executa.
function resumeStep(planDir, step, result) {
  appendPlanEvent(planDir, { event: "journal_hit", stepId: step.id })
  result.completed.push(step.id)
}
// Passo falhou. @returns o result final (obrigatório derruba) ou null (opcional segue).
function failStep(planDir, step, plan, result, e) {
  // Resumo do erro (sem despejar stdout/stderr bruto no journal).
  const summary = (e.message || "falhou").split("\n")[0].slice(0, 160)
  appendPlanEvent(planDir, { event: "step_failed", stepId: step.id, summary })
  setStepStatus(planDir, step.id, "failed")
  if (step.required === false) { result.skipped.push(step.id); return null }
  result.status = "failed"
  result.failed = { stepId: step.id, summary }
  setPlanStatus(planDir, plan.id, "failed")
  appendPlanEvent(planDir, { event: "run_ended", planId: plan.id, status: "failed", stoppedAt: step.id })
  return result
}
// Executa UM passo real. @returns o result final (parou) ou null (segue).
function runStepOnce(run, planDir, step, baseCwd, plan, result) {
  // Journal só com RESUMO sanitizado — nunca o comando bruto (defense-in-depth).
  appendPlanEvent(planDir, { event: "step_started", stepId: step.id, command: sanitizeCommand(step.command) })
  const cwd = resolve(baseCwd, step.cwd || ".")
  try {
    run(step.command, { cwd })
    appendPlanEvent(planDir, { event: "step_completed", stepId: step.id }) // só resumo
    setStepStatus(planDir, step.id, "completed")
    result.completed.push(step.id)
    return null
  } catch (e) {
    return failStep(planDir, step, plan, result, e)
  }
}
// @returns o result final se o plano deve parar, senão null.
function processStep(run, planDir, step, baseCwd, plan, result, done) {
  if (step.pendingFeature || !Array.isArray(step.command)) { skipStep(planDir, step, result); return null }
  if (done.has(step.id)) { resumeStep(planDir, step, result); return null }
  return runStepOnce(run, planDir, step, baseCwd, plan, result)
}
// State Store (PRD14 §4.4): resumo do run — best-effort, sem output bruto.
function finishRun(baseCwd, planDir, plan, result) {
  setPlanStatus(planDir, plan.id, "done")
  appendPlanEvent(planDir, { event: "run_ended", planId: plan.id, status: "done" })
  recordStateEvent(baseCwd, "workflow_runs", { runId: plan.id, status: "done", completed: result.completed.length, skipped: result.skipped.length })
  return result
}

export function executePlan(opts = {}) {
  const { plan, planDir } = opts
  if (!plan || !planDir) throw new Error("executePlan: plan e planDir são obrigatórios")
  const { baseCwd, run, includeOptional } = resolveRunOpts(opts)
  const { done, queue, result } = beginRun(planDir, plan, includeOptional)
  for (const step of queue) {
    const stopped = processStep(run, planDir, step, baseCwd, plan, result, done)
    if (stopped) return stopped
  }
  return finishRun(baseCwd, planDir, plan, result)
}
