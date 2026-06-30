import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "agents", "adapter-matrix.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("ADAPTER_MATRIX: enforcement honesto por harness", async () => {
  const { getAdapterInfo } = await imp()
  assert.equal(getAdapterInfo("claude").enforcement, "real_hooks")
  assert.equal(getAdapterInfo("codex").enforcement, "partial")
  assert.equal(getAdapterInfo("cursor").enforcement, "rules_only")
  // ABUSO de honestidade: opencode é compat — NÃO pode reivindicar enforcement forte
  assert.equal(getAdapterInfo("opencode").enforcement, "rules_only")
  assert.equal(getAdapterInfo("copilot").enforcement, "instructional")
  assert.equal(getAdapterInfo("gemini").enforcement, "instructional")
  assert.equal(getAdapterInfo("kiro").enforcement, "detection_only")
})

test("isInstructional + sem rótulo Zero-Trust/strong", async () => {
  const { isInstructional, ENFORCEMENT_LEVELS } = await imp()
  assert.equal(isInstructional("copilot"), true)
  assert.equal(isInstructional("gemini"), true)
  assert.equal(isInstructional("windsurf"), true)
  assert.equal(isInstructional("claude"), false)
  assert.equal(isInstructional("codex"), false)
  // nenhum nível de enforcement é "zero-trust"/"strong" (termos enganosos do runtime)
  for (const bad of ["zero-trust", "zerotrust", "strong"]) assert.ok(!ENFORCEMENT_LEVELS.includes(bad))
})

test("generatedHarnesses: gera claude/codex/cursor/copilot/gemini; declara o resto", async () => {
  const { generatedHarnesses } = await imp()
  const g = generatedHarnesses()
  for (const id of ["claude", "codex", "cursor", "copilot", "gemini"]) assert.ok(g.includes(id), `${id} é gerado`)
  for (const id of ["opencode", "hermes", "windsurf", "kiro"]) assert.ok(!g.includes(id), `${id} é só declarado`)
})
