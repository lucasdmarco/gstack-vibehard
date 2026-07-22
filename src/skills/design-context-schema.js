/**
 * PRD49 S49.1 — schema puro do bridge de contexto de design. Classifica a superfície de
 * UI como `brand|product|mixed` durante o intake já existente (PRD47) — nunca decide
 * sozinho quando os sinais são ambíguos, e nunca default pra `brand` por omissão (uma
 * superfície não classificada é tratada como produto, o caminho mais rigoroso).
 */
export const DESIGN_CONTEXT_SCHEMA_SCHEMA = "gstack.design-context-schema.v1"
export const SURFACE_CLASSES = Object.freeze(["brand", "product", "mixed"])

/** brand = só marketing; product = só fluxo de produto; mixed = ambos; sem sinal -> product. */
export function classifySurface({ hasMarketingCopy = false, hasProductFlow = false } = {}) {
  if (hasMarketingCopy && hasProductFlow) return "mixed"
  if (hasMarketingCopy) return "brand"
  return "product"
}
