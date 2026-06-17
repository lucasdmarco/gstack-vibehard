/**
 * Regras de parada (PRD kilo-loop-patterns §6). Mapeiam para o loop-budget real
 * (`src/loop-budget/policy.js`) quando há campo equivalente; as demais ficam
 * declarativas (o executor/worker as honra, não há número a configurar).
 *
 * Módulo PURO: não executa nada; só descreve e resolve regras efetivas.
 */

export const STOPPING_RULES = Object.freeze({
  maxIterations: { id: "maxIterations", mapsTo: "maxIterations", description: "Para após N iterações." },
  sameFailureLimit: { id: "sameFailureLimit", mapsTo: "maxConsecutiveSameFailure", description: "Para após a mesma falha repetida N vezes." },
  maxWallTimeSeconds: { id: "maxWallTimeSeconds", mapsTo: "maxWallTimeSeconds", description: "Para ao exceder o tempo de parede." },
  stopOnMissingSecrets: { id: "stopOnMissingSecrets", mapsTo: null, description: "Para/handoff se faltarem credenciais (não loga secrets)." },
  stopBeforeDestructiveCommand: { id: "stopBeforeDestructiveCommand", mapsTo: null, description: "Para antes de qualquer comando destrutivo (exige confirmação)." },
  stopOnUnrelatedUserChanges: { id: "stopOnUnrelatedUserChanges", mapsTo: null, description: "Para se o usuário fez mudanças fora do escopo." },
  requireHumanReviewBeforeMerge: { id: "requireHumanReviewBeforeMerge", mapsTo: "humanHandoffOnCap", description: "Exige revisão humana antes de merge." },
  handoffOnAmbiguousProductDecision: { id: "handoffOnAmbiguousProductDecision", mapsTo: null, description: "Handoff em decisão de produto ambígua." },
})

export function getStoppingRule(id) {
  return STOPPING_RULES[id] || null
}

/**
 * Resolve as regras efetivas de um conjunto de ids contra um loop-budget.
 * Para regras com `mapsTo`, anexa o valor real do budget; as declarativas
 * ficam com `value: null`.
 */
export function resolveStoppingRules(ruleIds = [], budget = {}) {
  return ruleIds.map((id) => {
    const rule = STOPPING_RULES[id]
    if (!rule) return { id, unknown: true }
    const value = rule.mapsTo ? budget[rule.mapsTo] : null
    return { id: rule.id, mapsTo: rule.mapsTo, value: value ?? null, description: rule.description }
  })
}
