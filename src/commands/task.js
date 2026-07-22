import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { buildTaskPlan } from "../project-plan/task-planner.js"
import { taskRunCommand } from "./task-run.js"
import { worktreeCommand } from "./worktree.js"
import { readEvidence, evidenceSummary, latestByStep } from "../project-plan/evidence-ledger.js"
import { error, info, success, warn, section } from "../cli/index.js"
import { openStateStore } from "../state/store.js"
import { listSessions, refStatus } from "../state/session-index.js"

/**
 * `task "<pedido>"` — Loop Engineer MVP. Gera (e persiste) um plano de feature/bugfix
 * a partir do Document Graph + workflow + delegação. NÃO executa OpenCode (sempre
 * opt-in com confirmação). Subcomandos de execução/diff chegam com o loop completo.
 */
function tasksDir(cwd) {
  return join(cwd, ".gstack", "tasks")
}

function printEvidenceSummary(summary) {
  const head = summary.complete ? "COMPLETE (com prova)" : "INCOMPLETO — no proof, no done"
  const tail = `provado=${summary.proved} falhou=${summary.failed} pendente=${summary.pending}`
  ;(summary.complete ? success : warn)(`  ${head}: ${tail}`)
}

function printEvidenceSteps(entries) {
  for (const e of latestByStep(entries)) info(`  • [${e.status}] ${e.step} — ${e.result || e.action || ""}`)
}

/** `task evidence <id>` — mostra o evidence ledger (proved/failed/pending). */
function evidenceCmd(cwd, taskId, json) {
  if (!taskId) { error("Uso: task evidence <taskId>"); return }
  const entries = readEvidence(cwd, taskId)
  const summary = evidenceSummary(entries)
  if (json) { process.stdout.write(JSON.stringify({ taskId, summary, steps: latestByStep(entries) }) + "\n"); return }
  section(`task evidence — ${taskId}`)
  if (!entries.length) { info("  (sem evidência — rode `start` ou `task run` para produzir recibos)"); return }
  printEvidenceSteps(entries)
  printEvidenceSummary(summary)
}

/** `task resume <id>` — aponta o primeiro passo failed/pending a retomar. */
function resumeCmd(cwd, taskId, json) {
  if (!taskId) { error("Uso: task resume <taskId>"); return }
  const pend = latestByStep(readEvidence(cwd, taskId)).filter((e) => e.status === "failed" || e.status === "pending")
  if (json) { process.stdout.write(JSON.stringify({ taskId, resumable: pend.map((e) => ({ step: e.step, status: e.status })) }) + "\n"); return }
  section(`task resume — ${taskId}`)
  if (!pend.length) { success("  Nada a retomar — todos os passos provados/neutros."); return }
  info("  Retome a partir de (primeiro failed/pending):")
  for (const e of pend) info(`   - [${e.status}] ${e.step}: ${e.result || "(sem detalhe)"}`)
}

// `task history [--json]` — PRD48 S48.3: índice unificado de sessão sobre o State Store
// real (PRD14 §4.4) — mesma verdade operacional que `start`/readiness/proof consultam.
function historyCmd(cwd, json) {
  const store = openStateStore(cwd)
  const sessions = listSessions(store, { limit: 20 })
  store.close()
  if (json) { process.stdout.write(JSON.stringify({ sessions }) + "\n"); return }
  section("task history")
  if (!sessions.length) { info("  (nenhuma sessão registrada ainda — rode `start`)"); return }
  for (const s of sessions) info(`  • [${s.status}] ${s.sessionId} — ${s.objective || "(sem objetivo)"} (${s.updatedAt})`)
}

