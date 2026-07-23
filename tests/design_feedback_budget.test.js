import test from "node:test"
import assert from "node:assert/strict"

/**
 * PRD49 S49.2B — feedback compacto: saída SEMPRE limitada (bounded output),
 * sempre deduplicada por regra+seletor. Nunca despeja um relatório ilimitado.
 */

const makeFinding = (n) => ({
  ruleId: "impeccable-color-contrast-wcag", selector: `.item-${n}`, severity: "P2",
  ratio: 2.0, threshold: 4.5,
})

test("renderCompactFeedback: limita a maxItems, reporta remaining honesto", async () => {
  const { renderCompactFeedback } = await import("../src/skills/design-feedback.js")
  const findings = Array.from({ length: 15 }, (_, i) => makeFinding(i))
  const feedback = renderCompactFeedback(findings, { maxItems: 10 })
  assert.equal(feedback.schemaVersion, "gstack.design-feedback.v1")
  assert.equal(feedback.total, 15)
  assert.equal(feedback.shown, 10)
  assert.equal(feedback.remaining, 5)
  assert.equal(feedback.lines.length, 10)
})

test("renderCompactFeedback: dedupe por ruleId+selector -- mesmo achado repetido conta 1x", async () => {
  const { renderCompactFeedback } = await import("../src/skills/design-feedback.js")
  const dup = makeFinding(1)
  const feedback = renderCompactFeedback([dup, { ...dup }, makeFinding(2)])
  assert.equal(feedback.total, 2)
})

test("renderCompactFeedback: default maxItems nunca deixa a saída ilimitada mesmo sem opts", async () => {
  const { renderCompactFeedback } = await import("../src/skills/design-feedback.js")
  const findings = Array.from({ length: 100 }, (_, i) => makeFinding(i))
  const feedback = renderCompactFeedback(findings)
  assert.ok(feedback.shown < 100, "output sempre bounded por default")
  assert.equal(feedback.shown + feedback.remaining, 100)
})

test("renderCompactFeedback: sem findings -> zero shown/remaining, nunca lança", async () => {
  const { renderCompactFeedback } = await import("../src/skills/design-feedback.js")
  const feedback = renderCompactFeedback([])
  assert.equal(feedback.total, 0)
  assert.equal(feedback.shown, 0)
  assert.equal(feedback.remaining, 0)
})

test("renderFeedbackMarkdown: lista os achados mostrados e anuncia o restante quando houver", async () => {
  const { renderCompactFeedback, renderFeedbackMarkdown } = await import("../src/skills/design-feedback.js")
  const findings = Array.from({ length: 12 }, (_, i) => makeFinding(i))
  const feedback = renderCompactFeedback(findings, { maxItems: 10 })
  const md = renderFeedbackMarkdown(feedback)
  assert.match(md, /2 achado/)
  assert.equal(md.split("\n").filter((l) => l.startsWith("- ") && l.includes(".item")).length, 10)
})
