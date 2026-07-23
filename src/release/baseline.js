/**
 * Baseline de release reproduzível (PRD51 S51.0B, §3).
 *
 * O projeto usava `ready:true` com sentidos diferentes, o que permitiu chamar
 * um PRD de fechado com itens parciais. Este módulo separa quatro estados que
 * NÃO se implicam:
 *
 *   releaseReady        — os gates bloqueantes passaram NO COMMIT atual
 *   programComplete     — todo requisito foi entregue, removido ou virou non-goal
 *   operationallyProven — caminhos críticos exercitados em E2E real, SEM flake
 *   fullyValidated      — métricas mensuráveis validadas pelo protocolo declarado
 *
 * Duas lições estão codificadas aqui:
 *  - prova pertence a UM commit (a da calibração: proof de A não vale para B);
 *  - `operationallyProven` exige MÚLTIPLAS execuções sem falha — n=1 verde não
 *    prova nada (a lição que este próprio programa aprendeu na calibração).
 */
export const RELEASE_BASELINE_SCHEMA = "gstack.release-baseline.v1"

// Quantas execuções sem falha um caminho precisa para ser "operacionalmente
// provado". Menos que isso é amostra insuficiente contra flakiness.
export const MIN_RUNS_FOR_OPERATIONAL = 20

const CLOSED_STATUSES = new Set(["delivered", "not_applicable", "removed"])

/** Um item conta como fechado se entregue OU convertido em non-goal explícito. */
function itemIsClosed(item) {
  if (item.nonGoal === true && item.nonGoalReason) return true
  return CLOSED_STATUSES.has(item.status)
}

/** Prova só vale para o commit que a gerou. Sem commit, nunca vale. */
export function evidenceValidForCommit(evidence, headCommit) {
  return Boolean(evidence && evidence.commit && headCommit && evidence.commit === headCommit)
}

/** Evidência de dream audit precisa ser VIVA (do commit), nunca um snapshot fixo. */
export function dreamEvidenceIsLive(evidence) {
  return Boolean(evidence && evidence.source === "live_audit" && evidence.commit)
}

function computeOperational(flake) {
  const runs = flake.runs || 0
  const failures = flake.failures || 0
  const rate = runs > 0 ? failures / runs : 1
  const proven = runs >= MIN_RUNS_FOR_OPERATIONAL && failures === 0
  return { proven, rate }
}

/** Monta a baseline a partir da evidência real do commit. PURO. */
export function buildReleaseBaseline({
  commit = null, proof = {}, programItems = [], flake = {}, humanValidation = {},
} = {}) {
  const releaseReady = proof.ready === true
  const programComplete = programItems.length === 0 || programItems.every(itemIsClosed)
  const { proven, rate } = computeOperational(flake)
  const fullyValidated = (humanValidation.pending || 0) === 0 && proven
  return {
    schemaVersion: RELEASE_BASELINE_SCHEMA,
    releaseReady,
    programComplete,
    operationallyProven: proven,
    fullyValidated,
    flakeRate: rate,
    residuals: programItems.filter((i) => !itemIsClosed(i)).map((i) => ({ id: i.id, status: i.status })),
    nonGoals: programItems.filter((i) => i.nonGoal === true).map((i) => ({ id: i.id, reason: i.nonGoalReason })),
    provenance: {
      commit,
      generatedAt: new Date().toISOString().slice(0, 10),
      flakeRuns: flake.runs || 0,
      flakeFailures: flake.failures || 0,
    },
  }
}

/**
 * Pode-se dizer "programa concluído"? Só quando os três estados de fechamento
 * (programComplete, operationallyProven, fullyValidated) são verdes. `releaseReady`
 * sozinho NUNCA autoriza a frase (§3).
 */
export function canRenderAsComplete(baseline) {
  const missing = []
  if (!baseline.programComplete) missing.push("programComplete")
  if (!baseline.operationallyProven) missing.push("operationallyProven")
  if (!baseline.fullyValidated) missing.push("fullyValidated")
  if (missing.length) return { ok: false, reason: `não pode renderizar 'concluído': falta ${missing.join(", ")}` }
  return { ok: true, reason: null }
}
