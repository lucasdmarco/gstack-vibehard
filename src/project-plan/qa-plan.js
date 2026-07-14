import { tierSpec, QUALITY_TIERS } from "./quality-profile.js"
import { classifySurface } from "./change-surface.js"

/**
 * QA Plan (PRD42 S42.8). Deriva o plano de verificação a partir do TIER (profundidade) + da
 * SUPERFÍCIE do diff (o que mudou). Tier release sempre inclui a superfície inteira; smoke pode
 * focar. PURO/testável — não executa nada, só planeja.
 */
export const QA_PLAN_SCHEMA = "gstack.qa-plan.v1"

export function buildQaPlan({ tier = "smoke", files = [] } = {}) {
  const spec = tierSpec(tier)
  const surface = classifySurface(files)
  // superfície de risco eleva o mínimo: mesmo em smoke, mudança bloqueante exige typecheck+unit.
  const checks = surface.blocking ? [...new Set([...spec.checks, "typecheck", "unit-smoke"])] : [...spec.checks]
  return {
    schema: QA_PLAN_SCHEMA,
    tier,
    requiresEngine: spec.requiresEngine,
    budget: spec.budget,
    surface: surface.primary,
    blocking: surface.blocking,
    checks,
  }
}

export const isKnownTier = (t) => QUALITY_TIERS.includes(t)
