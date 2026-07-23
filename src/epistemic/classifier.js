import { LEVELS } from "./schema.js"

/**
 * Classificador de nível epistêmico (PRD50 S50.1, §9). DETERMINÍSTICO e puro:
 * os mesmos sinais produzem sempre o mesmo nível e as mesmas razões. Nenhuma
 * LLM participa desta decisão.
 *
 * Fail-safe deliberado (§9.3): ausência de sinal cai em `grounded`, NUNCA em
 * `sanity`. Não classificar não pode virar desculpa para não verificar.
 */
export const EPISTEMIC_CLASSIFIER_SCHEMA = "gstack.epistemic-classifier.v1"

// Ordem = precedência. O primeiro grupo que casar define o piso do nível.
const ADVERSARIAL_SIGNALS = Object.freeze([
  ["securityImpact", "impacto em segurança"],
  ["releaseImpact", "impacto em release"],
  ["touchesSecrets", "toca secrets"],
  ["irreversible", "mudança irreversível"],
  ["supplyChain", "supply chain"],
  ["moneyImpact", "impacto financeiro"],
  ["noveltyClaim", "alegação de novidade/estado da arte"],
])

const GROUNDED_SIGNALS = Object.freeze([
  ["codeClaim", "claim sobre código/dependência/arquitetura"],
  ["factualClaim", "claim factual/numérico/causal"],
  ["externalInfoNeeded", "depende de informação externa/atual"],
  ["conflictingSources", "fontes conflitantes"],
])

const hits = (signals, s) => signals.filter(([k]) => s[k] === true).map(([, why]) => why)

const isTrivial = (s) =>
  s.localOnly === true && s.reversible === true && s.externalInfoNeeded !== true && s.shortAnswer === true

/**
 * → { level, reasons, requiresSourceGrounding, expertRequired, mayBeInconclusive }.
 * `reasons` nunca é vazio: toda classificação diz por quê.
 */
export function classifyLevel(signals = {}) {
  const adversarial = hits(ADVERSARIAL_SIGNALS, signals)
  const grounded = hits(GROUNDED_SIGNALS, signals)
  const flags = {
    requiresSourceGrounding: signals.externalInfoNeeded === true,
    expertRequired: signals.noveltyClaim === true,
    mayBeInconclusive: signals.conflictingSources === true || signals.incompleteEvidence === true,
  }
  if (adversarial.length) return { level: "adversarial", reasons: adversarial, ...flags }
  if (grounded.length) return { level: "grounded", reasons: grounded, ...flags }
  if (isTrivial(signals)) {
    return { level: "sanity", reasons: ["pergunta local, reversível, sem fato externo e de resposta curta"], ...flags }
  }
  // §9.3: sem sinal suficiente, o piso é EV1 — nunca EV0.
  return { level: "grounded", reasons: ["sem sinal suficiente para classificar — fail-safe para grounded (§9.3)"], ...flags }
}

const rank = (level) => LEVELS.indexOf(level)

function refusedDowngrade(classified) {
  return {
    level: classified, downgraded: false, downgradeRefused: true, mayClaimVerified: true,
    riskReceipt: null,
    reason: "rebaixar um nível de alto risco exige confirmação explícita (§9.3)",
  }
}

function confirmedDowngrade(classified, target) {
  return {
    level: target, downgraded: true, downgradeRefused: false,
    // O ponto central: rebaixou, então o resultado NUNCA pode alegar verificação.
    mayClaimVerified: false,
    riskReceipt: {
      classifiedAs: classified, downgradedTo: target, confirmedByUser: true,
      risk: `verificação reduzida de ${classified} para ${target} por escolha explícita do usuário`,
    },
    reason: "rebaixamento confirmado — claim 'verified' proibido neste resultado",
  }
}

/**
 * Resolve o nível final a partir da classificação + pedido do usuário (§9.3).
 * Elevar é sempre livre. Rebaixar exige confirmação e custa o direito de alegar
 * verificação.
 */
export function resolveLevel({ classified = "grounded", requested = "auto", confirmedDowngrade: confirmed = false } = {}) {
  const base = LEVELS.includes(classified) ? classified : "grounded"
  if (requested === "auto" || !LEVELS.includes(requested)) {
    return { level: base, downgraded: false, downgradeRefused: false, mayClaimVerified: true, riskReceipt: null, reason: "classificação automática" }
  }
  if (rank(requested) >= rank(base)) {
    return { level: requested, downgraded: false, downgradeRefused: false, mayClaimVerified: true, riskReceipt: null, reason: "usuário elevou o nível" }
  }
  return confirmed ? confirmedDowngrade(base, requested) : refusedDowngrade(base)
}

// Mapeia um caso do corpus de fixtures para sinais — mantém o corpus como fonte
// de verdade do teste de classificação, sem duplicar heurística no teste.
const CORPUS_SIGNALS = Object.freeze({
  sanity: { localOnly: true, reversible: true, shortAnswer: true },
  grounded: { codeClaim: true },
  adversarial: { noveltyClaim: true },
})

/** Sinais derivados de um caso do corpus (`expectedLevel` + `groundTruth`). */
export function signalsFromCorpusCase(c = {}) {
  const base = { ...(CORPUS_SIGNALS[c.expectedLevel] || {}) }
  if (c.groundTruth === "insufficient") base.incompleteEvidence = true
  if (c.groundTruth === "ambiguous") base.conflictingSources = true
  return base
}
