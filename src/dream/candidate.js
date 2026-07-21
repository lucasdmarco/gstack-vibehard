/**
 * PRD46 S46.1 — schema, máquina de estados e assinatura estável do candidato de
 * aprendizado (`gstack.learning-candidate.v1`, PRD46 §7.1/§7.2). Representa um golden
 * path detectado sem LLM e sem transcript bruto — só receipts estruturados.
 *
 * Fail-closed por design: `validateCandidate` rejeita (não apenas mascara) qualquer
 * campo que contenha um VALOR de segredo, e `canTransition`/`transition` só permitem
 * as arestas literais do §7.2 — nenhum salto de estado (ex.: observed->promoted direto).
 */
import { createHash } from "node:crypto"
import { redactSecrets, hasSecret } from "../security/redact.js"

export const CANDIDATE_SCHEMA = "gstack.learning-candidate.v1"

export const CANDIDATE_TRANSITIONS = Object.freeze({
  observed: ["tentative", "eligible", "skipped"],
  tentative: [],
  eligible: ["proposed"],
  skipped: [],
  proposed: ["blocked_secret", "blocked_shield", "blocked_conflict", "rejected", "promoted"],
  blocked_secret: [],
  blocked_shield: [],
  blocked_conflict: [],
  rejected: [],
  promoted: ["stale", "revoked", "superseded"],
  stale: [],
  revoked: [],
  superseded: [],
})

const CLASSIFICATIONS = Object.freeze(["skill", "memory", "skip", "undetermined"])
const MAX_STEPS = 20
const MAX_DEAD_ENDS = 20
const MAX_STRING = 2000
const ENV_NAME_RX = /^[A-Z][A-Z0-9_]*$/

function sha256Hex(s) {
  return createHash("sha256").update(String(s)).digest("hex")
}

/** True se `to` é uma aresta permitida a partir de `from` (§7.2 — sem saltos). */
export function canTransition(from, to) {
  const allowed = CANDIDATE_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

/** Aplica uma transição válida. NUNCA muta o candidate recebido. Lança em salto inválido. */
export function transition(candidate, to) {
  if (!candidate || typeof candidate.status !== "string") throw new Error("candidate inválido: status ausente")
  if (!canTransition(candidate.status, to)) {
    throw new Error(`transição inválida: ${candidate.status} -> ${to}`)
  }
  return { ...candidate, status: to }
}

/** Id estável: os MESMOS receipts (runId+chainHash) produzem sempre o mesmo id. */
export function stableCandidateId({ runId, chainHash } = {}) {
  const basis = `${runId || ""}::${chainHash || ""}`
  return `lc_${sha256Hex(basis).slice(0, 16)}`
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ")

/** Assinatura de dedupe — normaliza título/failurePattern/passos p/ hash estável (§7.1 dedupe.signature). */
export function candidateSignature(input = {}) {
  const title = norm(input.title)
  const failureId = String(input.failurePattern?.id || "")
  const steps = (input.procedure?.steps || []).map(norm).join("|")
  return "sha256:" + sha256Hex(`${title}::${failureId}::${steps}`)
}

function stringsIn(value, depth = 0) {
  if (depth > 10) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((v) => stringsIn(v, depth + 1))
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => stringsIn(v, depth + 1))
  return []
}

const idFormatValid = (candidate) => /^lc_[0-9a-f]{16}$/.test(String(candidate.id || ""))
const scopeValid = (candidate) => ["project", "user"].includes(candidate.scope)

function validateSchemaShape(candidate) {
  const reasons = []
  if (candidate.schemaVersion !== CANDIDATE_SCHEMA) reasons.push(`schemaVersion inválido: ${candidate.schemaVersion}`)
  if (!idFormatValid(candidate)) reasons.push("id fora do formato lc_<16hex>")
  if (!CLASSIFICATIONS.includes(candidate.classification)) reasons.push(`classification inválida: ${candidate.classification}`)
  if (!(candidate.status in CANDIDATE_TRANSITIONS)) reasons.push(`status inválido: ${candidate.status}`)
  if (!scopeValid(candidate)) reasons.push(`scope inválido: ${candidate.scope}`)
  return reasons
}

const stepCount = (candidate) => (candidate.procedure?.steps || []).length
const deadEndCount = (candidate) => (candidate.deadEnds || []).length
const hasOversizedString = (candidate) => stringsIn(candidate).some((s) => s.length > MAX_STRING)

function validateBounds(candidate) {
  const reasons = []
  if (stepCount(candidate) > MAX_STEPS) reasons.push(`procedure.steps excede o limite de ${MAX_STEPS}`)
  if (deadEndCount(candidate) > MAX_DEAD_ENDS) reasons.push(`deadEnds excede o limite de ${MAX_DEAD_ENDS}`)
  if (hasOversizedString(candidate)) reasons.push(`string além do limite de ${MAX_STRING} caracteres`)
  return reasons
}

function validateSecrets(candidate) {
  const reasons = []
  if (stringsIn(candidate).some((s) => hasSecret(s))) reasons.push("valor de segredo detectado em campo do candidate")
  for (const ref of candidate.secretRefs || []) {
    if (!ENV_NAME_RX.test(String(ref))) reasons.push(`secretRefs deve referenciar NOME de variável, não valor: ${ref}`)
  }
  return reasons
}

/**
 * Valida um candidate: schema/enum/bounds + o bloqueio central — nenhum campo pode
 * conter um VALOR de segredo (nested/array incluídos), e `secretRefs` só aceita NOME
 * de variável, nunca o valor. @returns {{ ok: boolean, reasons: string[] }}
 */
export function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return { ok: false, reasons: ["candidate ausente"] }
  const reasons = [...validateSchemaShape(candidate), ...validateBounds(candidate), ...validateSecrets(candidate)]
  return { ok: reasons.length === 0, reasons }
}

