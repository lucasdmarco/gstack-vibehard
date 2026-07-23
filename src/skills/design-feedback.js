/**
 * Compact design feedback (PRD49 S49.2B).
 *
 * Transforma findings do detector nativo em saída SEMPRE limitada
 * (bounded output) e deduplicada por regra+seletor — nunca despeja um
 * relatório ilimitado no terminal.
 */
export const DESIGN_FEEDBACK_SCHEMA = "gstack.design-feedback.v1"

const DEFAULT_MAX_ITEMS = 10

function dedupeFindings(findings) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    const key = `${f.ruleId}::${f.selector}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

const lineFor = (f) => `[${f.severity}] ${f.ruleId} @ ${f.selector} — ratio ${f.ratio}:1 (mín ${f.threshold}:1)`

/** `findings` = saída de detectColorContrastFindings().findings. PURO. */
export function renderCompactFeedback(findings = [], { maxItems = DEFAULT_MAX_ITEMS } = {}) {
  const deduped = dedupeFindings(findings)
  const shown = deduped.slice(0, maxItems)
  return {
    schemaVersion: DESIGN_FEEDBACK_SCHEMA,
    total: deduped.length,
    shown: shown.length,
    remaining: Math.max(0, deduped.length - shown.length),
    lines: shown.map(lineFor),
  }
}

export function renderFeedbackMarkdown(feedback) {
  const lines = [`# Design feedback — ${feedback.total} achado(s)`, ""]
  for (const l of feedback.lines) lines.push(`- ${l}`)
  if (feedback.remaining > 0) lines.push(`- … e mais ${feedback.remaining} achado(s) (saída limitada de propósito)`)
  return lines.join("\n")
}
