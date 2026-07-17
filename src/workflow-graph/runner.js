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
const defaultPlanner = (s) => ({ plan: `plano para: ${s.task}` })
const defaultRubric = (budget) => () => ({ criteria: [{ id: "verify", check: budget.preferredVerifier, required: true }] })
// Nós do run, com os defaults injetáveis resolvidos.
function buildRunNodes(opts, cwd, budget) {
  return {
    planner: opts.planner || defaultPlanner,
    rubric: opts.rubric || defaultRubric(budget),
    worker: opts.worker || defaultWorker(cwd, budget, opts.exec),
    verifier: opts.verifier || defaultVerifier(cwd, opts.exec),
  }
}
// Monta deps/config do run (defaults injetáveis). Sem lógica de controle → cc baixa.
function buildRunContext(opts) {
  const cwd = opts.cwd || process.cwd()
  const budget = normalizeLoopBudget(opts.budget)
  const journalBase = opts.journalBase || (cwd + "/.gstack/workflows/runs")
  const runId = opts.runId || randomUUID().slice(0, 8)
  return {
    task: opts.task, budget, journalBase, runId,
    log: (event) => appendEvent(journalBase, runId, event),
    now: opts.now || (() => Date.now()),
    ...buildRunNodes(opts, cwd, budget),
  }
}
// Preâmbulo: replay + planner + rubric (fail-closed). @returns {{ done, result? }} — done:true
// significa que o run já resolveu aqui (resumo/planner/rubric falhou) e não deve entrar no loop.
function prepareRun(ctx, state) {
  const { journalBase, runId, log } = ctx
  const resume = replayState(journalBase, runId)
  if (resume.alreadyPassed) {
    return { done: true, result: { runId, status: "passed", iterations: resume.lastIteration, journalBase, resumed: true } }
  }
  // Retoma UMA iteração antes do último worker concluído (se morreu entre worker#N e verifier#N,
  // re-entra em N e roda o verifier faltante em vez de pular pra N+1).
  state.iteration = Math.max(0, resume.lastIteration - 1)
  log({ event: "run_started", task: ctx.task, resumed: resume.lastIteration > 0 })
  // P0.3: planner/rubric que LANÇAM abortam fail-closed (nunca seguem para worker/verifier).
  if (!runNodeOnce("planner", () => ctx.planner(state), state, journalBase, runId).ok) {
    return { done: true, result: endRunFailClosed(runId, journalBase, "planner_failed", log) }
  }
  if (!runNodeOnce("rubric", () => ctx.rubric(state), state, journalBase, runId).ok) {
    return { done: true, result: endRunFailClosed(runId, journalBase, "rubric_failed", log) }
  }
  return { done: false }
}
// Loop worker→verifier com caps determinísticos.
function runLoop(ctx, state) {
  const { budget, journalBase, runId, log, now } = ctx
  const deadline = now() + (budget.maxWallTimeSeconds || 900) * 1000
  const loop = { anyExecuted: false }
  const stepCtx = { ...ctx, loop }
  while (true) {
    if (now() >= deadline) return endRunWallTime(state, budget, runId, journalBase, log)
    state.iteration += 1
    if (runIteration(stepCtx, state).stop) break
  }
  return finalizeRun(state, loop.anyExecuted, runId, journalBase, log)
}

export function runWorkflow(opts = {}) {
  const ctx = buildRunContext(opts)
  const state = makeState(ctx.task)
  const prep = prepareRun(ctx, state)
  return prep.done ? prep.result : runLoop(ctx, state)
}

