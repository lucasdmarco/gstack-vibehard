import { buildLoopBudget } from "../loop-budget/policy.js"
import { REPLIT_LOOP_SCHEMA } from "./replit-loop.js"

/**
 * Loop Engine canônico (PRD41 S41.4 / PRD40 P0.5 + P0.6 + P1.5).
 *
 * O `replit-loop.js` é o SCHEMA; ESTE é o único que MUTA a fase e os contadores. Fecha
 * três defeitos:
 *  - **P0.5 (ordem real):** o pipeline completo só avança por transições declaradas —
 *    fase fora de ordem é REJEITADA com erro tipado `invalid_transition` (não registrada,
 *    não silenciada). Chamar `economy`/`diagnose` fora de hora não "acontece".
 *  - **P0.6 (caps incontornáveis):** os contadores (tentativas, wall-clock, tokens, falhas
 *    idênticas consecutivas, thrash por hash de diff/erro) são calculados PELO MOTOR — o
 *    chamador NÃO injeta `consumed`. Atingiu limite → hard halt + status tipado.
 *  - **P1.5 (status tipado):** o desfecho é `completed | planned_only | handoff | blocked |
 *    cancelled | not_executed | running` — nunca um "done" frouxo.
 */
export const LOOP_ENGINE_SCHEMA = "gstack.loop-engine.v1"

// Pipeline completo (PRD40 §7.2). `implement` re-entra via `autocorrect` (bounded).
export const ENGINE_PHASES = Object.freeze([
  "intent", "plan", "scout", "approve", "implement", "run", "observe",
  "diagnose", "autocorrect", "checkpoint", "verify", "proof", "handoff",
])

// Transições permitidas. `diagnose` decide: falhou → autocorrect; ok → checkpoint.
// `autocorrect` re-entra em implement (bounded pelos caps). Terminais: handoff/done.
export const ALLOWED_TRANSITIONS = Object.freeze({
  intent: ["plan"],
  plan: ["scout"],
  scout: ["approve"],
  approve: ["implement"],
  implement: ["run"],
  run: ["observe"],
  observe: ["diagnose"],
  diagnose: ["autocorrect", "checkpoint"],
  autocorrect: ["implement"],
  checkpoint: ["verify"],
  verify: ["proof"],
  proof: ["handoff"],
  handoff: [],
})

export const TERMINAL_STATUSES = Object.freeze([
  "completed", "planned_only", "handoff", "blocked", "cancelled", "not_executed",
])

/** Posição da fase no pipeline (−1 se desconhecida). Fonte única de ORDEM — quem
 * precisa saber "a fase X já passou por Y?" consulta aqui, não reimplementa ranking. */
export function phaseRank(phase) {
  return ENGINE_PHASES.indexOf(phase)
}

/** `current` já alcançou (>=) a fase mínima `min`? Usado por comandos que só fazem
 * sentido após certo ponto do ciclo (ex.: fechar economia exige ter diagnosticado). */
export function phaseAtLeast(current, min) {
  const c = phaseRank(current), m = phaseRank(min)
  if (m < 0) return { ok: false, reason: `fase mínima desconhecida: ${min}` }
  if (c < 0) return { ok: false, reason: `fase atual desconhecida: ${current}` }
  if (c < m) return { ok: false, reason: `invalid_transition: fase '${current}' está antes de '${min}'` }
  return { ok: true }
}

export class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`invalid_transition: '${from}' → '${to}' não é permitida`)
    this.name = "InvalidTransitionError"
    this.code = "invalid_transition"
    this.from = from
    this.to = to
  }
}

/** Hash estável e curto de um texto (diff/erro) para detectar thrashing sem guardar o
 * conteúdo bruto (sem prompt/segredo). FNV-1a — determinístico e barato. */
