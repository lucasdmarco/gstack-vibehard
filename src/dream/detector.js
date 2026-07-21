/**
 * PRD46 S46.2 — detector de golden path no closeout. Identifica sinais tipados de um
 * run JÁ CONCLUÍDO (retry resolvido, dead end com assinatura, evento explícito de
 * "lembrar") e decide se produz UM candidate bounded (nunca lista, nunca mais de um).
 *
 * Deteccao NAO E promocao (§6.3): este módulo NUNCA transiciona o candidate — ele
 * nasce e permanece `status: "observed"`; a promoção fica inteiramente fora daqui
 * (Promotion Gate, S46.4). Runs de sucesso podem chegar a `validity.status: "eligible"`;
 * handoff/failure NUNCA passam de `tentative` — a própria triagem (verifiable=isSuccess)
 * garante isso, sem lógica extra de "capping" duplicada aqui.
 */
import { deriveStatus } from "./triage.js"
import { buildCandidate } from "./candidate.js"

export const SUCCESS_STATUSES = Object.freeze(["done", "ready", "success", "completed"])

/**
 * Deriva sinais tipados a partir de eventos JÁ REDIGIDOS do run — nunca transcript
 * bruto (§6.4). Reconhece tanto `attempt_failed` (pipeline do `start`) quanto
 * `node_failed` (workflow-graph), sem exigir um formato de journal específico.
 */
const isFailureEvent = (ev) => ev.event === "attempt_failed" || ev.event === "node_failed"
const isDeadEndEvent = (ev) => ev.event === "dead_end" && !!ev.signature
const isRememberEvent = (ev) => ev.event === "remember"
const deadEndReason = (ev) => ev.reason || ""

export function detectSignalsFromEvents(events = []) {
  let failedAttempts = 0
  const deadEnds = []
  let explicitRemember = false
  for (const ev of events) {
    if (isFailureEvent(ev)) failedAttempts++
    if (isDeadEndEvent(ev)) deadEnds.push({ signature: ev.signature, reason: deadEndReason(ev) })
    if (isRememberEvent(ev)) explicitRemember = true
  }
  return { failedAttempts, deadEnds, explicitRemember }
}

function hasEnoughSignal(signals) {
  return signals.failedAttempts > 0 || signals.explicitRemember || signals.deadEnds.length > 0
}

function triageSignalsFor(signals, isSuccess) {
  return {
    hasEvidence: hasEnoughSignal(signals),
    stepCount: signals.failedAttempts + signals.deadEnds.length + (signals.explicitRemember ? 1 : 0) + 1,
    recurring: signals.failedAttempts > 0,
    verifiable: isSuccess,
    oneOff: !isSuccess && !signals.explicitRemember && signals.deadEnds.length === 0,
  }
}

function candidateTitle(runId, title) {
  return title || `Golden path — run ${runId}`
}

/**
 * Decide se o closeout de um run produz um candidate. @returns {{candidate: object|null, signals: object}}
 */
export function detectGoldenPath({ status, events = [], runId, chainHash = null, head = null, harness = null, evidenceRefs = [], title } = {}) {
  const signals = detectSignalsFromEvents(events)
  if (!hasEnoughSignal(signals)) return { candidate: null, signals }

  const isSuccess = SUCCESS_STATUSES.includes(status)
  const triageSignals = triageSignalsFor(signals, isSuccess)
  const { classification, status: validityStatus } = deriveStatus(triageSignals)
  const firstDeadEnd = signals.deadEnds[0] || null

  const candidate = buildCandidate({
    runId, chainHash, head, harness, evidenceRefs, scope: "project",
    title: candidateTitle(runId, title),
    failurePattern: firstDeadEnd ? { id: firstDeadEnd.signature, summary: firstDeadEnd.reason } : null,
    procedure: { steps: signals.failedAttempts ? [`resolver ${signals.failedAttempts} tentativa(s) falha(s) até sucesso`] : [] },
    deadEnds: signals.deadEnds,
  })
  candidate.classification = classification
  candidate.validity.status = validityStatus

  return { candidate, signals }
}
