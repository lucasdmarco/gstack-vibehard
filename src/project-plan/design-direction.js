/**
 * PRD47 S47.2 — Design Direction guiada: quando não há design system, propõe
 * direções DERIVADAS do tipo de produto para eliminar a ambiguidade "escreva
 * algo" antes do frontend começar. Só rotula opções e tokens MÍNIMOS
 * verificáveis — gerar arte/paleta completa é escopo do PRD49, não daqui.
 */
// Tokens MÍNIMOS mas VERIFICÁVEIS (DoD) — precisam satisfazer validateDesignContent()
// do design-system.js (colors/typography não podem ficar vazios) se alguém decidir
// registrar a direção escolhida como design system de verdade (designSystemFromDirection).
export const DESIGN_DIRECTION_CATALOG = Object.freeze([
  { value: "minimal-editorial", label: "Minimalista editorial", tokens: { style: "minimal", weight: "light", colors: { fg: "#111111", bg: "#ffffff" }, typography: { body: "Inter" } } },
  { value: "bold-vibrant", label: "Vibrante e ousado", tokens: { style: "bold", weight: "heavy", colors: { primary: "#ff3366", bg: "#0a0a0a" }, typography: { body: "Poppins" } } },
  { value: "corporate-clean", label: "Corporativo limpo", tokens: { style: "corporate", weight: "medium", colors: { primary: "#1a56db", bg: "#f8fafc" }, typography: { body: "Roboto" } } },
  { value: "dark-technical", label: "Escuro e técnico", tokens: { style: "dark", weight: "medium", colors: { primary: "#00d9ff", bg: "#0d1117" }, typography: { body: "JetBrains Mono" } } },
])

export const DESIGN_DIRECTION_CUSTOM = "custom"
export const DESIGN_DIRECTION_OPT_OUT = "none"

/** Opções apresentadas ao usuário: catálogo derivado + personalizado + opt-out explícito. */
export function proposeDesignDirections() {
  return [
    ...DESIGN_DIRECTION_CATALOG.map((d) => ({ value: d.value, label: d.label })),
    { value: DESIGN_DIRECTION_CUSTOM, label: "Personalizado (vou definir depois)" },
    { value: DESIGN_DIRECTION_OPT_OUT, label: "Nenhuma agora (opt-out explícito)" },
  ]
}

/** Tokens mínimos verificáveis da direção do catálogo (null p/ custom/opt-out — nada a verificar). */
export function tokensForDirection(value) {
  const d = DESIGN_DIRECTION_CATALOG.find((x) => x.value === value)
  return d ? d.tokens : null
}

/** Uma direção é uma decisão HONESTA quando é do catálogo, custom ou opt-out — nunca vazia/ambígua. */
export function isDirectionResolved(value) {
  return value === DESIGN_DIRECTION_CUSTOM || value === DESIGN_DIRECTION_OPT_OUT
    || DESIGN_DIRECTION_CATALOG.some((d) => d.value === value)
}
