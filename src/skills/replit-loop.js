import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { buildLoopBudget } from "../loop-budget/policy.js"

/**
 * Replit-Parity Loop Contract (PRD37 37.0/37.1). O diferencial fundador: agir
 * como o Replit — implementar a intenção, RODAR, OBSERVAR, autocorrigir e
 * versionar em checkpoints. Aqui está o CONTRATO do ciclo (o motor de observação
 * e autocorreção entram em D2/D3; os checkpoints em D4):
 *
 *   implement → run → observe → diagnose → autocorrect → checkpoint
 *
 * Regras de honestidade (nunca é enfeite):
 *  - BOUNDED: máximo de N iterações + budget de tempo (reusa loop-budget) — nunca
 *    entra em loop caro infinito, e NUNCA roda a suíte inteira por iteração;
 *  - LLM PROPÕE (implement/autocorrect); a OBSERVAÇÃO e o VERIFIER DECIDEM
 *    (run/observe/diagnose) — o LLM nunca é o gate final;
 *  - só declara `validated` com EVIDÊNCIA (observação limpa); senão `degraded`/
 *    `needs_user`. Nunca finge o ciclo fechado.
 *
 * PURO/testável: io injetável, relógio injetável.
 */

export const REPLIT_LOOP_SCHEMA = "gstack.replit-loop.v1"
export const LOOP_PHASES = Object.freeze(["implement", "run", "observe", "diagnose", "autocorrect", "checkpoint"])

// Quem DECIDE cada fase (o LLM nunca é gate final).
export const PHASE_DECIDER = Object.freeze({
  implement: "llm", run: "runtime", observe: "observation",
  diagnose: "verifier", autocorrect: "llm", checkpoint: "system",
})

// Intenção: distingue "criar projeto" de "implementar feature X" (corrige o
// classificador por substring — B4). scaffold genérico NÃO é o objetivo do ciclo.
export function classifyIntent(text = "") {
  const t = String(text).toLowerCase()
  const createNew = /\b(criar|create|novo|new)\b.*\b(projeto|project|app|site)\b/.test(t)
  return {
    kind: createNew ? "create_project" : "implement_feature",
    isGenericScaffold: createNew && !/\b(com|with|que|feature|tela|página|pagina|fluxo|dashboard|login|crud)\b/.test(t),
  }
}

const loopPath = (root, runId) => join(root, ".gstack", "runs", runId, "loop.json")

const defaultIo = Object.freeze({
  write: (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s) },
  read: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
})

/** Estado inicial do ciclo. `acceptance` = critérios de aceite (o que prova "pronto"). */
export function buildLoopState({ runId, intent = "", acceptance = [], budget = {}, now = () => new Date().toISOString() } = {}) {
  return {
    schemaVersion: REPLIT_LOOP_SCHEMA,
    runId: runId ?? null,
    intent,
    intentKind: classifyIntent(intent).kind,
    acceptance: [...acceptance],
    budget: buildLoopBudget(budget),
    iteration: 0,
    phase: "implement",
    consumed: { iterations: 0, tokens: 0, wallMs: 0 },
    evidence: [],
    history: [],
    verdict: "pending",
    startedAt: now(),
  }
}

/** BOUNDED: estourou iterações OU tempo OU tokens? → { exhausted, reason }. */
export function loopExhausted(state) {
  const b = state.budget, c = state.consumed
  if (c.iterations >= b.maxIterations) return { exhausted: true, reason: `max de ${b.maxIterations} iterações atingido` }
  if (c.wallMs >= b.maxWallTimeSeconds * 1000) return { exhausted: true, reason: `budget de tempo (${b.maxWallTimeSeconds}s) atingido` }
  if (b.maxTokens && c.tokens >= b.maxTokens) return { exhausted: true, reason: `budget de tokens (${b.maxTokens}) atingido` }
  return { exhausted: false }
}

const nextPhaseOf = (phase) => LOOP_PHASES[(LOOP_PHASES.indexOf(phase) + 1) % LOOP_PHASES.length]
const DECISION_PHASES = Object.freeze(["run", "observe", "diagnose"])

const phaseEntry = (phase, result) => ({
  phase,
  decider: PHASE_DECIDER[phase],
  ok: result.ok !== false,
  detail: result.detail || "",
  at: (result.now || (() => new Date().toISOString()))(),
})

const consumedAfter = (state, phase, result) => ({
  iterations: state.consumed.iterations + (phase === "checkpoint" ? 1 : 0),
  tokens: state.consumed.tokens + (result.tokens || 0),
  wallMs: state.consumed.wallMs + (result.ms || 0),
})

// Fase de DECISÃO que falha volta para autocorrect; senão avança no ciclo.
const resolveNextPhase = (phase, result) =>
  (DECISION_PHASES.includes(phase) && result.ok === false) ? "autocorrect" : nextPhaseOf(phase)

/**
 * Registra o resultado de uma fase e avança o estado. `result` =
 * { ok, detail?, evidence?, tokens?, ms? }. Ao fechar um checkpoint, incrementa a
 * iteração. Uma fase de DECISÃO que falha (run/observe/diagnose) volta o ciclo
 * para `autocorrect` (o LLM propõe correção; a próxima observação decide).
 */
export function recordPhase(state, result = {}) {
  const phase = state.phase
  const consumed = consumedAfter(state, phase, result)
  const evidence = result.evidence ? [...state.evidence, result.evidence] : state.evidence
  return {
    ...state,
    phase: resolveNextPhase(phase, result),
    iteration: consumed.iterations,
    consumed, evidence,
    history: [...state.history, phaseEntry(phase, result)],
  }
}

// Observação do navegador (D2) considerada limpa = validou visualmente e zero problemas.
const observationClean = (observed) =>
  Boolean(observed) && observed.visualValidated === true && (observed.problems || []).length === 0

/**
 * Verdito do ciclo — só `validated` com evidência de observação limpa. `observed`
 * = resultado do observe layer (D2) com { visualValidated, problems }.
 */
export function loopVerdict(state, observed = null) {
  const bounded = loopExhausted(state)
  if (observationClean(observed)) {
    return { verdict: "validated", reason: "ciclo fechado com evidência de navegador limpa", bounded }
  }
  if (bounded.exhausted) return { verdict: "needs_user", reason: `parou no limite: ${bounded.reason}`, bounded }
  return { verdict: "degraded", reason: observed ? "observação não validou (problemas pendentes)" : "sem observação de navegador — ciclo não fechou", bounded }
}

/** Persiste o estado do ciclo em .gstack/runs/<runId>/loop.json. */
export function persistLoopState({ root, state, io = defaultIo } = {}) {
  const p = loopPath(root, state.runId || "adhoc")
  io.write(p, JSON.stringify(state, null, 2) + "\n")
  return p
}

export function readLoopState({ root, runId, io = defaultIo } = {}) {
  const raw = io.read(loopPath(root, runId))
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
