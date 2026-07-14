import { decisionValue } from "./intake.js"

/**
 * Product Brief (PRD42 S42.1) — artefato estruturado derivado do intake. Cada ACEITE aponta um
 * verificador REAL (`verifier`) ou é marcado `pending_verifier` com motivo — NUNCA um aceite que
 * finge estar coberto. Aceites de infraestrutura (scaffold/QG/lint) têm gate real hoje; aceites
 * de FEATURE (login funciona, pagamento processa) ficam pending até a conformance (S42.4) / E2E
 * (S42.13). É o "brief vivo" que alimenta o pipeline e o closeout (S42.10).
 */
export const PRODUCT_BRIEF_SCHEMA = "gstack.product-brief.v1"

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

/**
 * Monta o brief a partir do resultado de `runIntake`. Retorna { schema, objective, projectName,
 * mode, decisions, acceptances }. Lança se algum aceite ficar desonesto (defesa em profundidade).
 */
export function buildProductBrief(intake) {
  const { objective, recipe, decisions } = intake
  const integrations = decisionValue(decisions, "integrations") || []
  const acceptances = buildAcceptances(recipe, integrations)
  const dishonest = acceptances.filter((a) => !acceptanceIsHonest(a))
  if (dishonest.length) throw new Error(`product-brief: aceite desonesto (${dishonest.map((a) => a.id).join(",")})`)
  return {
    schema: PRODUCT_BRIEF_SCHEMA,
    objective,
    projectName: decisionValue(decisions, "projectName"),
    mode: decisionValue(decisions, "mode"),
    recipe: recipe.id,
    decisions,
    acceptances,
  }
}

/** Conta aceites cobertos vs pendentes (para o scorecard honesto do closeout). */
export function acceptanceCoverage(brief) {
  const verified = brief.acceptances.filter((a) => a.verifier).length
  return { total: brief.acceptances.length, withVerifier: verified, pending: brief.acceptances.length - verified }
}
