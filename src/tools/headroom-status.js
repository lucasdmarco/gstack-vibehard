/**
 * Status Headroom unificado em 6 dimensões (PRD51 S51.5.5, ação #10):
 * binário encontrado; comando responde; proxy saudável; harness roteado;
 * tráfego comprovado; economia observada.
 *
 * Cada dimensão já existia como primitiva espalhada em dois módulos
 * separados — `readiness.js` (`probeHeadroom`, dims 1-4) e
 * `headroom-traffic.js` (`proveRouting`, dims 5-6) — nunca unificadas num
 * único status object. Este módulo só COMPÕE os dois relatórios já
 * computados; nunca re-sonda o binário/proxy sozinho (função PURA).
 */
export const HEADROOM_STATUS_SCHEMA = "gstack.headroom.status.v1"

// "missing" é o único status onde o binário de fato não existe no disco/PATH.
// "installed_not_callable" já achou o binário — a falha é noutra dimensão.
const binaryFound = (status) => status !== "missing"
const commandResponds = (status) => status === "callable_not_routed" || status === "routed"

const readinessStatus = (readinessEntry) => (readinessEntry && readinessEntry.status) || "missing"
const readinessRouting = (readinessEntry) => (readinessEntry && readinessEntry.routing) || null

// Dims 1-2: binário/comando, a partir do status do readiness (dims 3-4 vêm de `routing`).
function commandDims(readinessEntry) {
  const status = readinessStatus(readinessEntry)
  const routing = readinessRouting(readinessEntry)
  return {
    binaryFound: binaryFound(status),
    commandResponds: commandResponds(status),
    proxyHealthy: Boolean(routing && routing.proxyRunning),
    harnessRouted: routing ? routing.byHarness : null,
  }
}

// Dims 5-6: tráfego/economia, a partir de `proveRouting` (headroom-traffic.js).
function trafficDims(proof) {
  const trafficProven = Boolean(proof && proof.state === "routed_proven")
  const savingsObserved = proof && proof.economyClaimable
    ? { tokensSaved: proof.savings.tokensSaved, savingsPercent: proof.savings.savingsPercent }
    : null
  return { trafficProven, savingsObserved }
}

/** @param {{readinessEntry: object, proof: object}} input */
export function buildHeadroomStatus({ readinessEntry, proof } = {}) {
  return {
    schemaVersion: HEADROOM_STATUS_SCHEMA,
    ...commandDims(readinessEntry),
    ...trafficDims(proof),
  }
}
