/**
 * Scroll World distributed governed capability (PRD49 S49.7).
 *
 * NUNCA um skill/comando/catálogo público novo — as regras auditadas do
 * Scroll World são distribuídas para papéis de especialista JÁ EXISTENTES
 * (frontend/UX/a11y/performance/QA) via Agent Factory, materializadas só por
 * run (PRD47). `PUBLIC_SKILL_ID` é sempre `null` — é o controle que prova essa
 * invariante.
 *
 * Intake obrigatório (8 itens, §PRD49 49.7) — fail-closed: qualquer item
 * ausente bloqueia, incluindo a confirmação explícita de gasto (nunca
 * bypassável por `--yes`, ver media-budget.js).
 */
export const SCROLL_WORLD_SCHEMA = "gstack.scroll-world-capability.v1"

// Nenhum skill público é criado por esta capacidade.
export const PUBLIC_SKILL_ID = null

export const MANDATORY_INTAKE_FIELDS = Object.freeze([
  "businessSubject", "brandKitOrProposal", "brandRegisterAndDirection", "orderedScenesAndCopy",
  "mobileChain", "providerAndTier", "estimatedGenerations", "spendConfirmed",
])

const isPresent = (v) => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0)

/** Valida os 8 itens obrigatórios do intake. `spendConfirmed` precisa ser literalmente `true`. */
export function validateScrollWorldIntake(intake = {}) {
  const missing = MANDATORY_INTAKE_FIELDS.filter((f) => {
    if (f === "spendConfirmed") return intake.spendConfirmed !== true
    return !isPresent(intake[f])
  })
  return { ok: missing.length === 0, missing }
}

// Papéis JÁ EXISTENTES do Agent Factory (agents/agents/*.md, 20 personas reais hoje).
// Não existe papel dedicado de UX/acessibilidade -- ux/accessibility mapeiam pro
// frontend-specialist real (many-to-one honesto), nunca um papel fabricado.
export const EXISTING_SPECIALIST_ROLES = Object.freeze([
  "frontend-specialist", "performance-optimizer", "qa-automation-engineer",
])

const DOMAIN_TO_ROLE = Object.freeze({
  frontend: "frontend-specialist", ux: "frontend-specialist", accessibility: "frontend-specialist",
  performance: "performance-optimizer", qa: "qa-automation-engineer",
})

/** Mapeia um domínio de regra Scroll World pro papel de especialista existente. Desconhecido -> null. */
export function routeScrollWorldFragment(domain) {
  return DOMAIN_TO_ROLE[domain] || null
}

/**
 * Fallback: qualquer dependência ausente (auth/créditos/FFmpeg/Pillow/capacidade
 * do provider) preserva o brief aprovado e cai pra um caminho estático —
 * NUNCA destrói o projeto nem marca falsamente como completo.
 */
export function resolveGenerationFallback({ authOk, creditsOk, ffmpegOk, pillowOk, providerCapable } = {}) {
  const allOk = authOk && creditsOk && ffmpegOk && pillowOk && providerCapable
  return { mode: allOk ? "generate" : "static_fallback", preservesApprovedBrief: true }
}

/**
 * Orquestra a rota completa com um provider FAKE (nunca rede/gasto real) —
 * prova a estrutura do fluxo intake→gate de gasto→cap de iteração→geração→
 * manifesto pra E2E, sem depender de um provider pago configurado. Cada
 * verificação usa os mesmos gates reais (nunca uma versão "de mentirinha" da
 * lógica); só o PROVIDER é fake.
 */
export async function runFakeProviderChain({ intake, budget, deps = {} } = {}) {
  const validation = validateScrollWorldIntake(intake)
  if (!validation.ok) return { ok: false, stage: "intake", missing: validation.missing }

  const spend = deps.canProceedWithMediaSpend({ estimatedCost: budget.estimatedCost, confirmed: intake.spendConfirmed })
  if (spend !== "ok") return { ok: false, stage: "spend", reason: "spend_not_confirmed" }

  const cap = deps.enforceIterationCap({ attempted: budget.attempted, cap: budget.cap })
  if (!cap.ok) return { ok: false, stage: "iteration_cap", reason: cap.reason }

  const provider = deps.oneProviderPerChain({ chainProviders: ["fake-provider"], documentedRecovery: false })
  if (!provider.ok) return { ok: false, stage: "provider_chain", reason: provider.reason }

  const fallback = resolveGenerationFallback(deps.dependencies || { authOk: true, creditsOk: true, ffmpegOk: true, pillowOk: true, providerCapable: true })
  const scenes = intake.orderedScenesAndCopy.map((s, i) => ({
    scene: s.scene ?? i + 1,
    mode: fallback.mode,
    manifest: fallback.mode === "generate"
      ? deps.buildMediaManifestEntry({
          provider: "fake-provider", prompt: s.copy, model: "fake-model-v1", source: "generated",
          licenseNote: "synthetic fixture, no real provider called", dimensions: { width: 512, height: 512 },
          fileContent: `fake-clip-${s.scene ?? i + 1}`,
        })
      : null,
  }))

  return { ok: true, mode: fallback.mode, scenes }
}
