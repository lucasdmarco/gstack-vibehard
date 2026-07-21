/**
 * PRD46 S46.6 — freshness e revogação: conhecimento antigo NUNCA permanece
 * autoritativo para sempre. Compara comando/path/dependency/source hash;
 * `stale`/`revoked` nunca são roteados; revogação sempre preserva provenance
 * (nunca apaga — só marca). Update remoto é diagnóstico/plano, nunca automático.
 */
import { transition } from "./candidate.js"
import { hashDrifted } from "../skills/source-lock.js"

export const ROUTABLE_STATUSES = Object.freeze(["eligible", "proposed", "promoted"])

/** True só quando o candidate pode ser roteado pra uma tarefa nova. */
export function isRoutable(candidate) {
  return ROUTABLE_STATUSES.includes(candidate.status)
}

/**
 * Avalia freshness: comando citado que sumiu OU hash do source lock divergente
 * do conteúdo atual -> stale. Nunca baixa/reinstala/sobrescreve — só diagnóstico.
 */
export function evaluateFreshness({ citedCommands = [], existingCommands = [], sourceLock = null, currentContent = null } = {}) {
  const staleCommands = citedCommands.filter((c) => !existingCommands.includes(c))
  const hashStale = !!(sourceLock && currentContent != null && hashDrifted(sourceLock, currentContent))
  return { stale: staleCommands.length > 0 || hashStale, staleCommands, hashDrifted: hashStale }
}

/** Marca um candidate PROMOVIDO como stale — nunca some, só perde autoridade de roteamento. */
export function markStale(candidate) {
  return transition(candidate, "stale")
}

/** Revoga preservando provenance — nunca apaga source/history, só remove do roteamento. */
export function revokeCandidate(candidate, reason = null) {
  const next = transition(candidate, "revoked")
  return { ...next, revokedAt: new Date().toISOString(), revokedReason: reason }
}
