import { decisionValue } from "./intake.js"
import { detectCapabilities } from "../skills/route.js"
import { isDirectionResolved, tokensForDirection } from "./design-direction.js"

/**
 * Product Brief (PRD42 S42.1, migrado p/ v2 no PRD47 S47.2) — artefato estruturado derivado do
 * intake. Cada ACEITE aponta um verificador REAL (`verifier`) ou é marcado `pending_verifier`
 * com motivo — NUNCA um aceite que finge estar coberto. Aceites de infraestrutura (scaffold/QG/
 * lint) têm gate real hoje; aceites de FEATURE (login funciona, pagamento processa) ficam
 * pending até a conformance (S42.4) / E2E (S42.13). É o "brief vivo" que alimenta o pipeline e
 * o closeout (S42.10).
 *
 * v2 (S47.2): ganha `designDirection` — frontend NUNCA vira plano executável sem direção
 * escolhida (catálogo/custom) ou opt-out EXPLÍCITO ("none"). Brief incompleto lança, nunca
 * segue adiante silenciosamente.
 */
export const PRODUCT_BRIEF_SCHEMA_V1 = "gstack.product-brief.v1"
export const PRODUCT_BRIEF_SCHEMA = "gstack.product-brief.v2"

/** v1 não tinha designDirection — migra pra v2 com opt-out explícito (nunca inventa escolha). */
export function migrateProductBrief(brief) {
  if (brief.schema !== PRODUCT_BRIEF_SCHEMA_V1) return brief
  return { ...brief, schema: PRODUCT_BRIEF_SCHEMA, designDirection: { value: "none", source: "migrated_v1", tokens: null } }
}

/** Aceites de infraestrutura — verificador real e já existente no produto. */
const INFRA_ACCEPTANCES = [
  { id: "scaffold", statement: "Scaffold do template criado sem escrita indevida (Lite não vaza Full).", verifier: { kind: "gate", ref: "verify --profile scaffold" } },
  { id: "quality-gate", statement: "Quality Gate passa fechado (0 blocker CRITICO/ALTO).", verifier: { kind: "gate", ref: "qg --strict" } },
  { id: "lint", statement: "Lint/typecheck sem erro de sintaxe.", verifier: { kind: "gate", ref: "lint" } },
]

/** Aceite de feature: sem verificador automatizado hoje → pending_verifier honesto. */
const featureAcceptance = (recipe) => ({
  id: "feature-behavior",
  statement: `Comportamento do produto "${recipe.label}" atende ao objetivo (fluxos principais).`,
  pending_verifier: { reason: "sem verificador automatizado; cobre em conformance (S42.4) / E2E (S42.13)" },
})

/** Aceite por integração provisionada: idem, pending até E2E de backend (S42.0D/S42.13). */
const integrationAcceptance = (name) => ({
  id: `integration-${name}`,
  statement: `Integração '${name}' provisionada e exercitada de ponta a ponta.`,
  pending_verifier: { reason: `E2E de '${name}' roda com engine (S42.13); sem engine = blocked, nunca verde falso` },
})

/** Todo aceite tem EXATAMENTE um de {verifier, pending_verifier}. Validador puro/testável. */
export function acceptanceIsHonest(a) {
  const hasV = Boolean(a.verifier)
  const hasP = Boolean(a.pending_verifier)
  return hasV !== hasP // XOR: nunca os dois, nunca nenhum
}

function buildAcceptances(recipe, integrations) {
  const acc = [...INFRA_ACCEPTANCES, featureAcceptance(recipe)]
  for (const name of integrations || []) acc.push(integrationAcceptance(name))
  return acc
}

// Fonte da decisão (flag/user_answer/recommended_default, PRD42 S42.1) — o brief guarda QUAL
// fonte decidiu a direção, nunca só o valor (DoD: "--yes registra os defaults e suas fontes").
function resolveDesignDirection(objective, decisions) {
  const rec = decisions.find((d) => d.id === "designDirection")
  const value = rec ? rec.value : "none"
  return { value, source: rec ? rec.source : "not_applicable", tokens: tokensForDirection(value) }
}

/** Frontend nunca vira plano executável sem direção resolvida (catálogo/custom/opt-out explícito). */
function assertDirectionHonest(objective, designDirection) {
  if (!detectCapabilities(objective).touchesFrontend) return
  if (!isDirectionResolved(designDirection.value)) {
    throw new Error(`product-brief: designDirection incompleta ('${designDirection.value}') — frontend exige direção ou opt-out explícito`)
  }
}

/**
 * Monta o brief a partir do resultado de `runIntake`. Retorna { schema, objective, projectName,
 * mode, decisions, acceptances, designDirection }. Lança se algum aceite ficar desonesto OU se
 * o frontend não tiver direção resolvida — brief incompleto NUNCA vira plano executável (DoD).
 */
export function buildProductBrief(intake) {
  const { objective, recipe, decisions } = intake
  const integrations = decisionValue(decisions, "integrations") || []
  const acceptances = buildAcceptances(recipe, integrations)
  const dishonest = acceptances.filter((a) => !acceptanceIsHonest(a))
  if (dishonest.length) throw new Error(`product-brief: aceite desonesto (${dishonest.map((a) => a.id).join(",")})`)
  const designDirection = resolveDesignDirection(objective, decisions)
  assertDirectionHonest(objective, designDirection)
  return {
    schema: PRODUCT_BRIEF_SCHEMA,
    objective,
    projectName: decisionValue(decisions, "projectName"),
    mode: decisionValue(decisions, "mode"),
    recipe: recipe.id,
    decisions,
    acceptances,
    designDirection,
  }
}

/** Conta aceites cobertos vs pendentes (para o scorecard honesto do closeout). */
export function acceptanceCoverage(brief) {
  const verified = brief.acceptances.filter((a) => a.verifier).length
  return { total: brief.acceptances.length, withVerifier: verified, pending: brief.acceptances.length - verified }
}
