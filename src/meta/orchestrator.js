/**
 * Meta-Harness v2 (PRD 13 §11 + PRD 14 §6.5). Máquina de estado que orquestra a
 * implementação por especialidade: planner → executor em WORKTREE → verifier
 * INDEPENDENTE → gates DETERMINÍSTICOS → provenance, com HARD CAPS e SEM auto-merge.
 *
 * v2 adiciona: reviewer LLM PLUGÁVEL (advisory, com fallback determinístico
 * DECLARADO quando indisponível) e PARALELISMO por waves de passos independentes
 * (`dependsOn`), com limite de concorrência.
 *
 * REGRA DE OURO (§11.4.1 — dupla verificação): o reviewer LLM é ADVISORY; quem decide
 * "pronto" é o gate determinístico (Fallow/QG/testes/diff-hygiene). Uma revisão LLM
 * NUNCA muda o status para `passed` sozinha; se o LLM aprovar e o QG falhar, o run
 * FALHA (nunca `passed`). PURO/injetável — executor/verifier/gate entram por opts.
 */

/** Limites ATUAIS do orchestrate, declarados no resultado (aceite PRD14 §8). */
export const ORCHESTRATION_LIMITS = Object.freeze([
  "reviewer LLM é advisory — nunca aprova sem o gate determinístico passar",
  "paralelismo só entre passos independentes (dependsOn) e no mesmo host",
  "sem auto-merge: passo aprovado vira branch para revisão humana",
  "harness instrucional não tem enforcement pre-tool — cobertura advisory",
])

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

