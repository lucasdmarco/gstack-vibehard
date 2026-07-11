import { proveRouting } from "../tools/headroom-traffic.js"
import { routeDefaultOn, headroomPendency } from "../tools/headroom-policy.js"
import { loopVerdict } from "./replit-loop.js"

/**
 * Prova de economia + honestidade do ciclo fechado (PRD37 37.5/37.6 — Fase D5,
 * FECHA o programa PRD35-36-37 em 4.0.0). Amarra o ciclo Replit-parity ao Headroom
 * REAL (Fase C): mede os tokens do loop e só afirma ECONOMIA com prova do ledger.
 *
 * Honestidade (o núcleo do produto — nada é enfeite):
 *  - economia só é AFIRMADA com `calls>0` E `tokens_saved>0` (proveRouting/C2);
 *    enquanto `callable_not_routed`, o loop RODA mas NÃO afirma economia — e no Full
 *    (default-on, C3) isso é tratado como PENDÊNCIA a corrigir, não estado aceitável;
 *  - o ciclo só fecha `validated` com evidência de navegador limpa (D2/D6); senão
 *    `degraded`/`needs_user`. Nunca finge o ciclo fechado.
 *
 * PURO/testável: proxyState, env e run injetáveis (via proveRouting).
 */

export const LOOP_ECONOMY_SCHEMA = "gstack.loop-economy.v1"

/**
 * Economia do ciclo. `routing` = saída de proveRouting (C2). O consumo de tokens do
 * loop vem do estado (bounded). Só `claimable` com economia provada pelo ledger.
 */
const loopTokensOf = (state) => state?.consumed?.tokens ?? 0

// Campos numéricos + pendência conforme a economia é ou não provável. Economia
// não provada = equivalente, p/ pendência, a `callable_not_routed` (Headroom
// instalado/callable mas sem tráfego provado — não afirma economia).
function economyFields(claimable, savings, onByDefault) {
  if (!claimable) return { tokensSaved: 0, savingsPercent: 0, pendency: headroomPendency({ status: "callable_not_routed", onByDefault }) }
  return { tokensSaved: savings.tokensSaved, savingsPercent: savings.savingsPercent, pendency: null }
}

function economyNote(claimable, savings) {
  if (!claimable) return "economia NÃO afirmada — Headroom não provou tráfego (o ciclo roda; a economia é pendência, não enfeite)"
  return `economia PROVADA: ${savings.tokensSaved} tokens (${savings.savingsPercent}%) — ciclo Replit-parity mais barato, com fonte`
}

export function buildLoopEconomy({ state, routing, mode = "full", env = {} } = {}) {
  const r = routing || {}
  const claimable = Boolean(r.economyClaimable)
  const onByDefault = routeDefaultOn({ mode, env })
  return {
    schemaVersion: LOOP_ECONOMY_SCHEMA,
    loopTokens: loopTokensOf(state),
    claimable,
    routingState: r.state || "proxy_off",
    note: economyNote(claimable, r.savings),
    ...economyFields(claimable, r.savings, onByDefault),
  }
}

// Conveniência: prova o routing (C2) e monta a economia numa chamada.
export function proveLoopEconomy({ state, cwd, proxyState = null, run, mode = "full", env = {} } = {}) {
  const routing = proveRouting({ cwd, proxyState, run })
  return buildLoopEconomy({ state, routing, mode, env })
}

/**
 * Fecha o ciclo com HONESTIDADE (37.6): combina o verdito de observação (D1/D2) com
 * a economia (D5). O ciclo só é `validated` com evidência de navegador limpa; a
 * economia é um dado SEPARADO (nunca "validado" por ter rodado barato).
 */
export function finalizeLoop({ state, observation = null, economy = null } = {}) {
  const verdict = loopVerdict(state, observation)
  return {
    schemaVersion: LOOP_ECONOMY_SCHEMA,
    verdict: verdict.verdict,
    reason: verdict.reason,
    bounded: verdict.bounded,
    validatedByBrowser: verdict.verdict === "validated",
    economy: economy ? { claimable: economy.claimable, tokensSaved: economy.tokensSaved, note: economy.note } : null,
    honest: buildHonestLine(verdict.verdict, economy),
  }
}

function buildHonestLine(verdict, economy) {
  const cycle = verdict === "validated"
    ? "ciclo fechado com evidência de navegador"
    : `ciclo NÃO fechado (${verdict}) — sem evidência limpa, não finge`
  const econ = economy?.claimable ? ` · economia provada (${economy.tokensSaved} tokens)` : " · economia não afirmada"
  return cycle + econ
}
