import { randomUUID } from "crypto"
import { makeState } from "./schema.js"
import { appendEvent, isJournalHit } from "./journal.js"
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
  log({ event: "run_started", task })

  // Nós lineares com replay (planner/rubric só uma vez)
  runNodeOnce("planner", () => planner(state), state, journalBase, runId)
  runNodeOnce("rubric", () => rubric(state), state, journalBase, runId)

  // Loop worker→verifier com caps determinísticos
  while (true) {
    state.iteration += 1
    const wId = `worker#${state.iteration}`
    log({ event: "node_started", nodeId: wId })
    const w = worker(state)
    if (w.ok === false) {
      log({ event: "node_failed", nodeId: wId, signature: w.signature || "worker_failed" })
    } else {
      log({ event: "node_completed", nodeId: wId, summary: (w.summary || "").slice(0, 200) })
    }

    const vId = `verifier#${state.iteration}`
    log({ event: "node_started", nodeId: vId })
    const v = verifier(state)
    const sig = v.signature || (v.passed ? "passed" : "failed")

    // ARESTA determinística: passed?
    if (v.passed) {
      log({ event: "node_completed", nodeId: vId, signature: sig })
      state.status = "passed"
      break
    }
    log({ event: "node_failed", nodeId: vId, signature: sig })

    // contabiliza falha consecutiva igual
    state.consecutiveSameFailure = (state.lastFailureSignature === sig) ? state.consecutiveSameFailure + 1 : 1
    state.lastFailureSignature = sig

    // ARESTA: circuit breaker (mesma falha repetida)
    if (state.consecutiveSameFailure >= budget.maxConsecutiveSameFailure) {
      state.status = "handoff"
      log({ event: "node_completed", nodeId: "human_handoff", reason: `same_failure x${state.consecutiveSameFailure}` })
      break
    }
    // ARESTA: cap de iterações
    if (state.iteration >= budget.maxIterations) {
      state.status = budget.humanHandoffOnCap ? "handoff" : "failed"
      log({ event: "node_completed", nodeId: "human_handoff", reason: "max_iterations_hit" })
      break
    }
    // senão: retry (volta ao topo do loop)
    log({ event: "node_started", nodeId: `retry#${state.iteration}` })
  }

  log({ event: "run_ended", status: state.status, iterations: state.iteration })
  return { runId, status: state.status, iterations: state.iteration, journalBase }
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
