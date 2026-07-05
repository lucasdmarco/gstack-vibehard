import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const registryPath = path.join(repoRoot, ".docs", "RESEARCH", "repository-registry.json")

function loadRegistry() {
  return JSON.parse(readFileSync(registryPath, "utf-8"))
}

const AIDD_THEMES = ["cross-harness", "skills", "onboarding", "methodology", "market-comparison"]
const EXPECTED_REPOS = [
  { url: "https://github.com/lgsreal/ai-driven-dev", status: "active_reference", role: "learning_track" },
  { url: "https://github.com/ai-driven-dev/framework", status: "active_reference", role: "plugin_marketplace_and_sdlc" },
  { url: "https://github.com/ai-driven-dev/manifest", status: "active_reference", role: "product_manifesto" },
  { url: "https://github.com/ai-driven-dev/prompts", status: "archived_reference", role: "prompt_template_history" },
  { url: "https://github.com/ai-driven-dev/rules", status: "archived_reference", role: "short_rules_history" },
  { url: "https://github.com/ai-driven-dev/ai-driven-dev-community", status: "archived_reference", role: "community_catalog_history" },
]

test("registry: schema v1 com batch AIDD obrigatório (PRD21 §4.1)", () => {
  const reg = loadRegistry()
  assert.equal(reg.schemaVersion, 1)
  assert.ok(Array.isArray(reg.mandatoryBatches) && reg.mandatoryBatches.length >= 1)
  const aidd = reg.mandatoryBatches.find((b) => b.id === "batch-6-aidd-methodology")
  assert.ok(aidd, "batch-6-aidd-methodology presente")
  for (const theme of AIDD_THEMES) {
    assert.ok(aidd.mandatoryFor.includes(theme), `mandatoryFor cobre '${theme}'`)
  }
})

test("registry: os 6 repos AIDD com status e role corretos", () => {
  const aidd = loadRegistry().mandatoryBatches.find((b) => b.id === "batch-6-aidd-methodology")
  assert.equal(aidd.repos.length, 6, "exatamente 6 repos")
  for (const expected of EXPECTED_REPOS) {
    const got = aidd.repos.find((r) => r.url === expected.url)
    assert.ok(got, `repo ${expected.url} presente`)
    assert.equal(got.status, expected.status, `${expected.url} status`)
    assert.equal(got.role, expected.role, `${expected.url} role`)
  }
})

test("registry: status usa apenas active_reference|archived_reference", () => {
  const aidd = loadRegistry().mandatoryBatches.find((b) => b.id === "batch-6-aidd-methodology")
  const allowed = new Set(["active_reference", "archived_reference"])
  for (const r of aidd.repos) {
    assert.ok(allowed.has(r.status), `status válido em ${r.url}`)
  }
  // lgsreal é a trilha de aprendizado viva
  const lgs = aidd.repos.find((r) => r.url.includes("lgsreal"))
  assert.equal(lgs.status, "active_reference")
  assert.equal(lgs.role, "learning_track")
})
