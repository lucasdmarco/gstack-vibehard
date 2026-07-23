import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.8 — Claude Video spike: promovido a capacidade Full só se um
 * benchmark REAL provar melhora sobre a baseline Graphify/media, respeitando
 * budgets de token/cleanup. Sem benchmark = referência externa documentada,
 * NUNCA promovido por decreto.
 */

test("CLAUDE_VIDEO_CAPABILITY_STATUS: default é referência externa documentada, nunca promovida", async () => {
  const { CLAUDE_VIDEO_CAPABILITY_STATUS } = await imp("src/tools/claude-video.js")
  assert.equal(CLAUDE_VIDEO_CAPABILITY_STATUS, "documented_external_reference")
})

test("evaluatePromotionThreshold: sem benchmarkResult -> nunca promove", async () => {
  const { evaluatePromotionThreshold } = await imp("src/tools/claude-video.js")
  assert.equal(evaluatePromotionThreshold({}).status, "documented_external_reference")
  assert.equal(evaluatePromotionThreshold({ benchmarkResult: null }).status, "documented_external_reference")
})

test("evaluatePromotionThreshold: benchmark real mas SEM melhora sobre baseline -> continua referência", async () => {
  const { evaluatePromotionThreshold } = await imp("src/tools/claude-video.js")
  const r = evaluatePromotionThreshold({
    benchmarkResult: { claudeVideoAccuracy: 0.7, baselineAccuracy: 0.75, tokenBudgetOk: true, cleanupOk: true },
  })
  assert.equal(r.status, "documented_external_reference")
})

test("evaluatePromotionThreshold: melhora de acurácia MAS viola budget de token/cleanup -> continua referência", async () => {
  const { evaluatePromotionThreshold } = await imp("src/tools/claude-video.js")
  const r = evaluatePromotionThreshold({
    benchmarkResult: { claudeVideoAccuracy: 0.9, baselineAccuracy: 0.75, tokenBudgetOk: false, cleanupOk: true },
  })
  assert.equal(r.status, "documented_external_reference")
})

test("evaluatePromotionThreshold: melhora real + budgets respeitados -> promovido a Full", async () => {
  const { evaluatePromotionThreshold } = await imp("src/tools/claude-video.js")
  const r = evaluatePromotionThreshold({
    benchmarkResult: { claudeVideoAccuracy: 0.9, baselineAccuracy: 0.75, tokenBudgetOk: true, cleanupOk: true },
  })
  assert.equal(r.status, "promoted_full_capability")
})

test("CONTROLE NEGATIVO: esta sessão nunca injeta um benchmarkResult fabricado -- status real do módulo é sempre documented_external_reference hoje", async () => {
  const { claudeVideoCapabilityStatus } = await imp("src/tools/claude-video.js")
  assert.equal(claudeVideoCapabilityStatus(), "documented_external_reference", "nenhum benchmark real foi rodado nesta sessão")
})
