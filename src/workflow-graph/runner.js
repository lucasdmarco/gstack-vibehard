import { randomUUID } from "crypto"
import { makeState } from "./schema.js"
import { appendEvent, isJournalHit, completedNodes } from "./journal.js"
import { normalizeLoopBudget } from "../loop-budget/policy.js"
import { runDelegation } from "../delegation/opencode.js"

/**
 * Graph runner DETERMINÍSTICO.
 *
 * Nós: planner → rubric → worker → verifier → (retry | done | human_handoff).
 * O LLM (se houver) age DENTRO do worker (via delegação OpenCode); o CÓDIGO
 * decide TODAS as arestas (tests_passed/qg_failed/max_iterations_hit). Caps do
 * loop-budget são respeitados; cada passo vai pro journal (replay pula concluídos).
 *
 * Dependências injetáveis (testes herméticos, sem rede/sem modelo):
 *  - worker(state) → { ok, summary, signature }   (default: delega OpenCode)
 *  - verifier(state) → { passed, signature, detail } (default: determinístico)
 *  - planner(state) / rubric(state) → opcionais (defaults triviais)
 */
export function runWorkflow(opts = {}) {
  const task = opts.task
  const cwd = opts.cwd || process.cwd()
  const budget = normalizeLoopBudget(opts.budget)
  const journalBase = opts.journalBase || (cwd + "/.gstack/workflows/runs")
  const runId = opts.runId || randomUUID().slice(0, 8)
  const log = (event) => appendEvent(journalBase, runId, event)

  const planner = opts.planner || ((s) => ({ plan: `plano para: ${s.task}` }))
  const rubric = opts.rubric || (() => ({ criteria: [{ id: "verify", check: budget.preferredVerifier, required: true }] }))
  const worker = opts.worker || defaultWorker(cwd, budget, opts.exec)
  const verifier = opts.verifier || defaultVerifier(cwd, opts.exec)

  const state = makeState(task)
  // Resume: reconstrói o ponto de retomada a partir do journal existente.
  const resume = replayState(journalBase, runId)
  if (resume.alreadyPassed) {
    return { runId, status: "passed", iterations: resume.lastIteration, journalBase, resumed: true }
  }
  state.iteration = resume.lastIteration // continua da próxima iteração
  log({ event: "run_started", task, resumed: resume.lastIteration > 0 })

  // Nós lineares com replay (planner/rubric só uma vez)
  runNodeOnce("planner", () => planner(state), state, journalBase, runId)
  runNodeOnce("rubric", () => rubric(state), state, journalBase, runId)

  // Wall-time: deadline determinístico aplicado a CADA iteração.
  const now = opts.now || (() => Date.now())
  const deadline = now() + (budget.maxWallTimeSeconds || 900) * 1000

  // Loop worker→verifier com caps determinísticos
  while (true) {
    // ARESTA: estourou o wall-time?
    if (now() >= deadline) {
      state.status = budget.humanHandoffOnCap ? "handoff" : "failed"
      log({ event: "run_ended", nodeId: "human_handoff", reason: "max_wall_time_hit", status: state.status })
      return { runId, status: state.status, iterations: state.iteration, journalBase }
    }

    state.iteration += 1
    const wId = `worker#${state.iteration}`
    // REPLAY: worker já concluído nesta iteração? pula (journal_hit).
    if (isJournalHit(journalBase, runId, wId)) {
      log({ event: "journal_hit", nodeId: wId })
    } else {
      log({ event: "node_started", nodeId: wId })
      const w = worker(state)
      if (w.ok === false) log({ event: "node_failed", nodeId: wId, signature: w.signature || "worker_failed" })
      else log({ event: "node_completed", nodeId: wId, summary: (w.summary || "").slice(0, 200) })
    }

    const vId = `verifier#${state.iteration}`
    // REPLAY: verifier já passou nesta iteração? então o run passou.
    if (isJournalHit(journalBase, runId, vId)) {
      log({ event: "journal_hit", nodeId: vId })
      state.status = "passed"
      break
    }
    log({ event: "node_started", nodeId: vId })
    const v = verifier(state)
    const sig = v.signature || (v.passed ? "passed" : "failed")

    if (v.passed) {
      log({ event: "node_completed", nodeId: vId, signature: sig })
      state.status = "passed"
      break
    }
    log({ event: "node_failed", nodeId: vId, signature: sig })

    state.consecutiveSameFailure = (state.lastFailureSignature === sig) ? state.consecutiveSameFailure + 1 : 1
    state.lastFailureSignature = sig

    if (state.consecutiveSameFailure >= budget.maxConsecutiveSameFailure) {
      state.status = "handoff"
      log({ event: "node_completed", nodeId: "human_handoff", reason: `same_failure x${state.consecutiveSameFailure}` })
      break
    }
    if (state.iteration >= budget.maxIterations) {
      state.status = budget.humanHandoffOnCap ? "handoff" : "failed"
      log({ event: "node_completed", nodeId: "human_handoff", reason: "max_iterations_hit" })
      break
    }
    log({ event: "node_started", nodeId: `retry#${state.iteration}` })
  }

  log({ event: "run_ended", status: state.status, iterations: state.iteration })
  return { runId, status: state.status, iterations: state.iteration, journalBase }
}

/**
 * Reconstrói o estado de retomada a partir do journal de um run.
 * - alreadyPassed: algum verifier#N concluiu (passou) → run já estava OK.
 * - lastIteration: maior N de worker#N concluído (continua da próxima).
 */
function replayState(journalBase, runId) {
  const done = completedNodes(journalBase, runId)
  let lastIteration = 0
  let alreadyPassed = false
  for (const node of done) {
    const mW = /^worker#(\d+)$/.exec(node)
    if (mW) lastIteration = Math.max(lastIteration, Number(mW[1]))
    if (/^verifier#\d+$/.test(node)) alreadyPassed = true
  }
  return { lastIteration, alreadyPassed }
}

function runNodeOnce(nodeId, fn, state, journalBase, runId) {
  if (isJournalHit(journalBase, runId, nodeId)) {
    appendEvent(journalBase, runId, { event: "journal_hit", nodeId })
    return
  }
  appendEvent(journalBase, runId, { event: "node_started", nodeId })
  try {
    fn()
    state.completedNodes.push(nodeId)
    appendEvent(journalBase, runId, { event: "node_completed", nodeId })
  } catch (e) {
    appendEvent(journalBase, runId, { event: "node_failed", nodeId, signature: e.message?.slice(0, 80) })
  }
}

/** Worker padrão: delega ao OpenCode SE a delegação estiver habilitada; senão,
 * emite instrução para o harness atual (não executa modelo). */
function defaultWorker(cwd, budget, exec) {
  return (state) => {
    if (budget.delegation?.enabled) {
      const r = runDelegation({ task: state.task, cwd, exec })
      return { ok: r.status === "ok", summary: r.summary, signature: r.status }
    }
    return { ok: true, summary: `Instrução para o harness atual: ${state.task}`, signature: "instructed" }
  }
}

/** Verifier padrão DETERMINÍSTICO: roda o gate via callback injetável.
 * Sem callback, é neutro (passed:false com 'no_verifier') para forçar config. */
function defaultVerifier(cwd, exec) {
  return (state) => {
    if (typeof state.__verify === "function") return state.__verify()
    return { passed: false, signature: "no_verifier", detail: "configure um verifier (qg/fallow/testes)" }
  }
}
