import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { buildTaskPlan } from "../project-plan/task-planner.js"
import { taskRunCommand } from "./task-run.js"
import { warn, error, info, section } from "../cli/index.js"

/**
 * `task "<pedido>"` — Loop Engineer MVP. Gera (e persiste) um plano de feature/bugfix
 * a partir do Document Graph + workflow + delegação. NÃO executa OpenCode (sempre
 * opt-in com confirmação). Subcomandos de execução/diff chegam com o loop completo.
 */
function tasksDir(cwd) {
  return join(cwd, ".gstack", "tasks")
}

export async function taskCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const positional = args.filter((a) => !a.startsWith("--"))
  const sub = positional[0]

  // `task run [planId]` — EXECUTA o loop em worktree (worktree→diff→hygiene→accept/reject).
  if (sub === "run") { taskRunCommand(args, opts); return }

  // Subcomandos de inspeção do loop ainda pendentes (status/diff/accept/reject manual).
  if (["status", "diff", "accept", "reject"].includes(sub)) {
    if (json) { process.stdout.write(JSON.stringify({ error: "loop_pending", subcommand: sub }) + "\n"); return }
    section(`task ${sub}`)
    warn("Execução/diff/aceite do loop chegam com o motor de execução de tasks.")
    info("Por ora, `task \"<pedido>\"` gera o plano; rode os comandos recomendados (workflow/delegate) você mesmo.")
    return
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
