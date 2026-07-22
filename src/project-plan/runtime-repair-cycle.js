/**
 * PRD47 S47.4 — Runtime, observação e autocorreção BOUNDED: compõe runtime
 * supervisor/observe-layer/visual-gate/diagnose-loop/checkpoint numa decisão
 * ÚNICA (dev → health → observe → diagnose → repair/checkpoint/handoff). Não
 * duplica nenhum deles — só decide o PRÓXIMO passo a partir dos resultados já
 * computados por cada um (mesma disciplina do golden-run.js no S47.1: agregador
 * fino, nunca reimplementa a lógica que já existe e já é testada).
 */
import { evaluateVisualGate } from "../skills/visual-gate.js"
import { diagnoseObservation, decideNext } from "../skills/diagnose-loop.js"
import { rollbackToLastGreen } from "../skills/loop-checkpoint.js"

export const REPAIR_CYCLE_SCHEMA = "gstack.runtime-repair-cycle.v1"

/** Só reinicia serviços cujo health check REPROVOU — nunca o que já está saudável (DoD). */
export function servicesToRestart(healthResults = []) {
  return healthResults.filter((h) => h.healthy !== true).map((h) => h.service)
}

/** App "unreachable" nunca é validado por omissão — health vazio ou reachable:false = falha. */
function appReachable(healthResults) {
  return healthResults.length > 0 && healthResults.every((h) => h.reachable !== false)
}

/**
 * Decide o próximo passo do ciclo runtime. NUNCA presume saudável sem prova; NUNCA
 * reinicia serviço saudável; NUNCA corrige além do budget (delega a decisão bounded
 * pra `diagnose-loop.js`, que já é a fonte real dessa disciplina).
 */
export function evaluateRepairCycle({ healthResults = [], uiChanged = false, observation = null, acceptance = [], loopState } = {}) {
  const restart = servicesToRestart(healthResults)
  if (!appReachable(healthResults)) {
    return { schemaVersion: REPAIR_CYCLE_SCHEMA, action: "handoff", verdict: "needs_user", reason: "app unreachable — nunca validado sem health real", restart }
  }
  const visual = evaluateVisualGate({ uiChanged, observation })
  if (visual.blocked) {
    const action = visual.status === "needs_browser" ? "handoff" : "diagnose"
    return { schemaVersion: REPAIR_CYCLE_SCHEMA, action, verdict: visual.status, reason: visual.problems.join("; "), restart, visual }
  }
  const diagnosis = diagnoseObservation({ observation, acceptance })
  const next = decideNext(loopState, diagnosis)
  return { schemaVersion: REPAIR_CYCLE_SCHEMA, action: next.action, verdict: next.verdict, reason: next.reason, restart, diagnosis }
}

/** Restaura o último checkpoint verde — reusa a função já provada do PRD41 S41.7, nunca duplicada. */
export function restoreLastGreen(opts) {
  return rollbackToLastGreen(opts)
}
