import { buildReview } from "./schema.js"

/**
 * Protocolo epistêmico (PRD50). Nesta sprint (S50.1) só o caminho **EV0**:
 * uma passagem, zero rede, zero subagente, zero model call extra.
 *
 * O protocolo balanceado (support/refute/boundary/abstain sobre o Loop Engine)
 * chega no S50.3 neste mesmo arquivo — não haverá segundo motor nem segundo
 * módulo de protocolo.
 *
 * EV0 é um SANITY CHECK, não uma verificação: por isso nunca emite verdict
 * `supported` e sempre declara em `notPerformed` o que deixou de fazer.
 */

const EV0_NOT_PERFORMED = Object.freeze([
  "nenhuma fonte externa consultada",
  "nenhum teste executado",
  "nenhuma ferramenta adicional invocada",
])

/**
 * EV0 em uma passagem. `limitations` é o que o chamador já sabe que falta —
 * é o único caso em que EV0 fala além da resposta (§13.2).
 */
export function runSanityReview({ question = "", answer = "", limitations = [] } = {}) {
  const claims = [{
    id: "answer",
    text: String(answer),
    kind: "inference",
    // Nunca `supported`: EV0 não verificou nada. `not_applicable` é o estado
    // honesto de um sanity check sobre resposta trivial.
    status: limitations.length ? "inconclusive" : "not_applicable",
    support: [],
    counterevidence: [],
    boundaryCases: [],
    tests: [],
    limitations,
    confidence: "low",
  }]
  return buildReview({
    question, level: "sanity", classificationReasons: ["classificado como trivial (EV0)"],
    claims,
    protocol: { completed: true, iterations: 1, stopReason: "sufficient" },
    notPerformed: [...EV0_NOT_PERFORMED],
    tokenBudget: { network: false, extraModelCalls: 0, subagents: false, execution: false },
  })
}

/**
 * Render humano do EV0 (§13.2): responde normalmente e só acrescenta linha de
 * limite quando existe limite real. Sem ressalva, a saída é a resposta crua —
 * é isso que mantém o overhead do trivial perto de zero.
 */
export function renderSanityHuman(review) {
  const claim = (review.claims || [])[0] || {}
  const lines = [String(claim.text || "")]
  for (const l of claim.limitations || []) lines.push(`Limite: ${l}`)
  return lines.join("\n")
}
