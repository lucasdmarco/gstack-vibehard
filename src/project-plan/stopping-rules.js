/**
 * Regras de parada (PRD kilo-loop-patterns §6). Mapeiam para o loop-budget real
 * (`src/loop-budget/policy.js`) quando há campo equivalente; as demais ficam
 * declarativas (o executor/worker as honra, não há número a configurar).
 *
 * Módulo PURO: não executa nada; só descreve e resolve regras efetivas.
 */

import { SKIP_STATUSES, latestByStep } from "./evidence-ledger.js"

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

// ── Retomada + hard cap do Evidence Task Loop (PRD18 Sprint 4) ──────────────
// Puro: decide ONDE retomar e QUANDO parar, a partir dos recibos de evidência.

export const DEFAULT_HARD_CAP = 3

/** Chave estável de um passo (id > step > label > a própria string). */
export function stepKey(step) {
  if (typeof step === "string") return step
  if (!step) return "?"
  return step.id || step.step || step.label || "?"
}

/** Mapa etapa→status (último recibo por etapa). */
export function statusByStep(entries) {
  const map = new Map()
  for (const e of latestByStep(entries)) map.set(e.step, e.status)
  return map
}

/**
 * Índice do primeiro passo a (re)executar: pula proved/not_applicable/advisory,
 * volta ao primeiro failed/pending/nunca-tentado. -1 = nada a retomar.
 */
export function resumeIndex(steps, entries) {
  const byStep = statusByStep(entries)
  return steps.findIndex((s) => !SKIP_STATUSES.has(byStep.get(stepKey(s))))
}

/**
 * Decide parar. @returns {stop, reason}. reason: "complete"|"hard_cap"|"blocked"|"".
 * `blocked` = falhou sem passo retomável (repetir sem mudança seria loop zumbi).
 */
export function shouldStop({ attempts = 0, hardCap = DEFAULT_HARD_CAP, lastStatus, resumable = true } = {}) {
  if (lastStatus === "complete" || lastStatus === "done") return { stop: true, reason: "complete" }
  if (lastStatus === "failed" && !resumable) return { stop: true, reason: "blocked" }
  if (attempts >= hardCap) return { stop: true, reason: "hard_cap" }
  return { stop: false, reason: "" }
}
