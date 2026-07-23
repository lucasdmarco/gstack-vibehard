import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const fixture = (name) => JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "impeccable", name), "utf-8")).elements

/**
 * PRD49 S49.2B — detector nativo de design, mas honesto quanto ao escopo: só a
 * ÚNICA regra vendorizada até agora (WCAG color-contrast, S49.2A) roda de
 * verdade. Nenhuma regra de typography/spacing/motion/etc. é fabricada aqui —
 * elas continuam `not_yet_vendored` no registry até serem portadas.
 */

test("design-rule-registry: 1 regra ACTIVE (color-contrast), resto not_yet_vendored com motivo", async () => {
  const { buildDesignRuleRegistry, getDesignRule, listActiveDesignRules } = await import("../src/skills/design-rule-registry.js")
  const registry = buildDesignRuleRegistry()
  assert.equal(registry.schemaVersion, "gstack.design-rule-registry.v1")
  const active = listActiveDesignRules()
  assert.equal(active.length, 1)
  assert.equal(active[0].ruleId, "impeccable-color-contrast-wcag")
  assert.equal(active[0].vendoredFrom, "src/vendor/impeccable/shared/color.mjs")
  const notYetVendored = registry.rules.filter((r) => r.status === "not_yet_vendored")
  assert.ok(notYetVendored.length >= 5, "backlog honesto de regras ainda não vendorizadas")
  for (const r of notYetVendored) assert.ok(r.reason, `${r.ruleId} precisa de motivo de adiamento`)
  assert.equal(getDesignRule("does-not-exist"), null)
})

test("detectColorContrastFindings: contraste insuficiente vira finding determinístico", async () => {
  const { detectColorContrastFindings } = await import("../src/skills/design-detector.js")
  const result = detectColorContrastFindings(fixture("elements-fail.json"))
  assert.equal(result.schemaVersion, "gstack.design-detector.v1")
  assert.equal(result.findings.length, 1)
  const f = result.findings[0]
  assert.equal(f.ruleId, "impeccable-color-contrast-wcag")
  assert.equal(f.selector, ".hero-subtitle")
  assert.equal(f.blocking, false, "S49.2B nunca bloqueia — só 1 regra vendorizada ainda")
  assert.equal(f.deterministic, true)
  assert.ok(f.ratio < 4.5)
  assert.equal(f.threshold, 4.5)
})

test("detectColorContrastFindings: contraste alto (normal e texto grande) -> zero findings", async () => {
  const { detectColorContrastFindings } = await import("../src/skills/design-detector.js")
  const result = detectColorContrastFindings(fixture("elements-pass.json"))
  assert.equal(result.findings.length, 0)
  assert.equal(result.counts.checked, 2)
})

test("detectColorContrastFindings: cor não-parseável (var()/token) -> skipped, NUNCA finding fabricado", async () => {
  const { detectColorContrastFindings } = await import("../src/skills/design-detector.js")
  const result = detectColorContrastFindings(fixture("elements-mixed.json"))
  assert.equal(result.findings.length, 1, "só o par realmente parseável e ruim vira finding")
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].selector, ".themed-label")
  assert.equal(result.skipped[0].reason, "unparseable_color")
})

test("detectColorContrastFindings: texto grande (>=18px ou >=14px+bold) usa threshold 3:1, não 4.5:1", async () => {
  const { detectColorContrastFindings } = await import("../src/skills/design-detector.js")
  // ratio ~1.28 (777/666) reprova em QUALQUER threshold -- prova o threshold certo com
  // um par especificamente escolhido para passar em 3:1 mas falhar em 4.5:1.
  const elements = [{ selector: ".large-borderline", color: "#949494", backgroundColor: "#ffffff", fontSize: 24, fontWeight: 400 }]
  const result = detectColorContrastFindings(elements)
  assert.equal(result.findings.length, 0, "texto grande com ratio >=3:1 passa mesmo abaixo de 4.5:1")
})

test("detectColorContrastFindings: mesmo par de elementos -> mesmo resultado (determinístico)", async () => {
  const { detectColorContrastFindings } = await import("../src/skills/design-detector.js")
  const els = fixture("elements-fail.json")
  const r1 = detectColorContrastFindings(els)
  const r2 = detectColorContrastFindings(els)
  assert.deepEqual(r1.findings, r2.findings)
})

test("detectColorContrastFindings: sem elementos -> zero findings, zero skipped (nunca lança)", async () => {
  const { detectColorContrastFindings } = await import("../src/skills/design-detector.js")
  const result = detectColorContrastFindings([])
  assert.equal(result.findings.length, 0)
  assert.equal(result.skipped.length, 0)
  assert.equal(result.counts.checked, 0)
})

// --- CLI: `visual doctor|detect|explain` (PRD49 S49.2B) ---
async function captureStdout(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await fn() } finally { process.stdout.write = orig }
  return out.trim().split("\n").pop()
}

test("CLI visual doctor --json: reporta 1 regra ativa e o backlog honesto", async () => {
  const { visualCommand } = await import("../src/commands/visual.js")
  const out = await captureStdout(() => visualCommand(["doctor", "--json"], { cwd: repoRoot }))
  const parsed = JSON.parse(out)
  assert.equal(parsed.counts.active, 1)
  assert.ok(parsed.counts.notYetVendored >= 5)
  assert.deepEqual(parsed.activeRules, ["impeccable-color-contrast-wcag"])
})

test("CLI visual detect <fixture> --json: acha o par de baixo contraste", async () => {
  const { visualCommand } = await import("../src/commands/visual.js")
  const target = path.join("tests", "fixtures", "impeccable", "elements-fail.json")
  const out = await captureStdout(() => visualCommand(["detect", target, "--json"], { cwd: repoRoot }))
  const parsed = JSON.parse(out)
  assert.equal(parsed.findings.length, 1)
  assert.equal(parsed.feedback.schemaVersion, "gstack.design-feedback.v1")
})

test("CLI visual detect sem caminho -> erro honesto, nunca crasha", async () => {
  const { visualCommand } = await import("../src/commands/visual.js")
  const prevExit = process.exitCode
  process.exitCode = 0
  await visualCommand(["detect", "--json"], { cwd: repoRoot })
  assert.equal(process.exitCode, 1)
  process.exitCode = prevExit
})

test("CLI visual explain <rule-id> --json: regra ativa e regra not_yet_vendored", async () => {
  const { visualCommand } = await import("../src/commands/visual.js")
  const active = JSON.parse(await captureStdout(() => visualCommand(["explain", "impeccable-color-contrast-wcag", "--json"], { cwd: repoRoot })))
  assert.equal(active.status, "active")
  const pending = JSON.parse(await captureStdout(() => visualCommand(["explain", "impeccable-typography-scale", "--json"], { cwd: repoRoot })))
  assert.equal(pending.status, "not_yet_vendored")
  assert.ok(pending.reason)
})