const stepSpecialty = (step) => step.specialty || step.kind || "implementation"
const matchesSpec = (specs, want) => Array.isArray(specs) && specs.includes(want)
/** Planner: escolhe o harness executor pela matriz de especialidade. */
export function pickExecutor(step = {}, matrix = {}) {
  const want = stepSpecialty(step)
  for (const [h, specs] of Object.entries(matrix)) if (matchesSpec(specs, want)) return h
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
 * Agrupa os passos em WAVES executáveis em paralelo: um passo entra na wave
 * quando todas as suas `dependsOn` (que existem no plano) já rodaram. Ciclo de
 * dependência → degrada para SEQUENCIAL na ordem dada (honesto e determinístico).
 */
export function buildWaves(steps = []) {
  const ids = new Set(steps.map((s) => s.id))
  const done = new Set()
  const waves = []
  let pending = [...steps]
  while (pending.length) {
    const ready = pending.filter((s) => (s.dependsOn || []).every((d) => !ids.has(d) || done.has(d)))
    if (ready.length === 0) {
      pending.forEach((s) => waves.push([s])) // ciclo: um por wave, ordem dada
      break
    }
    waves.push(ready)
    ready.forEach((s) => done.add(s.id))
    pending = pending.filter((s) => !ready.includes(s))
  }
  return waves
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Cobertura de revisão DECLARADA no resultado (nunca OK falso). */
function reviewerCoverage(opts) {
  if (opts.reviewer) return opts.reviewer.available ? "llm_advisory_plus_gate" : "deterministic_only"
  return opts.verifierReview ? "llm_advisory_plus_gate" : "deterministic_only"
}

/** §11.4: risco alto exige verificador ≠ executor; sem isso, bloqueia o run. */
function highRiskBlocked(step, executor, verifier, ctx) {
  if (step.risk !== "high") return null
  if (verifier && verifier !== executor) return null
  ctx.record({ runId: ctx.runId, intent: "orchestrate:reject_no_independent_verifier", actor: { harness: executor }, policy: { decision: "deny", rules: ["verifier-must-differ-on-high-risk"] } })
  return { reason: "verifier_must_differ", at: step.id }
}

/** Fase ADVISORY: reviewer LLM comenta; a opinião vira recibo, nunca decisão. */
async function reviewPhase(step, exec, verifier, ctx) {
  const review = (await ctx.verifierReview(step, exec, verifier)) || { ok: true }
  ctx.record({ runId: ctx.runId, intent: "orchestrate:llm_review_advisory", actor: { harness: verifier, agent: "verifier" }, policy: { decision: review.ok ? "allow" : "challenge", rules: review.flagged ? ["llm-flagged"] : [] } })
  return review
}

/** Fase BLOQUEANTE: gate determinístico decide (Fallow/QG/diff-hygiene/testes). */
async function gatePhase(step, exec, ctx) {
  const det = (await ctx.gate(step, exec)) || { passed: false, reason: "sem gate" }
  ctx.record({ runId: ctx.runId, intent: "orchestrate:deterministic_gate", policy: { decision: det.passed ? "allow" : "deny", rules: [det.reason].filter(Boolean) } })
  return det
}

/** Executa UM passo: executor → review advisory → gate bloqueante → decisão. */
async function runStep(step, ctx) {
  const executor = pickExecutor(step, ctx.matrix)
  const verifier = pickVerifier(executor, ctx.matrix, ctx.verifyWith)
  const blocked = highRiskBlocked(step, executor, verifier, ctx)
  if (blocked) return { blocked }

  const exec = (await ctx.executeStep(step, executor)) || {}
  ctx.record({ runId: ctx.runId, intent: "orchestrate:execute", actor: { harness: executor, agent: "executor" }, target: { kind: "branch", pathOrName: exec.branch }, output: step.id, policy: { decision: "allow" } })

  const review = await reviewPhase(step, exec, verifier, ctx)
  const det = await gatePhase(step, exec, ctx)
  const decision = decideStatus({ deterministicGate: det, llmReview: review })
  return { entry: { stepId: step.id, executor, verifier, branch: exec.branch, status: decision.status, reason: decision.reason } }
}

/** Aplica o circuit breaker sobre os resultados na ORDEM do plano. */
function applyBreaker(result, entries, caps, sameFailLimit) {
  for (const e of entries) {
    result.steps.push(e)
    if (e.status === "passed") { result.consecutive = 0; continue }
    result.consecutive += 1
    if (caps.abortOnRepeatedFailure !== false && result.consecutive >= sameFailLimit) {
      result.status = "handoff"
      result.handoff = { reason: "abortOnRepeatedFailure", at: e.stepId }
      return true
    }
  }
  return false
}

const resolveMaxIterations = (caps, steps) =>
  (Number.isInteger(caps.maxIterations) && caps.maxIterations > 0 ? caps.maxIterations : steps.length)
function buildRunConfig(opts) {
  const steps = opts.steps || []
  const caps = opts.caps || {}
  return {
    steps, caps,
    maxIterations: resolveMaxIterations(caps, steps),
    sameFailLimit: caps.maxConsecutiveSameFailure || 3,
    concurrency: Math.max(1, opts.concurrency || 1),
  }
}
const defaultVerifierReview = (reviewer) =>
  (reviewer && reviewer.available ? (step, exec) => reviewer.review(step, exec) : () => ({ ok: true, advisory: true }))
function buildCtx(opts, reviewer) {
  return {
    runId: opts.runId,
    matrix: opts.matrix || { claude: ["implementation", "refactor"], codex: ["code-review", "tests"] },
    verifyWith: opts.verifyWith,
    executeStep: opts.executeStep || (() => ({ branch: "wt", diff: "" })),
    verifierReview: opts.verifierReview || defaultVerifierReview(reviewer),
    gate: opts.gate || (() => ({ passed: true })),
    record: opts.record || (() => {}),
  }
}
function initResult(reviewer, opts) {
  return {
    status: "done", steps: [], handoff: null, iterations: 0, consecutive: 0,
    reviewer: reviewer ? { id: reviewer.id, mode: reviewer.mode, note: reviewer.note } : null,
    reviewerCoverage: reviewerCoverage(opts),
    limits: [...ORCHESTRATION_LIMITS],
  }
}

// Executa um batch (dentro do limite de concorrência). @returns true se deve parar.
async function runBatch(batch, ctx, cfg, result) {
  const room = cfg.maxIterations - result.iterations
  if (room <= 0) { result.status = "handoff"; result.handoff = { reason: "maxIterations", at: batch[0].id }; return true }
  const toRun = batch.slice(0, room)
  result.iterations += toRun.length
  const outcomes = await Promise.all(toRun.map((s) => runStep(s, ctx)))
  const blocked = outcomes.find((o) => o.blocked)
  if (blocked) { result.status = "handoff"; result.handoff = blocked.blocked; return true }
  return applyBreaker(result, outcomes.map((o) => o.entry), cfg.caps, cfg.sameFailLimit)
}
async function runWaves(ctx, cfg, result) {
  for (const wave of buildWaves(cfg.steps)) {
    if (result.status === "handoff") break
    for (const batch of chunk(wave, cfg.concurrency)) {
      if (result.status === "handoff") break
      if (await runBatch(batch, ctx, cfg, result)) break
    }
  }
}
function finalizeStatus(result) {
  delete result.consecutive
  if (result.status === "done" && result.steps.some((s) => s.status !== "passed")) result.status = "partial"
  return result
}

/**
 * Orquestra os passos em waves (paralelismo entre independentes, concorrência
 * limitada). Hard caps (maxIterations, abortOnRepeatedFailure) preservados —
 * o breaker corta waves FUTURAS (a wave em voo termina; documentado em limits).
 */
export async function runOrchestration(opts = {}) {
  const reviewer = opts.reviewer || null
  const cfg = buildRunConfig(opts)
  const ctx = buildCtx(opts, reviewer)
  const result = initResult(reviewer, opts)
  await runWaves(ctx, cfg, result)
  return finalizeStatus(result)
}
