import { ADAPTER_MATRIX, CAPABILITY_STATES, ENFORCEMENT_LEVELS, getAdapterInfo } from "../agents/adapter-matrix.js"

/**
 * Harness Capability Scorecard V2 (PRD14 §4.1) — visão completa e VALIDÁVEL da
 * matriz: cada harness com estado, assets, gaps, onramp, comandos de verificação,
 * riscos, dono e data de verificação. Fonte única: ADAPTER_MATRIX.
 */

const REQUIRED_FIELDS = Object.freeze([
  "id", "harness", "state", "enforcement", "supportedAssets", "unsupportedSurfaces",
  "installOrOnramp", "verificationCommands", "riskNotes", "lastVerifiedAt", "owner",
])

/** Scorecard completo: uma linha V2 por harness da matriz. */
export function capabilityScorecard() {
  return Object.entries(ADAPTER_MATRIX).map(([id, m]) => ({
    id: `harness:${id}`,
    harness: id,
    state: m.state,
    enforcement: m.enforcement,
    target: m.target,
    generated: m.generated,
    supportedAssets: m.supportedAssets,
    unsupportedSurfaces: m.unsupportedSurfaces,
    installOrOnramp: m.installOrOnramp,
    verificationCommands: m.verificationCommands,
    riskNotes: m.riskNotes,
    lastVerifiedAt: m.lastVerifiedAt,
    owner: m.owner,
  }))
}

/** Linha V2 de UM harness (desconhecido = unsupported honesto). */
export function capabilityRow(id) {
  const m = getAdapterInfo(id)
  return { id: `harness:${id}`, harness: id, ...m }
}

function fieldMissing(r, f) {
  if (r[f] == null) return true
  return f === "verificationCommands" && Array.isArray(r[f]) && r[f].length === 0
}

/** INVARIANTE de honestidade: state fraco nunca reivindica hooks reais. */
function claimsFakeHooks(r) {
  const weak = r.state === "instruction_backed" || r.state === "reference_only"
  return weak && (r.enforcement === "real_hooks" || r.enforcement === "partial")
}

function rowErrors(r) {
  const errs = REQUIRED_FIELDS.filter((f) => fieldMissing(r, f)).map((f) => `${r.harness}: campo obrigatório ausente: ${f}`)
  if (!CAPABILITY_STATES.includes(r.state)) errs.push(`${r.harness}: state inválido: ${r.state}`)
  if (!ENFORCEMENT_LEVELS.includes(r.enforcement)) errs.push(`${r.harness}: enforcement inválido: ${r.enforcement}`)
  if (claimsFakeHooks(r)) errs.push(`${r.harness}: state ${r.state} não pode reivindicar enforcement ${r.enforcement}`)
  return errs
}

/** Valida o scorecard inteiro. → { ok, errors } (usado por teste e doctor). */
export function validateScorecard(rows = capabilityScorecard()) {
  const errors = rows.flatMap(rowErrors)
  return { ok: errors.length === 0, errors }
}
