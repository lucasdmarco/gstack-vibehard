/**
 * PRD47 S47.7 — Context Delta: pacote MÍNIMO para retomar um run sem reler o
 * repositório inteiro. Referencia capacidades por ID/hash — nunca o corpus
 * integral da skill; exclui `.env*` e nunca aceita transcript bruto. Gotchas/
 * dead-ends são entregues no MESMO formato de evento que o detector do PRD46
 * já lê do journal.jsonl (S46.2, `dead_end`/`remember`) — sem promover
 * aprendizado aqui, isso é responsabilidade exclusiva do closeout do PRD46.
 * Economia de retomada reusa `handoff.js` (S42.10) — sempre `estimated`.
 */
import { createHash } from "node:crypto"
import { hasSecret } from "../security/redact.js"
import { validateFragmentEligibility } from "../skills/skill-context-pack.js"

export const CONTEXT_DELTA_SCHEMA = "gstack.context-delta.v1"

function sha256Hex(s) {
  return createHash("sha256").update(String(s)).digest("hex")
}

/** Hash estável de UMA decisão aprovada (id+valor) — retomada nunca reidrata por texto livre. */
export function hashDecision(decision) {
  return "sha256:" + sha256Hex(`${decision.id}::${JSON.stringify(decision.value ?? null)}`)
}

const DEAD_END_EVENT = "dead_end"
const REMEMBER_EVENT = "remember"
const isGotchaEvent = (ev) => ev.event === DEAD_END_EVENT || ev.event === REMEMBER_EVENT

/** Extrai gotchas/dead-ends estruturados — MESMO shape que `detectSignalsFromEvents` (PRD46 S46.2) lê. */
export function extractGotchas(events = []) {
  return events.filter(isGotchaEvent).map((e) => ({ event: e.event, signature: e.signature || null, reason: e.reason || e.summary || "" }))
}

const ENV_FILE_RX = /(^|[\\/])\.env([.\-][^\\/]*)?$/i
const notEnvFile = (f) => !ENV_FILE_RX.test(String(f))

function decisionRefs(decisions) {
  return decisions.map((d) => ({ id: d.id, value: d.value, hash: hashDecision(d) }))
}

function architectureRef(graphRef) {
  if (!graphRef) return null
  return { ref: graphRef.path || null, builtAtCommit: graphRef.builtAtCommit || null, state: graphRef.state || "unknown" }
}

function checkpointRef(checkpoint) {
  if (!checkpoint) return null
  return { seq: checkpoint.seq, hash: checkpoint.hash, green: checkpoint.green }
}

function diagnosisRef(diagnosis) {
  if (!diagnosis) return null
  return { code: diagnosis.code || diagnosis.classification || null, summary: diagnosis.summary || null }
}

function acceptanceBuckets(items) {
  const proved = items.filter((i) => i.status === "compliant").map((i) => i.id)
  const failed = items.filter((i) => i.status === "failed").map((i) => i.id)
  const pending = items.filter((i) => i.status === "pending" || i.status === "unverified").map((i) => i.id)
  return { proved, failed, pending }
}

function capabilitiesRef(capabilityPlan, capabilityLocks) {
  return {
    skills: capabilityPlan ? [...capabilityPlan.skills] : [],
    gates: capabilityPlan ? [...capabilityPlan.gates] : [],
    locks: capabilityLocks.map((l) => ({ id: l.id, artifactKind: l.artifactKind, hash: l.hash })),
  }
}

/**
 * Monta o Context Delta. PURO — recebe tudo já computado (brief, plano de
 * capacidade, compliance report, journal, diagnóstico) e não lê disco nem
 * chama rede. Lança se o caller tentar injetar transcript bruto (nunca aceito).
 */
export function buildContextDelta({
  brief = null, decisions = [], capabilityPlan = null, capabilityLocks = [], complianceItems = [],
  touchedFiles = [], checkpoint = null, diagnosis = null, nextAction = null, events = [], graphRef = null,
  transcript,
} = {}) {
  if (transcript !== undefined) throw new Error("Context Delta nunca aceita transcript bruto — referencie evidência, não o texto integral")
  return {
    schemaVersion: CONTEXT_DELTA_SCHEMA,
    createdAt: new Date().toISOString(),
    objective: brief?.objective ?? null,
    scope: brief?.mode ?? null,
    decisions: decisionRefs(decisions),
    architecture: architectureRef(graphRef),
    touchedFiles: touchedFiles.filter(notEnvFile),
    checkpoint: checkpointRef(checkpoint),
    acceptances: acceptanceBuckets(complianceItems),
    diagnosis: diagnosisRef(diagnosis),
    nextAction,
    capabilities: capabilitiesRef(capabilityPlan, capabilityLocks),
    gotchas: extractGotchas(events),
  }
}

function stringsIn(value, depth = 0) {
  if (depth > 8) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((v) => stringsIn(v, depth + 1))
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => stringsIn(v, depth + 1))
  return []
}

/** Fail-closed: nenhum campo pode carregar VALOR de segredo (mesma disciplina do candidate.js, PRD46 S46.1). */
export function validateContextDelta(delta) {
  const reasons = []
  if (delta.schemaVersion !== CONTEXT_DELTA_SCHEMA) reasons.push("schemaVersion inválido")
  if ("transcript" in delta) reasons.push("Context Delta nunca inclui transcript bruto")
  if (stringsIn(delta).some((s) => hasSecret(s))) reasons.push("valor de segredo detectado no Context Delta")
  return { ok: reasons.length === 0, reasons }
}

function blockedCapabilityLocks(delta, sourceLocks, currentContents) {
  return delta.capabilities.locks
    .map((ref) => ({ ref, eligible: validateFragmentEligibility(sourceLocks.find((l) => l.id === ref.id) || null, currentContents[ref.id] ?? null) }))
    .filter((x) => !x.eligible.ok)
    .map((x) => ({ id: x.ref.id, reason: x.eligible.reason }))
}

/**
 * Decide como o pack é retomado: capacidade bloqueada (revogada/hash divergente)
 * vence sempre; sem bloqueio, grafo `fresh` reusa e qualquer outro estado
 * regenera — NUNCA reusa silenciosamente texto/frescor velho (DoD).
 */
export function resolveContextDeltaLoad(delta, { graphState = "unknown", sourceLocks = [], currentContents = {} } = {}) {
  const blockedCapabilities = blockedCapabilityLocks(delta, sourceLocks, currentContents)
  if (blockedCapabilities.length > 0) return { action: "block", blockedCapabilities }
  return { action: graphState === "fresh" ? "reuse" : "regenerate", blockedCapabilities: [] }
}
