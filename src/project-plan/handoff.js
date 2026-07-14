/**
 * Handoff / reidratação compacta (PRD42 S42.10). Ao fechar um ciclo, produz um "brief vivo" que
 * permite retomar a sessão sem reler tudo. Dois compromissos de honestidade:
 *
 *  1. Tokens são SEMPRE `estimated` (heurística ~4 chars/token) — nunca apresentados como medidos.
 *  2. Economia do Headroom SÓ é reivindicada com `routed === true` E delta medido no ledger —
 *     sem routing, `callable_not_routed` ⇒ nenhum claim (constraint do projeto + S42.0A).
 *
 * PURO/testável.
 */
export const HANDOFF_SCHEMA = "gstack.handoff.v1"

/** Estimativa de tokens — SEMPRE rotulada `estimated` (nunca "measured"). */
export function estimateTokens(text) {
  const len = String(text || "").length
  return { tokens: Math.ceil(len / 4), source: "estimated" }
}

const briefField = (brief, k) => (brief ? brief[k] : null)

/** Constrói o pacote de handoff a partir do Product Brief (S42.1) + estado + threads abertas. */
export function buildHandoff({ brief = null, state = {}, openThreads = [] } = {}) {
  return {
    schema: HANDOFF_SCHEMA,
    createdAt: new Date().toISOString(),
    objective: briefField(brief, "objective"),
    mode: briefField(brief, "mode"),
    acceptances: briefField(brief, "acceptances") || [],
    state,
    openThreads: [...openThreads],
  }
}

/**
 * Benchmark de retomada: quanto custa reidratar via handoff vs reler tudo. Números ESTIMADOS
 * e rotulados — a economia real só se mede por ledger/routing (ver `headroomClaim`).
 */
export function resumeBenchmark({ handoffText = "", fullText = "" } = {}) {
  const h = estimateTokens(handoffText)
  const f = estimateTokens(fullText)
  const ratio = f.tokens > 0 ? Number((h.tokens / f.tokens).toFixed(3)) : 1
  return {
    schema: HANDOFF_SCHEMA,
    handoffTokens: h,
    fullTokens: f,
    ratio,
    savings: { value: Math.max(0, f.tokens - h.tokens), source: "estimated" },
    note: "estimativa heurística (~4 chars/token); economia REAL só via ledger/routing medido",
  }
}

/**
 * Gate de claim do Headroom: sem `routed` não há economia a reivindicar (callable_not_routed);
 * com routing, exige delta MEDIDO no ledger. Nunca inventa número.
 */
export function headroomClaim({ routed = false, ledgerDelta = null } = {}) {
  if (!routed) return { claimed: false, reason: "headroom callable_not_routed — sem routing não há claim de economia" }
  if (typeof ledgerDelta !== "number") return { claimed: false, reason: "routed, mas sem delta medido no ledger" }
  return { claimed: true, delta: ledgerDelta, source: "measured_ledger" }
}
