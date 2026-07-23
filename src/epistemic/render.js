/**
 * Render do resultado epistêmico (PRD50 S50.4, §13.3).
 *
 * Duas saídas do MESMO dado: humana (curta, com o que falta e o próximo passo
 * seguro) e JSON puro (para power users e automação). O render nunca inventa —
 * só formata o que o review já contém, incluindo `notPerformed`.
 */

const COUNT_LABEL = Object.freeze({
  supported: "Confirmado", refuted: "Contradito",
  inconclusive: "Inconclusivo", ambiguous: "Ambíguo",
  needs_expert: "Precisa de especialista", not_applicable: "Não aplicável",
})

function countByStatus(claims = []) {
  const out = {}
  for (const c of claims) out[c.status] = (out[c.status] || 0) + 1
  return out
}

const VERDICT_LABEL = Object.freeze({
  supported: "SUSTENTADO", refuted: "REFUTADO", mixed: "MISTO",
  inconclusive: "INCONCLUSIVO", needs_expert: "PRECISA DE ESPECIALISTA",
})

/** O que ainda falta para concluir — vem dos limites reais dos claims. */
function missingFrom(claims = []) {
  const out = []
  for (const c of claims) for (const l of c.limitations || []) out.push(l)
  return out
}

function nextSafeStep(review) {
  if (review.experimentPlan) return `executar o experimento via \`workflow\` (plano ${review.experimentPlan.schemaVersion})`
  if (review.protocol && review.protocol.handoff) return "revisão humana — o protocolo parou sem evidência suficiente"
  return null
}

const verdictLine = (v) => `Veredito: ${VERDICT_LABEL[v] || String(v).toUpperCase()}`

const countLines = (claims) =>
  Object.entries(countByStatus(claims)).map(([status, n]) => `${COUNT_LABEL[status] || status}: ${n} claim(s)`)

// Cada seção opcional: devolve a linha ou null (nunca imprime rótulo vazio).
const OPTIONAL_SECTIONS = Object.freeze([
  (r) => { const m = missingFrom(r.claims); return m.length ? `Falta: ${m.join("; ")}` : null },
  (r) => ((r.notPerformed || []).length ? `Não executado: ${r.notPerformed.join("; ")}` : null),
  (r) => { const n = nextSafeStep(r); return n ? `Próximo passo seguro: ${n}` : null },
])

/**
 * Render humano (§13.3). Mostra veredito, contagem, o que falta, o que NÃO foi
 * executado e o próximo passo seguro.
 */
export function renderEpistemicHuman(review) {
  const optional = OPTIONAL_SECTIONS.map((fn) => fn(review)).filter(Boolean)
  return [verdictLine(review.verdict), ...countLines(review.claims), ...optional].join("\n")
}

/** JSON puro — sem cores, sem prefixo, uma linha (contrato de automação). */
export function renderEpistemicJson(review) {
  return JSON.stringify(review)
}