function redactProcedure(procedure) {
  if (!procedure) return { steps: [], verification: [] }
  return {
    steps: (procedure.steps || []).map((s) => redactSecrets(String(s)).redacted),
    verification: (procedure.verification || []).map((s) => String(s)),
  }
}

function redactFailurePattern(failurePattern) {
  if (!failurePattern) return null
  return { id: String(failurePattern.id || ""), summary: redactSecrets(String(failurePattern.summary || "")).redacted }
}

function redactDeadEnds(deadEnds) {
  return (deadEnds || []).map((d) => ({ signature: String(d.signature || ""), reason: redactSecrets(String(d.reason || "")).redacted }))
}

/**
 * Monta um candidate novo (status inicial "observed"). Redige toda string livre
 * (procedure/failurePattern/deadEnds/title) com o redactor compartilhado antes de
 * persistir — defesa em profundidade além da rejeição de `validateCandidate`.
 */
export function buildCandidate({
  runId, chainHash, head, harness, evidenceRefs = [], scope = "project",
  title, failurePattern, procedure, passingCheck = null, deadEnds = [], secretRefs = [],
} = {}) {
  const redactedTitle = redactSecrets(String(title || "")).redacted
  const redactedProcedure = redactProcedure(procedure)
  const redactedFailurePattern = redactFailurePattern(failurePattern)
  const redactedDeadEnds = redactDeadEnds(deadEnds)

  return {
    schemaVersion: CANDIDATE_SCHEMA,
    id: stableCandidateId({ runId, chainHash }),
    createdAt: new Date().toISOString(),
    source: { runId, chainHash, head, harness, evidenceRefs },
    scope,
    classification: "undetermined",
    title: redactedTitle,
    failurePattern: redactedFailurePattern,
    procedure: redactedProcedure,
    passingCheck,
    deadEnds: redactedDeadEnds,
    secretRefs,
    dedupe: {
      signature: candidateSignature({ title: redactedTitle, failurePattern: redactedFailurePattern, procedure: redactedProcedure }),
      matches: [],
      decision: "unknown",
    },
    validity: { status: "tentative", expiresAt: null, freshnessProbes: [] },
    status: "observed",
  }
}
