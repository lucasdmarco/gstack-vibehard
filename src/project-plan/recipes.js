/**
 * Recipes MVP: mapeiam INTENÇÃO do usuário → template real + passos reais.
 *
 * Invariante de produção (nada fictício):
 *  - `template` é SEMPRE um dos 4 templates reais do `create`
 *    (fullstack-monorepo | saas-auth-stripe | mobile-backend | ai-agent-platform).
 *  - `suggestedIntegrations` reusa a fonte de verdade `SUGGESTIONS_BY_TEMPLATE`
 *    (printing-press/registry) — ids reais de tools.
 *  - Passos são step-ids resolvidos pelo planner para comandos reais, incluindo
 *    `runtime:start` → `gstack_vibehard dev`; só dashboard/deploy seguem pendingFeature.
 */
import { SUGGESTIONS_BY_TEMPLATE } from "../printing-press/registry.js"

const REAL_TEMPLATES = ["fullstack-monorepo", "saas-auth-stripe", "mobile-backend", "ai-agent-platform"]

// Passos comuns a todo projeto novo (todos mapeiam para comandos reais).
const BASE_REQUIRED = ["doctor", "create", "context:init", "context:index", "tools:suggested"]

function integrationsFor(template) {
  return [...(SUGGESTIONS_BY_TEMPLATE[template] || SUGGESTIONS_BY_TEMPLATE["fullstack-monorepo"])]
}

/** Define uma recipe garantindo template real e integrações reais. */
function recipe(def) {
  if (!REAL_TEMPLATES.includes(def.template)) {
    throw new Error(`recipe ${def.id}: template inexistente ${def.template}`)
  }
  return {
    id: def.id,
    label: def.label,
    intentKeywords: def.intentKeywords,
    template: def.template,
    recommendedMode: def.recommendedMode,
    modeReasons: def.modeReasons || [],
    requiredSteps: def.requiredSteps || BASE_REQUIRED,
    optionalSteps: def.optionalSteps || [],
    suggestedIntegrations: def.suggestedIntegrations || integrationsFor(def.template),
  }
}

export const RECIPES = [
  recipe({
    id: "saas-auth-stripe",
    label: "SaaS com login e pagamento",
    intentKeywords: ["saas", "assinatura", "subscription", "stripe", "login", "pagamento", "billing", "cobranca"],
    template: "saas-auth-stripe",
    recommendedMode: "full",
    modeReasons: ["login + pagamento + produto real exigem governança e quality gates"],
    optionalSteps: ["tools:install:stripe", "tools:mcp:enable:stripe", "runtime:start", "deploy:preview"],
  }),
  recipe({
    id: "mobile-backend",
    label: "App mobile com backend",
    // "app" sozinho é greedy demais (rouba "web app"); mobile casa por mobile/ios/android/aplicativo.
    intentKeywords: ["mobile", "ios", "android", "expo", "react native", "aplicativo", "celular"],
    template: "mobile-backend",
    recommendedMode: "lite",
    modeReasons: ["MVP mobile valida rápido em modo leve"],
    optionalSteps: ["tools:install:firebase", "runtime:start"],
  }),
  recipe({
    id: "ai-agent-platform",
    label: "Plataforma de agentes de IA",
    intentKeywords: ["ia", "ai", "agente", "agent", "llm", "rag", "chatbot", "inteligencia artificial"],
    template: "ai-agent-platform",
    recommendedMode: "full",
    modeReasons: ["agentes em paralelo pedem isolamento, memória e MCP completo"],
    optionalSteps: ["tools:install:github", "runtime:start"],
  }),
  recipe({
    id: "web-app",
    label: "Web app fullstack",
    intentKeywords: ["web", "site", "fullstack", "dashboard", "painel", "crud", "webapp"],
    template: "fullstack-monorepo",
    recommendedMode: "lite",
    modeReasons: ["web app comum começa leve e cresce sob demanda"],
    optionalSteps: ["runtime:start", "deploy:preview"],
  }),
  recipe({
    id: "api-only",
    label: "API/backend",
    intentKeywords: ["api", "backend", "rest", "graphql", "microservico", "microservice", "servico"],
    template: "fullstack-monorepo",
    recommendedMode: "lite",
    modeReasons: ["API isolada não precisa de governança pesada no início"],
    optionalSteps: ["runtime:start"],
  }),
  recipe({
    id: "landing-page",
    label: "Landing page",
    intentKeywords: ["landing", "marketing", "institucional", "vitrine", "pagina"],
    template: "fullstack-monorepo",
    recommendedMode: "lite",
    modeReasons: ["landing é simples; modo leve evita setup desnecessário"],
    optionalSteps: [],
  }),
  recipe({
    id: "internal-tool",
    label: "Ferramenta interna",
    intentKeywords: ["interno", "internal", "admin", "ferramenta", "tool", "back office", "backoffice"],
    template: "fullstack-monorepo",
    recommendedMode: "full",
    modeReasons: ["ferramenta interna se beneficia de governança e auditoria"],
    optionalSteps: ["runtime:start"],
  }),
]

export const DEFAULT_RECIPE_ID = "web-app"

export function getRecipe(id) {
  return RECIPES.find((r) => r.id === id) || null
}
