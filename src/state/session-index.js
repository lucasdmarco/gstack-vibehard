/**
 * PRD48 S48.3 — índice unificado de sessão sobre o State Store JÁ REAL (PRD14 §4.4,
 * `src/state/store.js`) — não duplica storage, só normaliza. Responde num lugar só "o
 * que rodou, onde parou, como retomo": um `sessionId` CANÔNICO por run, nenhuma cópia
 * de journal/transcript (só refs bounded), refs quebradas viram `stale` — NUNCA
 * silenciosamente "sucesso".
 */
import { createHash } from "node:crypto"

export const SESSION_SCHEMA = "gstack.session.v1"
export const SESSION_STATUSES = Object.freeze(["planned", "running", "waiting_user", "blocked", "passed", "cancelled"])
const MAX_OBJECTIVE_CHARS = 500

/** Session id CANÔNICO e determinístico — o mesmo runId sempre produz o mesmo sessionId. */
export function sessionIdFor(runId) {
  return `session-${createHash("sha256").update(String(runId)).digest("hex").slice(0, 16)}`
}

const RUN_STATUS_TO_SESSION = Object.freeze({ done: "passed", handoff: "waiting_user", cancelled: "cancelled" })

/** Mapeia o status do run-loop pro enum de sessão — desconhecido NUNCA vira "passed" por omissão. */
export function statusForSession(runStatus) {
  return RUN_STATUS_TO_SESSION[runStatus] || "blocked"
}

/** Monta o registro canônico de sessão — o que os produtores gravam no State Store. */
export function buildSessionRecord({ sessionId, runId, planId, objective = "", harness = null, model = null, status, worktreeId = null, lastGreenCheckpoint = null, proofRef = null, contextDeltaRef = null } = {}) {
  if (!SESSION_STATUSES.includes(status)) throw new Error(`status de sessão inválido: ${status}`)
  return {
    schemaVersion: SESSION_SCHEMA, sessionId, runId, planId,
    objective: String(objective).slice(0, MAX_OBJECTIVE_CHARS),
    harness, model, status, worktreeId, lastGreenCheckpoint, proofRef, contextDeltaRef,
    updatedAt: new Date().toISOString(),
  }
}

/** Lista sessões via o State Store real — nunca duplica storage. */
export function listSessions(store, { limit = 20 } = {}) {
  return store.list("sessions", { limit })
}

const TERMINAL_STATUSES = new Set(["passed", "cancelled"])

/** A sessão mais recente ainda NÃO terminal — candidata a retomada. Nenhuma = null, honesto. */
export function activeSession(sessions = []) {
  return sessions.find((s) => !TERMINAL_STATUSES.has(s.status)) || null
}

/** Ref é `stale` se o alvo referenciado não existe mais — nunca presume sucesso. */
export function refStatus(ref, exists) {
  if (!ref) return "absent"
  return exists(ref) ? "ok" : "stale"
}
