import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.7 — Scroll World: orçamento de mídia. Reusa `costGateStatus` de
 * `vendor-governance.js` (S49.0) — `--yes` NUNCA confirma gasto, mesma
 * invariante testada desde o controle 4 do S49.0. Caps de iteração e
 * provider único por chain são regras NOVAS desta sprint.
 */

test("estimateMediaCost: aritmética determinística still/video", async () => {
  const { estimateMediaCost } = await imp("src/capabilities/media-budget.js")
  const c = estimateMediaCost({ stillCount: 4, videoCount: 2, stillUnitCost: 0.5, videoUnitCost: 3 })
  assert.equal(c, 4 * 0.5 + 2 * 3)
})

test("CONTROLE NEGATIVO: --yes NUNCA confirma gasto (reusa costGateStatus de vendor-governance.js)", async () => {
  const { canProceedWithMediaSpend } = await imp("src/capabilities/media-budget.js")
  assert.equal(canProceedWithMediaSpend({ estimatedCost: 10, confirmed: false, yes: true }), "blocked")
  assert.equal(canProceedWithMediaSpend({ estimatedCost: 10, confirmed: true, yes: false }), "ok")
  assert.equal(canProceedWithMediaSpend({ estimatedCost: 0, confirmed: false, yes: false }), "ok", "sem custo, nada a confirmar")
})

test("enforceIterationCap: respeita cap fixo, nunca deixa rodar acima do limite", async () => {
  const { enforceIterationCap } = await imp("src/capabilities/media-budget.js")
  assert.equal(enforceIterationCap({ attempted: 3, cap: 5 }).ok, true)
  const over = enforceIterationCap({ attempted: 6, cap: 5 })
  assert.equal(over.ok, false)
  assert.equal(over.reason, "iteration_cap_exceeded")
})

test("oneProviderPerChain: mesmo provider/model -> ok; providers diferentes SEM recovery documentado -> blocked", async () => {
  const { oneProviderPerChain } = await imp("src/capabilities/media-budget.js")
  assert.equal(oneProviderPerChain({ chainProviders: ["stub-provider"], documentedRecovery: false }).ok, true)
  const mixed = oneProviderPerChain({ chainProviders: ["stub-provider", "other-provider"], documentedRecovery: false })
  assert.equal(mixed.ok, false)
  assert.equal(mixed.reason, "multiple_providers_without_documented_recovery")
})

test("oneProviderPerChain: providers diferentes COM recovery documentado -> ok (exceção explícita)", async () => {
  const { oneProviderPerChain } = await imp("src/capabilities/media-budget.js")
  assert.equal(oneProviderPerChain({ chainProviders: ["stub-provider", "other-provider"], documentedRecovery: true }).ok, true)
})

test("buildMediaManifestEntry: registra provider/promptHash/model/source/license/dimensions/fileHash", async () => {
  const { buildMediaManifestEntry } = await imp("src/capabilities/media-budget.js")
  const entry = buildMediaManifestEntry({
    provider: "stub-provider", prompt: "a red circle", model: "stub-model-v1",
    source: "generated", licenseNote: "output license per provider ToS",
    dimensions: { width: 512, height: 512 }, fileContent: Buffer.from("fake-image-bytes"),
  })
  assert.equal(entry.provider, "stub-provider")
  assert.equal(entry.model, "stub-model-v1")
  assert.ok(entry.promptHash.startsWith("sha256:"))
  assert.ok(entry.fileHash.startsWith("sha256:"))
  assert.deepEqual(entry.dimensions, { width: 512, height: 512 })
})
