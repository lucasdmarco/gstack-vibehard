/**
 * Registry das DECISÕES de intake (PRD42 S42.1). No máximo 5 decisões BLOQUEANTES; cada uma
 * carrega `why` (por que importa) + `consequence` (o que muda conforme a escolha) + um default
 * recomendado. O que dá p/ derivar do objetivo (recipe/template/modo) NÃO vira pergunta cega:
 * entra como decisão com default já classificado, que o usuário confirma ou sobrescreve.
 *
 * PURO: sem I/O. `intake.js` injeta a UI e resolve; `product-brief.js` consome o resultado.
 */
export const MAX_BLOCKING_DECISIONS = 5

/** Extrai integrações opcionais reais do recipe (passos `tools:install:*`). */
export function integrationOptions(recipe) {
  const steps = (recipe && recipe.optionalSteps) || []
  return steps
    .filter((s) => s.startsWith("tools:install:"))
    .map((s) => s.slice("tools:install:".length))
}

/** Slug de projeto determinístico a partir do objetivo (default do nome). */
export function slugFromObjective(objective) {
  const slug = String(objective || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return slug || "meu-projeto"
}

/** Decisões base (ordem = ordem de pergunta). Defaults/opções dinâmicos vêm de `resolveDecision`. */
export const INTAKE_DECISIONS = Object.freeze([
  {
    id: "projectName",
    kind: "text",
    prompt: "Nome do projeto?",
    why: "Nomeia o diretório e o scaffold; entra em manifestos e provenance.",
    consequence: "Muda o caminho de criação e o identificador do projeto.",
  },
  {
    id: "mode",
    kind: "choice",
    prompt: "Modo do projeto?",
    why: "Lite entrega enxuto; Full liga Casdoor/Atomic/ECC/AgentMemory + quality gates.",
    consequence: "Full materializa backends e gates reais; Lite cresce sob demanda.",
    options: [{ value: "lite", label: "Leve" }, { value: "full", label: "Completo" }],
  },
  {
    id: "integrations",
    kind: "multi",
    prompt: "Provisionar as integrações opcionais recomendadas?",
    why: "Só provisiona o que o produto pede (ex.: stripe/firebase/github).",
    consequence: "Cada integração adiciona passos e dependências reais ao plano.",
  },
  {
    id: "deployTarget",
    kind: "choice",
    prompt: "Alvo de deploy inicial?",
    why: "Define se o closeout inclui preview + health pós-deploy.",
    consequence: "'none' mantém local; 'preview' agenda deploy verificável (S42.12).",
    options: [{ value: "none", label: "Nenhum (local)" }, { value: "preview", label: "Preview" }],
  },
])

const DEFAULTERS = {
  projectName: ({ objective }) => slugFromObjective(objective),
  mode: ({ recipe }) => (recipe && recipe.recommendedMode) || "lite",
  integrations: ({ recipe }) => integrationOptions(recipe),
  deployTarget: () => "none",
}

/**
 * Resolve default + opções concretas de UMA decisão a partir do contexto (objetivo + recipe).
 * Devolve `{ default, options }`. Para `integrations`, options = todas; default = recomendadas.
 */
export function resolveDecision(decision, ctx) {
  const def = (DEFAULTERS[decision.id] || (() => null))(ctx)
  if (decision.id === "integrations") {
    const all = integrationOptions(ctx.recipe).map((v) => ({ value: v, label: v }))
    return { default: def, options: all }
  }
  return { default: def, options: decision.options || null }
}

/** Lista de decisões bloqueantes (cap MAX). `integrations` some se o recipe não tem nenhuma. */
export function blockingDecisions(ctx) {
  const list = INTAKE_DECISIONS.filter((d) => d.id !== "integrations" || integrationOptions(ctx.recipe).length > 0)
  if (list.length > MAX_BLOCKING_DECISIONS) throw new Error(`intake: ${list.length} decisões excede o teto de ${MAX_BLOCKING_DECISIONS}`)
  return list
}
