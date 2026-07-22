/**
 * PRD47 S47.6 — Proof obrigatório e demonstração de aceite: termina com UMA
 * resposta única e compreensível (`delivered|checkpoint_ready|blocked`). Reusa
 * `delivery-scorecard.js` (score NUNCA esconde P0, PRD42 S42.12) e
 * `acceptance-demo.js` (visão leiga=técnica) por inteiro — nada duplicado.
 */
import { scorecardFromProof } from "../skills/delivery-scorecard.js"

export const DELIVERY_VERDICT_SCHEMA = "gstack.delivery-verdict.v1"
export const DEFAULT_PROGRESS_INTERVAL_MS = 15000

/** "readiness contraditório" (GAP-8 do S47.0): doctor e readiness discordam sobre a MESMA ferramenta. */
export function readinessContradicts(doctorDeps = {}, readinessTools = {}) {
  const contradictions = []
  for (const [tool, doctorOk] of Object.entries(doctorDeps)) {
    const r = readinessTools[tool]
    if (!r) continue
    const readinessOk = r.status === "callable"
    if (doctorOk !== readinessOk) contradictions.push({ tool, doctor: doctorOk, readiness: r.status })
  }
  return contradictions
}

const isP0Blocked = (scorecard) => Boolean(scorecard) && scorecard.verdict === "blocked"

function verdictReason(scorecard, previewHealthy, contradictions, proofReady, intent) {
  if (isP0Blocked(scorecard)) return { status: "blocked", reason: "P0 reprovado" }
  if (!previewHealthy) return { status: "checkpoint_ready", reason: "preview unhealthy" }
  if (contradictions.length > 0) return { status: "checkpoint_ready", reason: "readiness contraditório entre doctor e tools readiness" }
  if (!proofReady) return { status: "checkpoint_ready", reason: "proof não pronto/não rodou" }
  if (intent !== "delivery") return { status: "checkpoint_ready", reason: "ciclo de desenvolvimento (intent != delivery)" }
  return { status: "delivered", reason: null }
}

/**
 * Decide o veredito ÚNICO de entrega. `delivered` exige TUDO verde ao mesmo tempo:
 * nenhum P0 reprovado, preview saudável, readiness sem contradição, proof pronto,
 * E intenção de entrega. Qualquer um faltando -> `checkpoint_ready` (dev) ou
 * `blocked` (P0 reprovado de verdade — nunca contornável).
 */
export function deriveDeliveryVerdict({ intent = "dev", proof = null, deploy = {}, previewHealthy = true, doctorDeps = {}, readinessTools = {} } = {}) {
  const scorecard = proof ? scorecardFromProof(proof, deploy) : null
  const contradictions = readinessContradicts(doctorDeps, readinessTools)
  const proofReady = proof ? proof.ready === true : false
  const verdict = verdictReason(scorecard, previewHealthy, contradictions, proofReady, intent)
  return { schemaVersion: DELIVERY_VERDICT_SCHEMA, ...verdict, scorecard, contradictions }
}

/**
 * Verifica que NENHUM intervalo entre eventos de progresso excedeu a policy —
 * silêncio além do intervalo definido é uma falha detectável, nunca some sem aviso.
 */
export function verifyProgressPolicy(events = [], intervalMs = DEFAULT_PROGRESS_INTERVAL_MS) {
  const gaps = []
  for (let i = 1; i < events.length; i++) {
    const dt = new Date(events[i].at) - new Date(events[i - 1].at)
    if (dt > intervalMs) gaps.push({ from: events[i - 1].at, to: events[i].at, ms: dt })
  }
  return { ok: gaps.length === 0, gaps, intervalMs }
}
