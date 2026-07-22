import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.5 — usage accounting: `unknown` NUNCA vira 0 nem ilimitado; estimativa NUNCA
// vira "economia comprovada" sem benchmark A/B real.

test("usageValue: quality fora do enum tipado -> lança", async () => {
  const { usageValue } = await imp("src/usage/accounting.js")
  assert.throws(() => usageValue(10, "chutado"), /quality de uso inválida/)
})

test("usageValue: quality 'unknown' NUNCA carrega um número — value é sempre null (DoD)", async () => {
  const { usageValue } = await imp("src/usage/accounting.js")
  assert.equal(usageValue(999, "unknown").value, null)
  assert.equal(usageValue(0, "unknown").value, null)
})

test("estimateTokenUsage: SEMPRE quality:'estimated' — nunca apresentado como medido", async () => {
  const { estimateTokenUsage } = await imp("src/usage/accounting.js")
  const r = estimateTokenUsage("x".repeat(400))
  assert.equal(r.quality, "estimated")
  assert.equal(r.value, 100)
})

test("providerReportedUsage: valor real da API -> provider_reported; ausente -> unknown (nunca inventa)", async () => {
  const { providerReportedUsage } = await imp("src/usage/accounting.js")
  assert.equal(providerReportedUsage(500).quality, "provider_reported")
  assert.equal(providerReportedUsage(500).value, 500)
  assert.equal(providerReportedUsage(undefined).quality, "unknown")
  assert.equal(providerReportedUsage(undefined).value, null)
})

test("buildSessionSummary: contrato exato do PRD48 §7.5 — todos os 5 campos tipados", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const r = buildSessionSummary({ inputTokens: 12000, outputTokens: 2500, contextPackBytes: 2000, fullBytes: 10000, quota: {} })
  assert.equal(r.inputTokens.value, 12000)
  assert.equal(r.inputTokens.quality, "provider_reported")
  assert.equal(r.outputTokens.value, 2500)
  assert.equal(r.contextAvoided.quality, "estimated")
  assert.equal(r.contextAvoided.value, 8000)
  assert.equal(r.quota.quality, "unknown")
  assert.equal(r.quota.available, null)
  assert.equal(r.parallelRecommendation, "ask_user", "quota unknown -> nunca paraleliza sozinho")
})

test("buildSessionSummary: sem inputTokens/outputTokens informados -> unknown, NUNCA 0 (DoD)", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const r = buildSessionSummary({})
  assert.equal(r.inputTokens.quality, "unknown")
  assert.equal(r.inputTokens.value, null)
  assert.notEqual(r.inputTokens.value, 0)
})

test("buildSessionSummary: quota SUFICIENTE e numérica -> parallelRecommendation reflete isso, nunca some", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const r = buildSessionSummary({ quota: { available: 10, needed: 2 } })
  assert.equal(r.quota.quality, "provider_reported")
  assert.equal(r.quota.available, 10)
  assert.equal(r.parallelRecommendation, "parallel_ok")
})

test("buildSessionSummary: sem contextPackBytes/fullBytes -> contextAvoided fica unknown, nunca estimativa inventada", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const r = buildSessionSummary({})
  assert.equal(r.contextAvoided.quality, "unknown")
  assert.equal(r.contextAvoided.value, null)
})
