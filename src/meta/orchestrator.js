/**
 * Meta-Harness MVP (PRD 13 PR13.6 / §11). Máquina de estado que orquestra a
 * implementação por especialidade: planner → executor em WORKTREE → verifier
 * INDEPENDENTE → gates DETERMINÍSTICOS → provenance, com HARD CAPS e SEM auto-merge.
 *
 * REGRA DE OURO (§11.4.1 — dupla verificação): o reviewer LLM é ADVISORY; quem decide
 * "pronto" é o gate determinístico (Fallow/QG/testes/diff-hygiene). Uma revisão LLM
 * NUNCA muda o status para `passed` sozinha; se o LLM aprovar e o QG falhar, o run
 * FALHA (nunca `passed`). PURO/injetável — executor/verifier/gate entram por opts.
 */

/**
 * Decisão de status (o coração do D1). `deterministicGate` decide; `llmReview` é só sinal.
 * → { status, reason? }. status ∈ failed | blocked_gate_missing | needs_human_review | passed.
 */
export function decideStatus({ deterministicGate = {}, llmReview = {} } = {}) {
  if (deterministicGate.missing) {
    return { status: "blocked_gate_missing", reason: "Fallow/QG indisponível em fluxo que exige o gate" }
  }
  if (!deterministicGate.passed) {
    // LLM pode ter aprovado — NÃO importa: o gate determinístico falhou → nunca passed.
    return { status: "failed", reason: deterministicGate.reason || "gate determinístico falhou (LLM é advisory)" }
  }
  if (llmReview.risk === "high" || llmReview.flagged === true) {
    return { status: "needs_human_review", reason: "QG passou, mas o reviewer LLM apontou risco alto" }
  }
  return { status: "passed" }
}

/** Planner: escolhe o harness executor pela matriz de especialidade. */
export function pickExecutor(step = {}, matrix = {}) {
  const want = step.specialty || step.kind || "implementation"
  for (const [h, specs] of Object.entries(matrix)) if (Array.isArray(specs) && specs.includes(want)) return h
  return Object.keys(matrix)[0] || "claude"
}

/** Escolhe um verifier DIFERENTE do executor (preferindo quem faz code-review). */
export function pickVerifier(executor, matrix = {}, forced) {
  if (forced && forced !== executor) return forced
  const reviewers = Object.entries(matrix).filter(([h, s]) => h !== executor && Array.isArray(s) && s.includes("code-review")).map(([h]) => h)
  if (reviewers.length) return reviewers[0]
  const others = Object.keys(matrix).filter((h) => h !== executor)
  return others[0] || null
}

/**
 * Orquestra os passos. Por passo: executor implementa (worktree, injetável) → verifier
 * revisa (advisory) → gate determinístico (bloqueante) → decideStatus → provenance.
 * Hard caps (maxIterations, abortOnRepeatedFailure). Executor ≠ verifier em risco alto.
 */
export function runOrchestration(opts = {}) {
  const steps = opts.steps || []
  const caps = opts.caps || {}
  const matrix = opts.matrix || { claude: ["implementation", "refactor"], codex: ["code-review", "tests"] }
  const verifyWith = opts.verifyWith
  const maxIterations = Number.isInteger(caps.maxIterations) && caps.maxIterations > 0 ? caps.maxIterations : steps.length
  const sameFailLimit = caps.maxConsecutiveSameFailure || 3
  const executeStep = opts.executeStep || (() => ({ branch: "wt", diff: "" }))
  const verifierReview = opts.verifierReview || (() => ({ ok: true }))
  const gate = opts.gate || (() => ({ passed: true }))
  const record = opts.record || (() => {})

  const result = { status: "done", steps: [], handoff: null, iterations: 0 }
  let consecutive = 0

  for (const step of steps) {
    if (result.iterations >= maxIterations) { result.status = "handoff"; result.handoff = { reason: "maxIterations", at: step.id }; break }
    result.iterations += 1

    const executor = pickExecutor(step, matrix)
    const verifier = pickVerifier(executor, matrix, verifyWith)

    // §11.4: o verificador NÃO pode ser o executor quando o risco é alto.
    if (step.risk === "high" && (!verifier || verifier === executor)) {
      record({ runId: opts.runId, intent: "orchestrate:reject_no_independent_verifier", actor: { harness: executor }, policy: { decision: "deny", rules: ["verifier-must-differ-on-high-risk"] } })
      result.status = "handoff"; result.handoff = { reason: "verifier_must_differ", at: step.id }
      break
    }

    const exec = executeStep(step, executor) || {}
    record({ runId: opts.runId, intent: "orchestrate:execute", actor: { harness: executor, agent: "executor" }, target: { kind: "branch", pathOrName: exec.branch }, output: step.id, policy: { decision: "allow" } })

    const review = verifierReview(step, exec, verifier) || { ok: true } // ADVISORY
    record({ runId: opts.runId, intent: "orchestrate:llm_review_advisory", actor: { harness: verifier, agent: "verifier" }, policy: { decision: review.ok ? "allow" : "challenge", rules: review.flagged ? ["llm-flagged"] : [] } })

    const det = gate(step, exec) || { passed: false, reason: "sem gate" } // BLOQUEANTE
    record({ runId: opts.runId, intent: "orchestrate:deterministic_gate", policy: { decision: det.passed ? "allow" : "deny", rules: [det.reason].filter(Boolean) } })

    const decision = decideStatus({ deterministicGate: det, llmReview: review })
    result.steps.push({ stepId: step.id, executor, verifier, branch: exec.branch, status: decision.status, reason: decision.reason })

    if (decision.status === "passed") { consecutive = 0 } else {
      consecutive += 1
      if (caps.abortOnRepeatedFailure !== false && consecutive >= sameFailLimit) { result.status = "handoff"; result.handoff = { reason: "abortOnRepeatedFailure", at: step.id }; break }
    }
  }

  if (result.status === "done" && result.steps.some((s) => s.status !== "passed")) result.status = "partial"
  return result
}