// Uma iteração worker→verifier. @returns {{ stop:boolean }}.
function runIteration(ctx, state) {
  if (runWorkerStep(ctx, state) === false) {
    // worker FALHOU ⇒ verifier NÃO roda (P0.3): antes ele rodava e podia marcar passed sobre
    // trabalho não feito (falso verde). Trata como falha da iteração (retry/handoff/cap).
    return handleIterationFailure(state, ctx.budget, `worker#${state.iteration}`, ctx.log)
  }
  return runVerifierStep(ctx, state)
}
// Executa (ou pula por replay) o worker. @returns false se FALHOU; true caso contrário.
function runWorkerStep(ctx, state) {
  const { journalBase, runId, log, loop } = ctx
  const wId = `worker#${state.iteration}`
  if (isJournalHit(journalBase, runId, wId)) { log({ event: "journal_hit", nodeId: wId }); loop.anyExecuted = true; return true }
  log({ event: "node_started", nodeId: wId })
  const w = ctx.worker(state)
  // defaultWorker (instrução, delegação OFF) retorna executed:false; custom sem flag = executou.
  if (w.executed !== false) loop.anyExecuted = true
  if (w.ok === false) { log({ event: "node_failed", nodeId: wId, signature: w.signature || "worker_failed" }); return false }
  log({ event: "node_completed", nodeId: wId, summary: (w.summary || "").slice(0, 200), executed: w.executed === true })
  return true
}
// Executa (ou pula por replay) o verifier. @returns {{ stop:boolean }}.
function runVerifierStep(ctx, state) {
  const { journalBase, runId, log, budget } = ctx
  const vId = `verifier#${state.iteration}`
  if (isJournalHit(journalBase, runId, vId)) { log({ event: "journal_hit", nodeId: vId }); state.status = "passed"; return { stop: true } }
  log({ event: "node_started", nodeId: vId })
  const v = ctx.verifier(state)
  const sig = v.signature || (v.passed ? "passed" : "failed")
  if (v.passed) { log({ event: "node_completed", nodeId: vId, signature: sig }); state.status = "passed"; return { stop: true } }
  log({ event: "node_failed", nodeId: vId, signature: sig })
  return handleIterationFailure(state, budget, sig, log)
}
function endRunWallTime(state, budget, runId, journalBase, log) {
  state.status = budget.humanHandoffOnCap ? "handoff" : "failed"
  log({ event: "run_ended", nodeId: "human_handoff", reason: "max_wall_time_hit", status: state.status })
  return { runId, status: state.status, iterations: state.iteration, journalBase }
}
// HONESTO: "passed" sem nenhum trabalho executado NÃO é "passed" — só instrução ao harness
// (delegação OFF). Status vira `instructed` (não engana o consumidor).
function finalizeRun(state, anyExecuted, runId, journalBase, log) {
  const instructionOnly = state.status === "passed" && !anyExecuted
  const finalStatus = instructionOnly ? "instructed" : state.status
  const warning = instructionOnly
    ? "instruction_only: nenhum worker executou trabalho (delegação OFF); status `instructed`, não `passed`"
    : undefined
  if (warning) log({ event: "run_warning", reason: "instruction_only" })
  log({ event: "run_ended", status: finalStatus, iterations: state.iteration, executed: anyExecuted })
  return { runId, status: finalStatus, iterations: state.iteration, journalBase, executed: anyExecuted, warning }
}

// Encerra o run como `failed` sem tocar worker/verifier (planner/rubric fail-closed).
function endRunFailClosed(runId, journalBase, reason, log) {
  log({ event: "run_ended", status: "failed", reason, iterations: 0, executed: false })
  return { runId, status: "failed", iterations: 0, journalBase, executed: false, reason }
}

/**
 * Máquina de FALHA de iteração, compartilhada por worker-fail (P0.3) e verifier-fail.
 * Atualiza o contador de mesma-assinatura e decide handoff (same-failure), handoff/failed
 * (max_iterations) ou retry. @returns {{ stop:boolean }} — stop=true quebra o loop.
 */
function handleIterationFailure(state, budget, sig, log) {
  state.consecutiveSameFailure = (state.lastFailureSignature === sig) ? state.consecutiveSameFailure + 1 : 1
  state.lastFailureSignature = sig
  if (state.consecutiveSameFailure >= budget.maxConsecutiveSameFailure) {
    state.status = "handoff"
    log({ event: "node_completed", nodeId: "human_handoff", reason: `same_failure x${state.consecutiveSameFailure}` })
    return { stop: true }
  }
  if (state.iteration >= budget.maxIterations) {
    state.status = budget.humanHandoffOnCap ? "handoff" : "failed"
    log({ event: "node_completed", nodeId: "human_handoff", reason: "max_iterations_hit" })
    return { stop: true }
  }
  log({ event: "node_started", nodeId: `retry#${state.iteration}` })
  return { stop: false }
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

// @returns {{ ok:boolean }} — ok:false quando o nó LANÇOU (planner/rubric fail-closed, P0.3).
function runNodeOnce(nodeId, fn, state, journalBase, runId) {
  if (isJournalHit(journalBase, runId, nodeId)) {
    appendEvent(journalBase, runId, { event: "journal_hit", nodeId })
    return { ok: true }
  }
  appendEvent(journalBase, runId, { event: "node_started", nodeId })
  try {
    fn()
    state.completedNodes.push(nodeId)
    appendEvent(journalBase, runId, { event: "node_completed", nodeId })
    return { ok: true }
  } catch (e) {
    appendEvent(journalBase, runId, { event: "node_failed", nodeId, signature: e.message?.slice(0, 80) })
    return { ok: false }
  }
}

/** Worker padrão: delega ao OpenCode SE a delegação estiver habilitada; senão,
 * emite instrução para o harness atual (não executa modelo). */
function defaultWorker(cwd, budget, exec) {
  return (state) => {
    if (budget.delegation?.enabled) {
      const r = runDelegation({ task: state.task, cwd, exec })
      return { ok: r.status === "ok", summary: r.summary, signature: r.status, executed: true }
    }
    // Delegação OFF: o gstack NÃO faz chamada de modelo — apenas emite a instrução
    // para o harness atual. executed:false sinaliza que nenhum trabalho rodou (o
    // "passed" subsequente reflete só o estado pré-existente, não a tarefa feita).
    return { ok: true, summary: `Instrução para o harness atual: ${state.task}`, signature: "instructed", executed: false }
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
