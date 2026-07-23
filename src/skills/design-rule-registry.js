/**
 * Design Rule Registry (PRD49 S49.2B).
 *
 * Fonte única de verdade sobre QUAIS regras de design nativo estão realmente
 * ativas hoje. Só 1 regra vendorizada até agora (S49.2A: `shared/color.mjs`,
 * WCAG color-contrast) — `status:"active"`. Todas as outras categorias do
 * motor Impeccable (typography/spacing/radius/responsive/motion/design-system/
 * mechanical anti-patterns) permanecem `not_yet_vendored` com o motivo real
 * (arquivo upstream + linhas), citando o backlog honesto de
 * `src/vendor/impeccable/upstream-map.md`. NUNCA declarar uma regra `active`
 * sem código vendorizado real por trás dela.
 */
export const DESIGN_RULE_REGISTRY_SCHEMA = "gstack.design-rule-registry.v1"

export const DESIGN_RULES = Object.freeze([
  {
    ruleId: "impeccable-color-contrast-wcag", source: "impeccable", category: "color-contrast",
    status: "active", severityDefault: "P2", deterministic: true,
    vendoredFrom: "src/vendor/impeccable/shared/color.mjs",
    description: "Contraste WCAG 2.1 AA entre texto e fundo — 4.5:1 (texto normal) ou 3:1 (texto grande).",
  },
  {
    ruleId: "impeccable-typography-scale", source: "impeccable", category: "typography",
    status: "not_yet_vendored",
    reason: "cli/engine/rules/checks.mjs (2703 linhas, ver upstream-map.md) ainda não vendorizado.",
  },
  {
    ruleId: "impeccable-spacing-consistency", source: "impeccable", category: "spacing",
    status: "not_yet_vendored",
    reason: "cli/engine/rules/checks.mjs (2703 linhas, ver upstream-map.md) ainda não vendorizado.",
  },
  {
    ruleId: "impeccable-radius-consistency", source: "impeccable", category: "radius",
    status: "not_yet_vendored",
    reason: "cli/engine/rules/checks.mjs (2703 linhas, ver upstream-map.md) ainda não vendorizado.",
  },
  {
    ruleId: "impeccable-responsive-layout", source: "impeccable", category: "responsive",
    status: "not_yet_vendored",
    reason: "cli/engine/engines/static-html/css-cascade.mjs (1015 linhas, ver upstream-map.md) ainda não vendorizado.",
  },
  {
    ruleId: "impeccable-motion-consistency", source: "impeccable", category: "motion",
    status: "not_yet_vendored",
    reason: "cli/engine/rules/checks.mjs (2703 linhas, ver upstream-map.md) ainda não vendorizado.",
  },
  {
    ruleId: "impeccable-design-system-consistency", source: "impeccable", category: "design-system",
    status: "not_yet_vendored",
    reason: "cli/engine/design-system.mjs (921 linhas, ver upstream-map.md) ainda não vendorizado.",
  },
  {
    ruleId: "impeccable-mechanical-antipatterns", source: "impeccable", category: "antipattern",
    status: "not_yet_vendored",
    reason: "cli/engine/detect-antipatterns-browser.js (5245 linhas) + registry/antipatterns.mjs (514 linhas), ver upstream-map.md.",
  },
])

export function getDesignRule(ruleId) {
  return DESIGN_RULES.find((r) => r.ruleId === ruleId) || null
}

export function listActiveDesignRules() {
  return DESIGN_RULES.filter((r) => r.status === "active")
}

export function buildDesignRuleRegistry(rules = DESIGN_RULES) {
  return {
    schemaVersion: DESIGN_RULE_REGISTRY_SCHEMA,
    rules: [...rules],
    counts: {
      active: rules.filter((r) => r.status === "active").length,
      notYetVendored: rules.filter((r) => r.status === "not_yet_vendored").length,
    },
  }
}
