import { recordPhase, loopExhausted } from "./replit-loop.js"

/**
 * Diagnose + Autocorrect BOUNDED (PRD37 37.3 — Fase D3). Fecha o miolo do ciclo
 * Replit-parity: compara a OBSERVAÇÃO (D2) com a intenção/critérios de aceite e,
 * quando reprova, emite uma REQUISIÇÃO DE CORREÇÃO limitada — o LLM PROPÕE a
 * correção, mas quem DECIDE é o verifier/observação (o LLM nunca é o gate final).
 *
 * Honestidade (nada é enfeite):
 *  - o verifier é DETERMINÍSTICO: um critério de aceite só conta como atendido com
 *    EVIDÊNCIA explícita (`observation.checks[criterio] === true`) — nunca se
 *    presume "pronto" sem prova;
 *  - BOUNDED: se o budget (iterações/tempo/tokens) estourou, o ciclo PARA e pede
 *    ao usuário — nunca autocorrige infinitamente;
 *  - o módulo nunca fabrica um patch: `buildCorrectionRequest` devolve o CONTRATO
 *    do que corrigir; o agente/LLM é quem propõe de fato.
 *
 * PURO/testável.
 */

export const DIAGNOSE_SCHEMA = "gstack.diagnose-loop.v1"

// Critério atendido só com evidência explícita na observação (nunca presumido).
function unmetCriteria(observation, acceptance) {
  const checks = observation?.checks || {}
  return acceptance.filter((c) => checks[c] !== true)
}

/**
 * VERIFIER determinístico. Reprova se a observação não validou visualmente, se há
 * problemas observados, ou se algum critério de aceite não tem evidência.
 * `observation` = saída da camada de observação (D2): { visualValidated, problems,
 * checks? }.
 */
export function diagnoseObservation({ observation = null, acceptance = [] } = {}) {
  if (!observation) {
    return { schemaVersion: DIAGNOSE_SCHEMA, passed: false, problems: ["sem observação — o ciclo não rodou/observou"], pendingCriteria: [...acceptance] }
  }
  const problems = [...(observation.problems || [])]
  const pendingCriteria = unmetCriteria(observation, acceptance)
  const passed = observation.visualValidated === true && problems.length === 0 && pendingCriteria.length === 0
  return { schemaVersion: DIAGNOSE_SCHEMA, passed, problems, pendingCriteria }
}

// Alvos concretos que a correção deve endereçar (problemas + critérios sem prova).
function correctionTargets(diagnosis) {
  return [
    ...diagnosis.problems,
    ...diagnosis.pendingCriteria.map((c) => `critério de aceite sem evidência: ${c}`),
  ]
}

/**
 * Requisição de correção BOUNDED. O LLM consome isto e PROPÕE a correção — o
 * módulo nunca inventa o patch. Se o budget estourou, `stop:true` (pede usuário).
 */
export function buildCorrectionRequest({ diagnosis, state } = {}) {
  const bounded = loopExhausted(state)
  return {
    schemaVersion: DIAGNOSE_SCHEMA,
    attempt: state.consumed.iterations + 1,
    maxAttempts: state.budget.maxIterations,
    bounded,
    stop: bounded.exhausted,
    targets: correctionTargets(diagnosis),
    guidance: bounded.exhausted
      ? "budget do ciclo esgotado — pare e peça direção ao usuário (needs_user)"
      : "LLM propõe a correção destes alvos; a PRÓXIMA observação decide (nunca o LLM)",
  }
}

// Decisão determinística do próximo passo do ciclo (o verifier decide, não o LLM).
export function decideNext(state, diagnosis) {
  if (diagnosis.passed) return { action: "checkpoint", verdict: "validated", reason: "observação limpa e critérios com evidência" }
  const bounded = loopExhausted(state)
  if (bounded.exhausted) return { action: "stop", verdict: "needs_user", reason: `bounded: ${bounded.reason}` }
  return { action: "autocorrect", verdict: "degraded", reason: "diagnóstico reprovou — LLM propõe correção e re-roda (bounded)" }
}

/**
 * Roda a fase `diagnose` sobre o estado do loop: verifica a observação e registra
 * com recordPhase (fase de DECISÃO — reprovar roteia o ciclo para autocorrect).
 * Retorna `{ state, diagnosis, next }`.
 */
export function runDiagnosePhase(state, { observation, acceptance } = {}) {
  const diagnosis = diagnoseObservation({ observation, acceptance: acceptance ?? state.acceptance })
  const detail = diagnosis.passed ? "critérios atendidos" : correctionTargets(diagnosis).join("; ")
  const next = recordPhase(state, {
    ok: diagnosis.passed,
    detail,
    evidence: { phase: "diagnose", passed: diagnosis.passed, targets: correctionTargets(diagnosis) },
  })
  return { state: next, diagnosis, next: decideNext(state, diagnosis) }
}

/**
 * Roda a fase `autocorrect`: registra a correção que o LLM/agente PROPÔS
 * (`applied` = { ok, detail } devolvido pelo agente). Não fabrica patch. Continua
 * o ciclo (bounded pelo estado); a próxima observação é quem valida.
 */
export function runAutocorrectPhase(state, { correction, applied = {} } = {}) {
  const detail = applied.detail || (correction ? `correção proposta p/ ${correction.targets.length} alvo(s)` : "correção proposta")
  const next = recordPhase(state, {
    ok: applied.ok !== false,
    detail,
    tokens: applied.tokens || 0,
    evidence: { phase: "autocorrect", proposedBy: "llm", targets: correction?.targets || [] },
  })
  return { state: next }
}
