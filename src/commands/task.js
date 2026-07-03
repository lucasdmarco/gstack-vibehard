import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { buildTaskPlan } from "../project-plan/task-planner.js"
import { taskRunCommand } from "./task-run.js"
import { worktreeCommand } from "./worktree.js"
import { readEvidence, evidenceSummary, latestByStep } from "../project-plan/evidence-ledger.js"
import { error, info, success, warn, section } from "../cli/index.js"

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

export async function taskCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const positional = args.filter((a) => !a.startsWith("--"))
  const sub = positional[0]

  // `task run [planId]` — EXECUTA o loop em worktree (worktree→diff→hygiene→accept/reject).
  if (sub === "run") { taskRunCommand(args, opts); return }

  // `task evidence <id>` / `task resume <id>` — Evidence Ledger (PRD18 Sprint 4).
  if (sub === "evidence") return evidenceCmd(cwd, positional[1], json)
  if (sub === "resume") return resumeCmd(cwd, positional[1], json)

  // Inspeção/aceite do loop: delega ao worktree lifecycle (PRD14 §4.3) — os
  // branches `task/*` criados pelo run são worktrees gstack de primeira classe.
  if (["status", "diff", "accept", "reject"].includes(sub)) {
    const map = { status: "list", diff: "diff", accept: "accept", reject: "discard" }
    return worktreeCommand([map[sub], ...args.slice(args.indexOf(sub) + 1)], opts)
  }

  const request = positional.join(" ").trim()
  if (!request) {
    if (json) { process.stdout.write(JSON.stringify({ error: "missing request" }) + "\n"); return }
    section("task")
    error('Descreva o pedido: task "adicione checkout com Stripe"')
    return
  }

  const hasIndex = existsSync(join(cwd, ".gstack", "context", "context.db"))
  const plan = buildTaskPlan({ request, hasIndex })

  // Persiste (não-destrutivo).
  const dir = join(tasksDir(cwd), plan.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "task.json"), JSON.stringify(plan, null, 2) + "\n")

  if (json) { process.stdout.write(JSON.stringify({ plan, savedTo: dir }) + "\n"); return }

  section(`task — ${request}`)
  info(`  Loop escolhido: ${plan.loopPattern}  (${plan.loopReason})`)
  info("")
  info("  Plano de feature (comandos reais; nada foi executado):")
  plan.steps.forEach((s, i) => {
    const tag = s.requiresConfirmation ? " [requer confirmação]" : s.optional ? " [opcional]" : ""
    info(`   ${i + 1}. ${s.label}${tag}\n        $ ${s.command.join(" ")}`)
  })
  info("")
  for (const n of plan.notes) info(`  • ${n}`)
  info("")
  info(`  Plano salvo em .gstack/tasks/${plan.id}/`)
}