// `task inspect <sessionId> [--json]` — detalhe da sessão + status REAL das refs
// (proofRef/contextDeltaRef): stale se o arquivo referenciado não existe mais.
function inspectCmd(cwd, sessionId, json) {
  const store = openStateStore(cwd)
  const sessions = listSessions(store, { limit: 200 })
  store.close()
  const session = sessions.find((s) => s.sessionId === sessionId)
  if (!session) {
    if (json) process.stdout.write(JSON.stringify({ error: "session_not_found", sessionId }) + "\n")
    else error(`sessão não encontrada: ${sessionId}`)
    return
  }
  const refs = { proofRef: refStatus(session.proofRef, existsSync), contextDeltaRef: refStatus(session.contextDeltaRef, existsSync) }
  if (json) { process.stdout.write(JSON.stringify({ session, refs }) + "\n"); return }
  section(`task inspect — ${sessionId}`)
  info(`  status: ${session.status}`)
  info(`  objetivo: ${session.objective || "(sem objetivo)"}`)
  info(`  proofRef: ${refs.proofRef}  contextDeltaRef: ${refs.contextDeltaRef}`)
}

// Handlers simples (sem delegar ao worktree lifecycle) — tabela em vez de cadeia de `if`
// (cc baixa). `task run` executa o loop; evidence/resume são do Evidence Ledger (PRD18);
// history/inspect são o índice unificado de sessão (PRD48 S48.3).
const SIMPLE_TASK_HANDLERS = Object.freeze({
  run: (args, cwd, positional, json, opts) => taskRunCommand(args, opts),
  evidence: (args, cwd, positional, json) => evidenceCmd(cwd, positional[1], json),
  resume: (args, cwd, positional, json) => resumeCmd(cwd, positional[1], json),
  history: (args, cwd, positional, json) => historyCmd(cwd, json),
  inspect: (args, cwd, positional, json) => inspectCmd(cwd, positional[1], json),
})
// Inspeção/aceite delegado ao worktree lifecycle (PRD14 §4.3) — branches `task/*`.
const WORKTREE_TASK_SUBS = Object.freeze({ status: "list", diff: "diff", accept: "accept", reject: "discard" })

// Subcomandos de execução/inspeção. @returns true se um handler assumiu o comando.
function dispatchTaskSub(sub, args, cwd, positional, json, opts) {
  if (SIMPLE_TASK_HANDLERS[sub]) { SIMPLE_TASK_HANDLERS[sub](args, cwd, positional, json, opts); return true }
  if (WORKTREE_TASK_SUBS[sub]) {
    worktreeCommand([WORKTREE_TASK_SUBS[sub], ...args.slice(args.indexOf(sub) + 1)], opts)
    return true
  }
  return false
}
const stepTag = (s) => (s.requiresConfirmation ? " [requer confirmação]" : s.optional ? " [opcional]" : "")
// Persiste (não-destrutivo). @returns o diretório do plano.
function persistTask(cwd, plan) {
  const dir = join(tasksDir(cwd), plan.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "task.json"), JSON.stringify(plan, null, 2) + "\n")
  return dir
}
function renderTaskPlan(request, plan) {
  section(`task — ${request}`)
  info(`  Loop escolhido: ${plan.loopPattern}  (${plan.loopReason})`)
  info("")
  info("  Plano de feature (comandos reais; nada foi executado):")
  plan.steps.forEach((s, i) => info(`   ${i + 1}. ${s.label}${stepTag(s)}\n        $ ${s.command.join(" ")}`))
  info("")
  for (const n of plan.notes) info(`  • ${n}`)
  info("")
  info(`  Plano salvo em .gstack/tasks/${plan.id}/`)
}
export async function taskCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const positional = args.filter((a) => !a.startsWith("--"))
  const sub = positional[0]
  if (dispatchTaskSub(sub, args, cwd, positional, json, opts)) return
  const request = positional.join(" ").trim()
  if (!request) {
    if (json) return process.stdout.write(JSON.stringify({ error: "missing request" }) + "\n")
    section("task"); error('Descreva o pedido: task "adicione checkout com Stripe"')
    return
  }
  const hasIndex = existsSync(join(cwd, ".gstack", "context", "context.db"))
  const plan = buildTaskPlan({ request, hasIndex })
  const dir = persistTask(cwd, plan)
  if (json) return process.stdout.write(JSON.stringify({ plan, savedTo: dir }) + "\n")
  renderTaskPlan(request, plan)
}
