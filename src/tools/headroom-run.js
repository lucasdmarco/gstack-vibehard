/**
 * Headroom por RUN (PRD41 S41.8 / PRD40 P1.4).
 *
 * A economia deixa de ser um número ACUMULADO (lifetime) e passa a ser um DELTA por run,
 * vinculado ao runId: snapshot de `savings` ANTES e DEPOIS do run; só afirma economia com
 * `delta.calls > 0 && delta.tokensSaved > 0`. E a reutilização de porta do proxy passa por
 * OWNERSHIP: uma porta ocupada por processo ALHEIO é detectada e NUNCA reutilizada/morta.
 *
 * Invariantes intactas: routing sempre child-scoped; nunca `wrap`, nunca MCP global, nunca
 * config global de harness. PURO/testável.
 */
export const HEADROOM_RUN_SCHEMA = "gstack.headroom.run.v1"

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function normalizeSnap(s) {
  if (!s || s.available === false) return { available: false, calls: 0, tokensSaved: 0 }
  return { available: true, calls: num(s.calls), tokensSaved: num(s.tokensSaved ?? s.tokens_saved) }
}

/**
 * Prova de economia por DELTA de um run. `before`/`after` são snapshots de savings
 * (readHeadroomSavings). Claim SÓ com delta de chamadas E de tokens salvos positivos.
 */
export function proveEconomyDelta({ before, after, runId = null } = {}) {
  const b = normalizeSnap(before)
  const a = normalizeSnap(after)
  if (!b.available || !a.available) {
    return { schemaVersion: HEADROOM_RUN_SCHEMA, runId, claimable: false, state: "savings_unavailable", delta: null, note: "savings do proxy indisponível — nenhuma economia afirmada" }
  }
  const delta = { calls: a.calls - b.calls, tokensSaved: a.tokensSaved - b.tokensSaved }
  const claimable = delta.calls > 0 && delta.tokensSaved > 0
  return {
    schemaVersion: HEADROOM_RUN_SCHEMA,
    runId,
    claimable,
    state: claimable ? "routed_proven_delta" : "no_delta",
    delta,
    note: claimable
      ? `economia deste run: ${delta.tokensSaved} tokens em ${delta.calls} chamada(s) (delta vinculado ao runId)`
      : "sem delta de tráfego neste run — NENHUMA economia afirmada (não é enfeite)",
  }
}

/** A idade observada do processo na porta bate com o `startedAt` do manifesto? */
function ownershipAgeMatches(startedAt, ageSec, nowMs, tolSec) {
  if (!startedAt || ageSec == null) return true // sem dado de idade: não é sinal de foreign
  const recorded = Date.parse(startedAt)
  if (Number.isNaN(recorded)) return true
  return Math.abs(ageSec - (nowMs - recorded) / 1000) <= tolSec
}

/**
 * Decide o que fazer com a porta do proxy. FAIL-SAFE: só reutiliza se o PID (e a idade)
 * batem com o manifesto do NOSSO proxy; porta ocupada por processo ALHEIO → `foreign`,
 * ação `abort` (jamais matar/reutilizar processo de terceiro). Sem ocupante → `start`.
 */
// Casos de borda (porta livre / ocupada sem manifesto nosso), ou null p/ seguir a checagem.
function portOwnershipPrecheck(manifest, holder) {
  if (!holder || holder.pid == null) return { state: "free", ownedByUs: false, action: "start" }
  if (!manifest || manifest.pid == null) {
    return { state: "foreign", ownedByUs: false, action: "abort", reason: "porta ocupada por processo alheio (sem manifesto nosso) — NÃO reutilizar/matar" }
  }
  return null
}

export function proxyPortOwnership({ manifest, holder, nowMs = Date.now(), tolSec = 10 } = {}) {
  const pre = portOwnershipPrecheck(manifest, holder)
  if (pre) return pre
  const samePid = Number(holder.pid) === Number(manifest.pid)
  const ageOk = ownershipAgeMatches(manifest.startedAt, holder.ageSec, nowMs, tolSec)
  if (samePid && ageOk) return { state: "ours", ownedByUs: true, action: "reuse" }
  return { state: "foreign", ownedByUs: false, action: "abort", reason: "PID/idade não batem com o manifesto do nosso proxy — porta de terceiro, não mexer" }
}
