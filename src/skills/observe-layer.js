import { pollReadiness } from "../runtime/supervisor.js"
import { runVisualGate, playwrightDriver, browserDriverAvailable } from "./visual-gate.js"
import { recordPhase } from "./replit-loop.js"

/**
 * Camada de OBSERVAÇÃO do ciclo Replit-parity (PRD37 37.2 — Fase D2). É a fase
 * `observe` do loop: com o app RODANDO (fase `run`, supervisor/dev), abre o
 * navegador headless (B3 visual-gate), captura screenshot + console + rede + a11y
 * como EVIDÊNCIA e devolve a observação no formato que o contrato (D1) decide:
 * `{ visualValidated, problems }`.
 *
 * Regras de honestidade (nada é enfeite):
 *  - app que NÃO responde → `unreachable`, nunca observa um app morto nem finge
 *    verde (readiness bounded, reusa `pollReadiness` do supervisor);
 *  - sem driver de navegador → `needs_browser` (propagado do visual-gate): o ciclo
 *    NÃO valida sem prova de navegador;
 *  - a OBSERVAÇÃO (determinística) decide — o LLM nunca é o gate desta fase.
 *
 * PURO/testável: driver, poll e io injetáveis.
 */

export const OBSERVE_LAYER_SCHEMA = "gstack.observe-layer.v1"

// Mapeia o resultado do visual-gate para a observação que o loopVerdict/recordPhase
// consomem: só `validated` conta como visualmente válido.
export function summarizeObservation(gateResult) {
  const g = gateResult || {}
  const validated = g.status === "validated"
  return {
    visualValidated: validated,
    problems: validated ? [] : (g.problems || ["observação sem resultado de gate"]),
    gateStatus: g.status || "unknown",
    screenshotPath: g.screenshotPath || null,
  }
}

// Resolve o driver real (Playwright headless) só se disponível; senão null →
// o visual-gate reporta needs_browser (honesto, nunca inventa evidência).
async function resolveDriver(driver) {
  if (driver !== undefined) return driver
  if (!browserDriverAvailable()) return null
  return playwrightDriver({ headless: true })
}

function unreachableResult(url) {
  return {
    schemaVersion: OBSERVE_LAYER_SCHEMA,
    status: "unreachable", reachable: false, url,
    visualValidated: false,
    problems: [`app não respondeu em ${url} — a fase run não subiu um servidor observável`],
    gate: null,
  }
}

/**
 * Observa o app RODANDO em `url`. Espera readiness (bounded), abre o navegador e
 * avalia o gate visual. Grava evidência via runVisualGate (Evidence Ledger).
 * `poll` e `driver` são injetáveis para teste.
 */
export async function observeRunningApp({ root, runId, url, uiChanged = true, driver, poll = pollReadiness, io } = {}) {
  const ready = await poll(url, { timeoutMs: 15000, intervalMs: 500 })
  if (!ready.ok) return unreachableResult(url)
  const resolved = await resolveDriver(driver)
  const gate = await runVisualGate({ root, runId, url, uiChanged, driver: resolved, io })
  const observed = summarizeObservation(gate)
  return { schemaVersion: OBSERVE_LAYER_SCHEMA, status: "observed", reachable: true, url, ...observed, gate }
}

/**
 * Roda a fase `observe` sobre o estado do loop (D1): observa o app e registra o
 * resultado com `recordPhase` — a observação (determinística) decide, então uma
 * observação não-validada roteia o ciclo de volta para `autocorrect` (D3).
 * Retorna `{ state, observation }`.
 */
export async function runObservePhase(state, { root, url, driver, poll, io } = {}) {
  const observation = await observeRunningApp({ root, runId: state.runId, url, driver, poll, io })
  const detail = observation.visualValidated ? `observado limpo (${url})` : observation.problems.join("; ")
  const next = recordPhase(state, {
    ok: observation.visualValidated,
    detail,
    evidence: { phase: "observe", status: observation.status, gateStatus: observation.gateStatus, screenshotPath: observation.screenshotPath },
  })
  return { state: next, observation }
}