export function stableHash(text) {
  let h = 0x811c9dc5
  const s = String(text ?? "")
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export class LoopEngine {
  constructor({ runId = null, intent = "", acceptance = [], budget = {}, clock } = {}) {
    this.schemaVersion = LOOP_ENGINE_SCHEMA
    this.runId = runId
    this.intent = intent
    this.acceptance = [...acceptance]
    this.budget = buildLoopBudget(budget)
    this._clock = typeof clock === "function" ? clock : () => Date.now()
    this._startMs = this._clock()
    this.phase = "intent"
    // Contadores SÓ do motor — nunca vêm de fora (P0.6).
    this._counters = { attempts: 0, tokens: 0, consecutiveIdenticalFailures: 0 }
    this._lastFailKey = null
    this._seenFailKeys = new Set()
    this.status = "running"
    this.haltReason = null
    this.history = []
  }

  /** Muta a fase SE a transição for permitida; senão lança `invalid_transition`. */
  advance(to) {
    const allowed = ALLOWED_TRANSITIONS[this.phase] || []
    if (!allowed.includes(to)) throw new InvalidTransitionError(this.phase, to)
    this.history.push({ from: this.phase, to, at: this._clock() - this._startMs })
    this.phase = to
    return this.phase
  }

  /** Registra UMA tentativa (implement/run/observe/diagnose). O motor incrementa os
   * contadores e detecta thrash (mesmo diff/erro repetido). Retorna o cap-status. */
  recordAttempt(input = {}) {
    this._counters.attempts += 1
    this._counters.tokens += toCount(input.tokens)
    this._trackFailure(input.errorHash || input.diffHash || null)
    return this.capStatus()
  }

  /** Contabiliza falhas repetidas (thrashing) e distintas, sem guardar conteúdo bruto. */
  _trackFailure(failKey) {
    if (failKey && failKey === this._lastFailKey) this._counters.consecutiveIdenticalFailures += 1
    else this._counters.consecutiveIdenticalFailures = failKey ? 1 : 0
    if (failKey) this._seenFailKeys.add(failKey)
    this._lastFailKey = failKey
  }

  /** Wall-clock medido pelo RELÓGIO do motor (não aceito de fora). */
  wallMs() {
    return Math.max(0, this._clock() - this._startMs)
  }

  counters() {
    return { ...this._counters, wallMs: this.wallMs(), distinctFailures: this._seenFailKeys.size }
  }

  /** Algum limite estourou? Se sim, faz hard halt (status `blocked`) e retorna o motivo. */
  capStatus() {
    const b = this.budget
    const c = this.counters()
    const reason = firstCapBreached(b, c)
    if (reason && this.status === "running") {
      this.status = "blocked"
      this.haltReason = reason
    }
    return { halted: Boolean(reason), reason: reason || null, counters: c }
  }

  /**
   * Desfecho tipado (P1.5). `completed` EXIGE prova real: aceites todos resolvidos +
   * observação fresca + checkpoint verde PROVADO + proof.ready. Sem execução → estados
   * honestos (`not_executed`/`planned_only`/`handoff`), nunca `completed`.
   */
  finalize(gates = {}) {
    return this._terminate(this._resolveFinalStatus(gates))
  }

  /** Decide o status tipado. `completed` EXIGE os 4 portões verdes; sem execução →
   * `not_executed`; cap estourado → `blocked`; parcial → `planned_only`/`handoff`. */
  _resolveFinalStatus(gates) {
    if (gates.cancelled) return "cancelled"
    if (this.status === "blocked") return "blocked"
    if (this._counters.attempts === 0) return "not_executed"
    if (allGatesGreen(gates)) return "completed"
    return this._partialStatus()
  }

  /** Executou algo mas não fechou os portões → `planned_only` se nunca saiu do plano,
   * senão `handoff` humano (há trabalho parcial que precisa de decisão). */
  _partialStatus() {
    return this.phase === "implement" || this.phase === "plan" ? "planned_only" : "handoff"
  }

  _terminate(status) {
    this.status = status
    return { status, phase: this.phase, counters: this.counters(), haltReason: this.haltReason }
  }
}

/** Número não-negativo (tokens medidos; entrada inválida vira 0). */
function toCount(n) {
  return Math.max(0, Number(n) || 0)
}

/** Todos os 4 portões de fechamento verdes? (aceites + observação fresca + checkpoint
 * verde provado + proof.ready) — a única porta para `completed`. */
function allGatesGreen(g) {
  return Boolean(g.acceptanceResolved && g.observationFresh && g.checkpointGreen && g.proofReady)
}

/** Primeiro cap estourado (ordem determinística), ou null. */
function firstCapBreached(budget, c) {
  if (c.attempts >= budget.maxIterations) return `max de ${budget.maxIterations} tentativas atingido`
  if (c.wallMs >= budget.maxWallTimeSeconds * 1000) return `budget de tempo (${budget.maxWallTimeSeconds}s) atingido`
  if (budget.maxTokens && c.tokens >= budget.maxTokens) return `budget de tokens (${budget.maxTokens}) atingido`
  if (c.consecutiveIdenticalFailures >= 3) return `thrashing: mesma falha ${c.consecutiveIdenticalFailures}× seguidas`
  return null
}

export { REPLIT_LOOP_SCHEMA }
