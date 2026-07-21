/**
 * PRD46 S46.4 — Promotion Gate: torna a promoção de um candidate (schema
 * `gstack.learning-candidate.v1`, S46.1) fail-closed e atestada. Reusa scanner
 * (AgentShield) e VFA provenance do produto — não duplica nenhum dos dois.
 *
 * `--reviewed` sozinho não basta: grava uma ATESTAÇÃO do hash do conteúdo no
 * momento da revisão (`attestReview`). Se o candidate for editado depois (o hash
 * não bate mais), a promoção volta pra `ask` — nunca promove conteúdo não revisado.
 */
import { scanContent, evaluateScan } from "../agents/scanner.js"
import { readRun, lastHashForRun } from "../vfa/provenance.js"
import { candidateSignature, transition } from "./candidate.js"

export const PROMOTION_GATE_SCHEMA = "gstack.dream.promotion-gate.v1"

function candidateText(candidate) {
  const steps = (candidate.procedure?.steps || []).join("\n")
  const failure = candidate.failurePattern?.summary || ""
  return [candidate.title, steps, failure].filter(Boolean).join("\n")
}

/** Grava a atestação: hash do conteúdo NO MOMENTO em que o humano revisou. */
export function attestReview(candidate) {
  return { attestedHash: candidateSignature(candidate), attestedAt: new Date().toISOString() }
}

/** True se o candidate foi editado DEPOIS da atestação (hash não bate mais). */
export function reviewStale(candidate, attestation) {
  if (!attestation) return true
  return candidateSignature(candidate) !== attestation.attestedHash
}

const sourceOf = (candidate) => candidate.source || {}
const chainHashMismatch = (chainHash, current) => !!chainHash && !!current && chainHash !== current

/** Provenance: o candidate precisa referenciar um run REAL cujo chainHash ainda bate. */
function verifyProvenance(candidate, cwd) {
  const { runId, chainHash } = sourceOf(candidate)
  if (!runId) return { ok: false, reason: "candidate sem runId de origem" }
  const receipts = readRun(cwd, runId)
  if (receipts.length === 0) return { ok: false, reason: `run ${runId} não encontrado no provenance` }
  const current = lastHashForRun(cwd, runId)
  if (chainHashMismatch(chainHash, current)) return { ok: false, reason: `chainHash divergente do provenance (${runId})` }
  return { ok: true, reason: null }
}

/** AgentShield sobre o conteúdo do candidate — já redigido no S46.1, mas o scanner roda de novo aqui. */
function verifyShield(candidate) {
  const findings = scanContent(`candidate:${candidate.id}`, candidateText(candidate))
  const shield = evaluateScan(findings, { strict: true })
  if (!shield.blocked) return { ok: true, reason: null }
  return { ok: false, reason: `AgentShield bloqueou: ${findings.map((f) => f.id).join(", ")}` }
}

/**
 * Decide a promoção — NUNCA escreve nada, só o veredito.
 * @returns {{ok: boolean, status: "ask"|"blocked_provenance"|"blocked_shield"|"promotable", reason: string|null}}
 */
export function evaluatePromotion({ candidate, reviewed = false, attestation = null, cwd } = {}) {
  if (!reviewed) return { ok: false, status: "ask", reason: "promoção exige --reviewed" }
  if (reviewStale(candidate, attestation)) return { ok: false, status: "ask", reason: "candidate mudou após a revisão — reatestar" }

  const provenance = verifyProvenance(candidate, cwd)
  if (!provenance.ok) return { ok: false, status: "blocked_provenance", reason: provenance.reason }

  const shield = verifyShield(candidate)
  if (!shield.ok) return { ok: false, status: "blocked_shield", reason: shield.reason }

  return { ok: true, status: "promotable", reason: null }
}

/** Única função que de fato PROMOVE (transiciona o estado) — nunca chamada no closeout/detector. */
export function promoteCandidate(candidate) {
  return transition(candidate, "promoted")
}
