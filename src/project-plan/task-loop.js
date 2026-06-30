/**
 * Task Loop engine (PRD 12 B1 / dream `task-loop` PARTIAL→REAL). Executa os passos
 * de um plano em WORKTREE isolado: aplica → diff → diff-hygiene → accept/reject, com
 * state/journal CANÔNICO, replay (passos concluídos pulados) e CIRCUIT BREAKER
 * (loop-budget: maxIterations / maxConsecutiveSameFailure). PURO/injetável — todo IO
 * (worktree/git/exec/hygiene/journal/state) entra por `opts`, então é testável sem
 * tocar git nem rede. O journal recebe só RESUMO (stepId/evento/branch/ids de
 * finding) — NUNCA o diff bruto, o comando ou segredos.
 */
export function runTaskLoop(opts = {}) {
  const steps = opts.steps || []
  const budget = opts.budget || {}
  const maxIterations = Number.isInteger(budget.maxIterations) && budget.maxIterations > 0 ? budget.maxIterations : steps.length
  const sameFailLimit = Number.isInteger(budget.maxConsecutiveSameFailure) && budget.maxConsecutiveSameFailure > 0 ? budget.maxConsecutiveSameFailure : 3
  const completed = new Set(opts.completedSteps || [])
  const journal = opts.journal || (() => {})
  const setStep = opts.setStep || (() => {})
  const makeWorktree = opts.makeWorktree || (() => ({ dir: ".", branch: "wt" }))
  const applyStep = opts.applyStep || (() => {})
  const captureDiff = opts.captureDiff || (() => "")
  const hygiene = opts.hygiene || (() => ({ blocked: false, findings: [] }))
  const accept = opts.accept || (() => {})
  const reject = opts.reject || (() => {})

  const result = { status: "done", accepted: [], rejected: [], skipped: [], handoff: null, iterations: 0 }
  let consecutive = 0

  // circuit breaker: N falhas CONSECUTIVAS (apply ou hygiene) → handoff humano; reseta no accept.
  const bumpFailure = () => { consecutive += 1; return consecutive >= sameFailLimit }
  const handoff = (reason, at) => { result.status = "handoff"; result.handoff = { reason, at }; journal({ event: "handoff", reason, stepId: at }) }

  for (const step of steps) {
    if (completed.has(step.id)) { journal({ event: "journal_hit", stepId: step.id }); result.skipped.push(step.id); continue }
    if (result.iterations >= maxIterations) { handoff("maxIterations", step.id); break }
    result.iterations += 1

    const wt = makeWorktree(step)
    journal({ event: "step_started", stepId: step.id, branch: wt && wt.branch })
    setStep(step.id, "running")

    // 1) aplica o passo no worktree (implementação real fica no comando, injetável)
    let diff = ""
    try {
      applyStep(step, wt)
      diff = captureDiff(wt) || ""
    } catch (e) {
      reject(step, wt, "apply_failed")
      journal({ event: "step_failed", stepId: step.id, summary: String((e && e.message) || "apply falhou").split("\n")[0].slice(0, 160) })
      setStep(step.id, "failed")
      result.rejected.push({ stepId: step.id, reason: "apply_failed" })
      if (bumpFailure()) { handoff("sameFailureLimit", step.id); break }
      continue
    }

    // 2) diff-hygiene: segredo/debugger no diff → REJEITA (needs_review), não aceita
    const hy = hygiene(diff, wt) || {}
    if (hy.blocked) {
      reject(step, wt, "hygiene")
      journal({ event: "step_rejected", stepId: step.id, reason: "diff_hygiene", findings: (hy.findings || []).map((f) => f.id || f.rule || "finding") })
      setStep(step.id, "needs_review")
      result.rejected.push({ stepId: step.id, reason: "hygiene", findings: hy.findings || [] })
      if (bumpFailure()) { handoff("sameFailureLimit", step.id); break }
      continue
    }

    // 3) aceita: registra o branch do worktree pronto pra merge (sem auto-merge)
    accept(step, wt)
    journal({ event: "step_accepted", stepId: step.id, branch: wt && wt.branch })
    setStep(step.id, "completed")
    result.accepted.push(step.id)
    consecutive = 0
  }

  return result
}
