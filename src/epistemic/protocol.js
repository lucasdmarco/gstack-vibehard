import { buildReview } from "./schema.js"
import { citationSupportsClaim, LEVEL_BUDGET } from "./invariants.js"
import { iterationCapFor, resolveStopReason } from "./workflow-adapter.js"

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

// ── protocolo balanceado (EV1/EV2) ───────────────────────────────────────────

/** Chama uma trilha sem deixar exceção vazar: falha vira resultado vazio + motivo. */
function safeTrail(fn, label, failures) {
  try { return fn ? fn() : [] }
  catch (e) { failures.push(`trilha ${label} falhou: ${e.message}`); return [] }
}

/** Só fonte com estado `supports` conta como suporte (§12.2 / invariante S50.0). */
const onlySupporting = (found) => found.filter((s) => citationSupportsClaim(s.state))

function statusForClaim({ support, counterevidence }) {
  if (counterevidence.length) return "refuted" // contraevidência domina suporte
  return support.length ? "supported" : "inconclusive"
}

function buildClaim(text, index, { support, counterevidence, boundaryCases }) {
  return {
    id: `c${index + 1}`, text, kind: "fact",
    status: statusForClaim({ support, counterevidence }),
    support, counterevidence, boundaryCases, tests: [], limitations: [],
    // Confiança nunca supera a evidência: sem suporte, `low`.
    confidence: support.length && !counterevidence.length ? "medium" : "low",
  }
}

function budgetFor(level) {
  const b = LEVEL_BUDGET[level] || LEVEL_BUDGET.grounded
  return { network: b.network, extraModelCalls: 0, subagents: false, execution: false }
}

/**
 * Protocolo balanceado (§11.2): as trilhas de SUPORTE e de REFUTAÇÃO sempre
 * rodam — é o ponto do balanced prompting. Achar suporte não encerra a busca
 * por contraexemplo.
 *
 * `deps` injetável (`findSupport`/`findRefutation`/`findBoundaries`) mantém o
 * módulo puro e testável: nenhuma rede aqui.
 */
export function runBalancedProtocol({ question = "", level = "grounded", claimTexts = [], deps = {} } = {}) {
  const failures = []
  const cap = iterationCapFor(level)
  const claims = claimTexts.map((text, i) => {
    const support = onlySupporting(safeTrail(() => deps.findSupport(text), "support", failures))
    const counterevidence = safeTrail(() => deps.findRefutation(text), "refutation", failures)
    const boundaryCases = safeTrail(() => deps.findBoundaries(text), "boundary", failures)
    return buildClaim(text, i, { support, counterevidence, boundaryCases })
  })
  const decided = claims.some((c) => c.status !== "inconclusive")
  const stop = resolveStopReason({ iterations: 1, cap, sameFailureCount: 0, sufficient: decided, exhausted: !decided })
  return buildReview({
    question, level,
    classificationReasons: [`protocolo balanceado no nível ${level}`],
    claims,
    protocol: {
      completed: true, iterations: 1, stopReason: stop.stopReason,
      // Registro explícito de que as DUAS trilhas rodaram (auditável).
      trails: { support: true, refutation: true, boundary: true },
      handoff: stop.handoff,
    },
    notPerformed: [...failures, "nenhum código executado (Knowledge não executa — ver experimentPlan)"],
    tokenBudget: budgetFor(level),
  })
}
