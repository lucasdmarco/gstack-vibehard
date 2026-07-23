import { parseRgb, contrastRatio } from "../vendor/impeccable/shared/color.mjs"
import { getDesignRule } from "./design-rule-registry.js"

/**
 * Native design detector (PRD49 S49.2B).
 *
 * Conecta o único primitivo real vendorizado até agora (`color.mjs`, S49.2A)
 * a um finding determinístico no formato GStack. Escopo honesto: só detecta
 * contraste WCAG insuficiente entre texto e fundo — nenhuma outra categoria
 * de regra (typography/spacing/motion/...) é fabricada aqui (ver
 * design-rule-registry.js). Entrada é uma lista de elementos JÁ EXTRAÍDOS
 * (selector/color/backgroundColor/fontSize/fontWeight) — não há scraping de
 * DOM/URL ao vivo nesta sprint (isso depende de
 * `browser/injected/index.mjs`, ainda não vendorizado).
 */
export const DESIGN_DETECTOR_SCHEMA = "gstack.design-detector.v1"

const WCAG_AA_NORMAL = 4.5
const WCAG_AA_LARGE = 3.0
const CONTRAST_RULE_ID = "impeccable-color-contrast-wcag"

function isLargeText({ fontSize = 0, fontWeight = 400 } = {}) {
  return fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700)
}

function normalizeToRgbString(color) {
  if (typeof color !== "string") return null
  const hex6 = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex6) {
    const h = hex6[1]
    return `rgb(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)})`
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(color)
  if (hex3) {
    const [r, g, b] = hex3[1].split("").map((c) => c + c)
    return `rgb(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)})`
  }
  return color
}

/** Um elemento vira finding, skip (cor não-parseável) ou passa silenciosamente (contraste ok). */
function evaluateElement(el) {
  const fg = parseRgb(normalizeToRgbString(el.color))
  const bg = parseRgb(normalizeToRgbString(el.backgroundColor))
  if (!fg || !bg) return { skipped: { selector: el.selector, reason: "unparseable_color" } }
  const ratio = contrastRatio(fg, bg)
  const threshold = isLargeText(el) ? WCAG_AA_LARGE : WCAG_AA_NORMAL
  if (ratio >= threshold) return {}
  const rule = getDesignRule(CONTRAST_RULE_ID)
  return {
    finding: {
      ruleId: CONTRAST_RULE_ID,
      category: rule.category,
      selector: el.selector,
      severity: rule.severityDefault,
      confidence: "high",
      deterministic: true,
      blocking: false,
      ratio: Math.round(ratio * 100) / 100,
      threshold,
      evidence: { color: el.color, backgroundColor: el.backgroundColor },
      remediation: `Aumente o contraste entre texto (${el.color}) e fundo (${el.backgroundColor}) para pelo menos ${threshold}:1.`,
    },
  }
}

/** Detecta findings de contraste WCAG numa lista de elementos já extraídos. PURO, nunca lança. */
export function detectColorContrastFindings(elements = []) {
  const findings = []
  const skipped = []
  for (const el of elements) {
    const r = evaluateElement(el)
    if (r.finding) findings.push(r.finding)
    else if (r.skipped) skipped.push(r.skipped)
  }
  return {
    schemaVersion: DESIGN_DETECTOR_SCHEMA,
    engine: { source: "impeccable", vendoredFrom: "src/vendor/impeccable/shared/color.mjs" },
    findings,
    skipped,
    counts: { checked: elements.length, findings: findings.length, skipped: skipped.length },
  }
}
