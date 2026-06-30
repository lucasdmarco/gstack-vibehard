import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { runTaskLoop } from "../project-plan/task-loop.js"
import { createWorktree, removeWorktree, commitWorktree, isGitRepo, checkTrackedSecrets } from "../delegation/worktree.js"
import { diffHygiene } from "../project-plan/diff-hygiene.js"
import { appendPlanEvent, completedSteps } from "../project-plan/journal.js"
import { setStepStatus, setPlanStatus } from "../project-plan/state.js"
import { recordAction } from "../vfa/provenance.js"
import { stripBom } from "../util/json.js"
import { section, success, warn, error, info } from "../cli/index.js"

function latestPlanDir(tasksRoot) {
  if (!existsSync(tasksRoot)) return null
  const dirs = readdirSync(tasksRoot)
    .map((d) => join(tasksRoot, d))
    .filter((d) => { try { return statSync(d).isDirectory() && existsSync(join(d, "task.json")) } catch { return false } })
  if (dirs.length === 0) return null
  return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

function readBudget(cwd) {
  try {
    const lb = JSON.parse(stripBom(readFileSync(join(cwd, ".gstack", "loop-budget.json"), "utf-8")))
    return { maxIterations: lb.maxIterations, maxConsecutiveSameFailure: lb.maxConsecutiveSameFailure }
  } catch { return {} }
}

/**
 * `task run [planId] [--yes] [--json]` — EXECUTA o plano em worktree isolado por passo:
 * aplica → diff → diff-hygiene → accept/reject, com state/journal canônico, replay e
 * circuit breaker. SEM auto-merge: cada passo aceito vira um branch pronto pra revisão.
 * IO injetável (opts) para teste hermético; default usa git/worktree/diffHygiene reais.
 */
export function taskRunCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const yes = args.includes("--yes")
  const planId = args.filter((a) => !a.startsWith("-"))[1] // "run" <planId>
  const tasksRoot = join(cwd, ".gstack", "tasks")
  const planDir = planId ? join(tasksRoot, planId) : latestPlanDir(tasksRoot)
  if (!planDir || !existsSync(join(planDir, "task.json"))) {
    if (json) { process.stdout.write('{"error":"plan_not_found"}\n'); return }
    error('Plano não encontrado. Gere com `task "<pedido>"` primeiro.'); return
  }
  const plan = JSON.parse(stripBom(readFileSync(join(planDir, "task.json"), "utf-8")))

  // Guardas de segurança ANTES de qualquer worktree.
  const injected = opts.makeWorktree || opts.applyStep
  if (!injected) {
    if (!isGitRepo(cwd)) { error("`task run` exige um repositório git (worktree por passo)."); return }
    const tracked = checkTrackedSecrets(cwd)
    if (tracked.length) { error(`.env RASTREADO no git (${tracked.join(", ")}) — não rodo o loop (segredo iria pra worktree). Remova do git primeiro.`); return }
    if (!yes) { warn("`task run` executa comandos reais em worktree por passo. Releia o plano e rode com `--yes`."); return }
  }

  const exec = opts.exec || ((file, a, o) => execFileSync(file, a, { stdio: "pipe", shell: false, timeout: 600000, ...o }))
  const created = []
  setPlanStatus(planDir, plan.id, "running")

  const result = runTaskLoop({
    steps: plan.steps,
    budget: opts.budget || readBudget(cwd),
    completedSteps: [...completedSteps(planDir)],
    journal: (e) => appendPlanEvent(planDir, e),
    setStep: (id, st) => setStepStatus(planDir, id, st),
    makeWorktree: opts.makeWorktree || ((step) => {
      const branch = `task/${plan.id}-${step.id}`.replace(/[^a-zA-Z0-9._/-]/g, "-")
      const wt = createWorktree(cwd, { branch, exec })
      created.push(wt); return wt
    }),
    applyStep: opts.applyStep || ((step, wt) => {
      if (!Array.isArray(step.command) || step.command.length === 0) throw new Error("passo sem comando executável")
      exec(step.command[0], step.command.slice(1), { cwd: wt.dir })
    }),
    captureDiff: opts.captureDiff || ((wt) => {
      try { exec("git", ["add", "-A"], { cwd: wt.dir }); return String(exec("git", ["diff", "--cached"], { cwd: wt.dir, encoding: "utf-8" }) || "") } catch { return "" }
    }),
    hygiene: opts.hygiene || ((_diff, wt) => {
      const r = diffHygiene({ cwd: wt.dir, exec })
      return { blocked: r.status === "fail", findings: r.findings }
    }),
    accept: opts.accept || ((step, wt) => {
      try { commitWorktree(wt.dir, `task ${plan.id}: ${step.id}`, { exec }) } catch { /* nada a commitar */ }
      removeWorktree(cwd, wt.dir, wt.branch, { keepBranch: true, exec }) // mantém o branch p/ merge humano
      // VFA: recibo encadeado da ação ACEITA (intent/target/policy — hashes, sem diff cru)
      try { recordAction(cwd, { runId: plan.id, intent: "task_step_accept", actor: { harness: "gstack", agent: "task-loop" }, target: { kind: "branch", pathOrName: wt.branch }, output: step.id, policy: { decision: "allow", rules: ["diff-hygiene"] } }) } catch { /* provenance best-effort */ }
    }),
    reject: opts.reject || ((step, wt, reason) => {
      removeWorktree(cwd, wt.dir, wt.branch, { exec })
      try { recordAction(cwd, { runId: plan.id, intent: "task_step_reject", actor: { harness: "gstack", agent: "task-loop" }, target: { kind: "step", pathOrName: step.id }, policy: { decision: "deny", rules: [String(reason || "rejected")] } }) } catch { /* best-effort */ }
    }),
  })

  setPlanStatus(planDir, plan.id, result.status === "handoff" ? "handoff" : (result.rejected.length ? "partial" : "done"))

  if (json) { process.stdout.write(JSON.stringify({ planId: plan.id, ...result, branches: created.map((w) => w.branch) }) + "\n"); return }
  section(`task run — ${plan.id}`)
  for (const id of result.accepted) success(`  ✓ ${id}: aceito`)
  for (const r of result.rejected) warn(`  ⚠ ${r.stepId}: rejeitado (${r.reason})`)
  for (const id of result.skipped) info(`  • ${id}: pulado (replay/journal)`)
  if (result.handoff) error(`  ⛔ handoff: ${result.handoff.reason} — revise e retome (\`task run\` pula os já aceitos).`)
  const branches = result.accepted.map((id) => `task/${plan.id}-${id}`)
  info(`  Branches prontos pra merge (SEM auto-merge): ${branches.join(", ") || "(nenhum)"}`)
}
