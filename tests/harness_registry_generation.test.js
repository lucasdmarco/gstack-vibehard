import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("buildHarnessRegistry: une capabilities.js + adapter-matrix.js por id, sem inventar 3ª lista", async () => {
  const { buildHarnessRegistry } = await imp("src/dream/harness-registry.js")
  const r = buildHarnessRegistry()
  assert.equal(r.schemaVersion, "gstack.harness-registry.v1")
  assert.ok(r.harnesses.find((h) => h.id === "claude"))
  assert.ok(r.harnesses.length >= 14, "pelo menos todos os harnesses de capabilities.js")
})

test("buildHarnessRegistry: claude/cursor/opencode/codex estão CONSISTENTES nas duas fontes", async () => {
  const { buildHarnessRegistry } = await imp("src/dream/harness-registry.js")
  const r = buildHarnessRegistry()
  for (const id of ["claude", "cursor", "opencode", "codex"]) {
    const h = r.harnesses.find((x) => x.id === id)
    assert.equal(h.driftStatus, "consistent", id)
  }
})

test("buildHarnessRegistry: REGRESSÃO real — droid/kilocode/kimi/vscode/zed existem só em capabilities.js hoje", async () => {
  const { buildHarnessRegistry } = await imp("src/dream/harness-registry.js")
  const r = buildHarnessRegistry()
  for (const id of ["droid", "kilocode", "kimi", "vscode", "zed"]) {
    const h = r.harnesses.find((x) => x.id === id)
    assert.ok(h, `${id} presente na união`)
    assert.equal(h.driftStatus, "capabilities_only", `${id}: sem entrada em ADAPTER_MATRIX ainda — achado real, não silenciado`)
  }
})

test("buildHarnessRegistry: REGRESSÃO real — devin existe só em ADAPTER_MATRIX hoje (nunca em capabilities.js)", async () => {
  const { buildHarnessRegistry } = await imp("src/dream/harness-registry.js")
  const r = buildHarnessRegistry()
  const devin = r.harnesses.find((x) => x.id === "devin")
  assert.ok(devin)
  assert.equal(devin.driftStatus, "adapter_matrix_only")
})

test("buildHarnessRegistry: driftCount reflete exatamente as entradas não-consistentes (nunca escondido)", async () => {
  const { buildHarnessRegistry } = await imp("src/dream/harness-registry.js")
  const r = buildHarnessRegistry()
  assert.equal(r.driftCount, r.drift.length)
  assert.ok(r.driftCount >= 6, "5 capabilities_only + 1 adapter_matrix_only, no mínimo, hoje")
  assert.ok(r.drift.every((h) => h.driftStatus !== "consistent"))
})
