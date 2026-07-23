import { verdictFromClaims } from "./schema.js"
import { epistemicVerdictToEvidenceStatus } from "./invariants.js"

/**
 * Adaptador do Loop Engine para o protocolo epistêmico (PRD50 S50.3, §11.2).
 *
 * NÃO é um motor. `src/workflow-graph/runner.js` continua sendo o único —
 * aqui só se traduz o vocabulário do PVEP para os nós que já existem
 * (planner → rubric → worker → verifier → retry/done/human_handoff) e se
 * separam dois eixos que o PRD exige que nunca se confundam:
 *
 *   runStatus        — o protocolo rodou, falhou ou fez handoff
 *   epistemicVerdict — a evidência sustentou, refutou ou foi insuficiente
 *
 * `runStatus=passed` NUNCA implica `epistemicVerdict=supported`. E o runner
 * ainda distingue `instructed` (nenhum worker executou trabalho real, delegação
 * OFF) — esse caso jamais pode sustentar um claim.
 */
export const EPISTEMIC_ADAPTER_SCHEMA = "gstack.epistemic-workflow-adapter.v1"

/** §11.2 — mapeamento para os nós REAIS do Loop Engine. */
export const PVEP_TO_LOOP_ENGINE = Object.freeze({
  decompose: "planner",
  sufficiencyCriteria: "rubric",
  buildSupport: "worker",
  seekRefutation: "verifier",
  smallFix: "retry",
  structurallyWrongPremise: "restart",
  insufficientEvidence: "human_handoff",
})

// Só um run que executou trabalho REAL pode sustentar claim. `instructed` é o
// estado honesto do runner quando a delegação está OFF (nada rodou de verdade).
const RUN_STATUS_CAN_SUPPORT = Object.freeze({ passed: true, instructed: false, failed: false })

const NOT_PERFORMED_BY_STATUS = Object.freeze({
  instructed: "nenhum trabalho foi executado (delegação OFF) — apenas instrução ao harness",
  failed: "o protocolo falhou antes de concluir a verificação",
})

/**
 * Traduz o resultado do Loop Engine em desfecho epistêmico, mantendo os dois
 * eixos separados. Autoconcordância gerador↔verificador nunca vira prova.
 */
export function toEpistemicOutcome({ runStatus = "failed", claims = [], verifierAgreement = false } = {}) {
  const canSupport = RUN_STATUS_CAN_SUPPORT[runStatus] === true
  const fromClaims = verdictFromClaims(claims)
  // Sem execução real, o melhor desfecho possível é `inconclusive` — nunca supported/mixed.
  const epistemicVerdict = canSupport ? fromClaims : "inconclusive"
  const notPerformed = []
  if (NOT_PERFORMED_BY_STATUS[runStatus]) notPerformed.push(NOT_PERFORMED_BY_STATUS[runStatus])
  return {
    schemaVersion: EPISTEMIC_ADAPTER_SCHEMA,
    runStatus,
    epistemicVerdict,
    // Mesmo com o verificador concordando: LLM review é advisory (ADR-002).
    selfReviewCountedAsProof: false,
    verifierAgreement,
    evidenceLedgerStatus: epistemicVerdictToEvidenceStatus(epistemicVerdict),
    notPerformed,
  }
}

/** Verificador independente: advisory em EV1/EV2, ausente em EV0 (§11.3). */
export function independentVerifierRole(level) {
  return level === "sanity" ? "not_used" : "advisory"
}

const ITERATION_CAPS = Object.freeze({ sanity: 1, grounded: 2, adversarial: 3 })

/** Teto de iterações por nível (§11.3) — determinístico. */
export function iterationCapFor(level) {
  return ITERATION_CAPS[level] || ITERATION_CAPS.grounded
}

// Ordem = precedência da parada. Suficiência primeiro: se já basta, para já
// (early stop do §11.3) sem gastar o resto do orçamento.
const STOP_RULES = Object.freeze([
  { when: (s) => s.sufficient === true, stopReason: "sufficient", handoff: false },
  { when: (s) => s.sameFailureCount >= 2, stopReason: "same_failure", handoff: true },
  { when: (s) => s.iterations >= s.cap, stopReason: "cap", handoff: true },
  { when: (s) => s.exhausted === true, stopReason: "insufficient_data", handoff: true },
])

/** Motivo determinístico de parada + se exige handoff humano. */
export function resolveStopReason({ iterations = 0, cap = 1, sameFailureCount = 0, sufficient = false, exhausted = false } = {}) {
  const s = { iterations, cap, sameFailureCount, sufficient, exhausted }
  const hit = STOP_RULES.find((r) => r.when(s))
  return hit ? { stopReason: hit.stopReason, handoff: hit.handoff } : { stopReason: null, handoff: false }
}

/**
 * Replay não pode refazer trabalho já concluído (DoD do sprint): fonte já
 * hasheada não é recontada e model call concluído não é reexecutado.
 */
export function dedupeCompletedWork({ prior = {}, incoming = {} } = {}) {
  const done = new Set(prior.sourceHashes || [])
  const newSourceHashes = (incoming.sourceHashes || []).filter((h) => !done.has(h))
  const additionalModelCalls = Math.max(0, (incoming.modelCalls || 0) - (prior.modelCalls || 0))
  return { newSourceHashes, additionalModelCalls }
}
