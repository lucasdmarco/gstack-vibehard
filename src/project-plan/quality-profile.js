/**
 * Quality Profiles / Tiers (PRD42 S42.8). `--tier` é ORTOGONAL ao `--profile` (scaffold|full):
 * o profile diz QUAIS gates existem; o tier diz QUÃO FUNDO verificar.
 *   • smoke      — barato/rápido (lint + typecheck + unit smoke); sem engine.
 *   • regression — unit + integração; sem engine.
 *   • release    — tudo + E2E de backend + coverage; EXIGE engine (Docker). Engine ausente ⇒
 *                  `blocked_missing_engine` (NUNCA skip-verde) — mesma regra do S42.0D.
 *
 * Invariante: `not_applicable` NUNCA conta como `passed`. PURO/testável.
 */
export const QUALITY_PROFILE_SCHEMA = "gstack.quality-profile.v1"
export const QUALITY_TIERS = Object.freeze(["smoke", "regression", "release"])

export const TIER_SPEC = Object.freeze({
  smoke: { checks: ["lint", "typecheck", "unit-smoke"], requiresEngine: false, budget: { maxSeconds: 120 } },
  regression: { checks: ["lint", "typecheck", "unit", "integration"], requiresEngine: false, budget: { maxSeconds: 600 } },
  release: { checks: ["lint", "typecheck", "unit", "integration", "e2e-backend", "coverage"], requiresEngine: true, budget: { maxSeconds: 1800 } },
})

/** Spec de um tier (fail-closed: tier desconhecido lança). */
export function tierSpec(tier) {
  const spec = TIER_SPEC[tier]
  if (!spec) throw new Error(`tier desconhecido: ${tier} (use ${QUALITY_TIERS.join("|")})`)
  return spec
}

const PASS_STATUSES = new Set(["passed", "cache_hit", "advisory"])
const BLOCK_STATUSES = new Set(["failed", "timed_out", "blocked_missing_engine"])

/**
 * Agrega o gate de tier. Se o tier EXIGE engine e ele está ausente ⇒ `blocked_missing_engine`.
 * `ready` só sem check bloqueante. `passedCount` exclui `not_applicable` (nunca vira pass).
 */
export function aggregateTier({ tier, engineAvailable = false, checks = [] } = {}) {
  const spec = tierSpec(tier)
  if (spec.requiresEngine && !engineAvailable) {
    return { schema: QUALITY_PROFILE_SCHEMA, tier, ready: false, engineRequired: true, blocked: [{ reason: "blocked_missing_engine", detail: "tier release exige engine (Docker) — não é skip-verde" }], passedCount: 0, checks }
  }
  const blocking = checks.filter((c) => BLOCK_STATUSES.has(c.status))
  const passedCount = checks.filter((c) => PASS_STATUSES.has(c.status)).length // not_applicable NÃO entra
  return {
    schema: QUALITY_PROFILE_SCHEMA, tier, ready: blocking.length === 0,
    engineRequired: spec.requiresEngine,
    blocked: blocking.map((c) => ({ check: c.name, status: c.status })),
    passedCount, checks,
  }
}
