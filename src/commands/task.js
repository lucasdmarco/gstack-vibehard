import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { buildTaskPlan } from "../project-plan/task-planner.js"
import { taskRunCommand } from "./task-run.js"
import { worktreeCommand } from "./worktree.js"
import { readEvidence, evidenceSummary, latestByStep } from "../project-plan/evidence-ledger.js"
import { error, info, success, warn, section } from "../cli/index.js"
import { openStateStore } from "../state/store.js"
import { listSessions, refStatus } from "../state/session-index.js"
import { presentCheckpoints, diffCheckpoints, restoreWithProvenance } from "../skills/checkpoint-presenter.js"
import { listCheckpoints } from "../skills/loop-checkpoint.js"
import { buildSessionSummary } from "../usage/session-summary.js"
import { t, resolveLocale } from "../cli/i18n.js"

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
    // PRD48 S48.6 — messageId estável no JSON (contrato de máquina); texto humano localizado.
    if (json) process.stdout.write(JSON.stringify({ error: "session_not_found", messageId: "task.session_not_found", sessionId }) + "\n")
    else error(t("task.session_not_found", { sessionId }, resolveLocale({})))
    return
  }
  const refs = { proofRef: refStatus(session.proofRef, existsSync), contextDeltaRef: refStatus(session.contextDeltaRef, existsSync) }
  // PRD48 S48.5 — budget/usage tipado: sessão hoje não rastreia tokens (fica "unknown",
  // honesto), mas quota já reflete o que o caller informar — nunca fabricado.
  const usage = buildSessionSummary({})
  if (json) { process.stdout.write(JSON.stringify({ session, refs, usage }) + "\n"); return }
  section(`task inspect — ${sessionId}`)
  info(`  status: ${session.status}`)
  info(`  objetivo: ${session.objective || "(sem objetivo)"}`)
  info(`  proofRef: ${refs.proofRef}  contextDeltaRef: ${refs.contextDeltaRef}`)
  info(`  usage: input=${usage.inputTokens.quality} output=${usage.outputTokens.quality} contextAvoided=${usage.contextAvoided.quality} quota=${usage.quota.quality}`)
}

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

// `task checkpoints <runId> [--diff <a> <b>] [--json]` — PRD48 S48.4: wrapper de produto
// sobre o motor real de checkpoint (loop-checkpoint.js, PRD41 S41.7).
function checkpointDiff(cwd, runId, args) {
  const diffIdx = args.indexOf("--diff")
  if (diffIdx < 0) return null
  const all = listCheckpoints({ root: cwd, runId })
  const a = all.find((c) => c.seq === Number(args[diffIdx + 1]))
  const b = all.find((c) => c.seq === Number(args[diffIdx + 2]))
  return diffCheckpoints(a, b)
}
function emitCheckpointsJson(list, diff) {
  process.stdout.write(JSON.stringify({ checkpoints: list, ...(diff ? { diff } : {}) }) + "\n")
}
const checkpointLine = (c) => `  • seq=${c.seq} ${c.green ? "[verde]" : ""} ${c.at} — ${c.note || ""} (${c.fileCount} arquivo(s))`
function renderCheckpointsHuman(runId, list, diff) {
  section(`task checkpoints — ${runId}`)
  if (!list.length) { info("  (nenhum checkpoint ainda)"); return }
  for (const c of list) info(checkpointLine(c))
  if (diff) info(`  diff: ${diff.changed.join(", ") || "(nenhuma mudança)"}`)
}
function checkpointsCmd(cwd, runId, args, json) {
  if (!runId) { error("Uso: task checkpoints <runId>"); return }
  const list = presentCheckpoints({ root: cwd, runId })
  const diff = checkpointDiff(cwd, runId, args)
  if (json) return emitCheckpointsJson(list, diff)
  renderCheckpointsHuman(runId, list, diff)
}

function emitConfirmationRequired(seq, runId, json) {
  if (json) return process.stdout.write(JSON.stringify({ error: "confirmation_required", messageId: "task.checkpoint.confirmation_required" }) + "\n")
  warn(`  ${t("task.checkpoint.confirmation_required", { seq, runId }, resolveLocale({}))}`)
}
function emitRestoreResult(r, seq, json) {
  if (json) return process.stdout.write(JSON.stringify(r) + "\n")
  const loc = resolveLocale({})
  if (!r.ok) return error(t("task.checkpoint.restore_failed", { reason: r.reason }, loc))
  success(`  ${t("task.checkpoint.restored", { seq, count: r.restored.length, receipt: r.provenanceReceipt }, loc)}`)
}
// `task restore <runId> --checkpoint <n> [--yes]` — restore COM provenance (nunca apaga
// audit trail); exige `--yes` explícito (nunca por decreto).
function restoreCmd(cwd, runId, args, json) {
  const seq = Number(flagValue(args, "--checkpoint"))
  if (!runId || !Number.isInteger(seq)) { error("Uso: task restore <runId> --checkpoint <n>"); return }
  if (!args.includes("--yes")) return emitConfirmationRequired(seq, runId, json)
  emitRestoreResult(restoreWithProvenance({ root: cwd, runId, seq }), seq, json)
}

// Handlers simples (sem delegar ao worktree lifecycle) — tabela em vez de cadeia de `if`
// (cc baixa). `task run` executa o loop; evidence/resume são do Evidence Ledger (PRD18);
// history/inspect são o índice unificado de sessão (PRD48 S48.3); checkpoints/restore são
// o checkpoint como produto (PRD48 S48.4).
const SIMPLE_TASK_HANDLERS = Object.freeze({
  run: (args, cwd, positional, json, opts) => taskRunCommand(args, opts),
  evidence: (args, cwd, positional, json) => evidenceCmd(cwd, positional[1], json),
  resume: (args, cwd, positional, json) => resumeCmd(cwd, positional[1], json),
  history: (args, cwd, positional, json) => historyCmd(cwd, json),
  inspect: (args, cwd, positional, json) => inspectCmd(cwd, positional[1], json),
  checkpoints: (args, cwd, positional, json) => checkpointsCmd(cwd, positional[1], args, json),
  restore: (args, cwd, positional, json) => restoreCmd(cwd, positional[1], args, json),
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
