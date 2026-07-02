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

// ═══ V2 (PRD14 §4.1): scorecard completo por harness ═══

test("scorecard V2: todo harness tem os 10 campos obrigatórios do PRD", async () => {
  const capMod = path.resolve(import.meta.dirname, "..", "src", "harness", "capabilities.js")
  const { capabilityScorecard } = await import(`${pathToFileURL(capMod)}?t=${Date.now()}`)
  const rows = capabilityScorecard()
  assert.ok(rows.length >= 9)
  for (const r of rows) {
    for (const f of ["id", "harness", "state", "supportedAssets", "unsupportedSurfaces", "installOrOnramp", "verificationCommands", "riskNotes", "lastVerifiedAt", "owner"]) {
      assert.ok(r[f] != null, `${r.harness}.${f} presente`)
    }
    assert.ok(r.verificationCommands.length > 0, `${r.harness} tem comando de verificação`)
  }
})

test("scorecard V2: invariante — instruction_backed/reference_only NUNCA reivindicam hooks", async () => {
  const capMod = path.resolve(import.meta.dirname, "..", "src", "harness", "capabilities.js")
  const { capabilityScorecard, validateScorecard } = await import(`${pathToFileURL(capMod)}?t=${Date.now()}`)
  const v = validateScorecard()
  assert.equal(v.ok, true, v.errors.join("; "))
  for (const r of capabilityScorecard()) {
    if (r.state === "instruction_backed" || r.state === "reference_only") {
      assert.ok(!["real_hooks", "partial"].includes(r.enforcement), `${r.harness} instrucional não reivindica enforcement`)
    }
  }
  // sabotagem detectável: instrucional fingindo hooks → erro
  const bad = validateScorecard([{ id: "harness:x", harness: "x", state: "instruction_backed", enforcement: "real_hooks", supportedAssets: [], unsupportedSurfaces: [], installOrOnramp: "x", verificationCommands: ["y"], riskNotes: [], lastVerifiedAt: "2026-01-01", owner: "z" }])
  assert.equal(bad.ok, false)
  assert.match(bad.errors[0], /não pode reivindicar/)
})

test("scorecard V2: harness desconhecido = unsupported (nenhuma promessa)", async () => {
  const capMod = path.resolve(import.meta.dirname, "..", "src", "harness", "capabilities.js")
  const { capabilityRow } = await import(`${pathToFileURL(capMod)}?t=${Date.now()}`)
  const r = capabilityRow("harness-inventado")
  assert.equal(r.state, "unsupported")
  assert.equal(r.enforcement, "detection_only")
  assert.deepEqual(r.supportedAssets, [])
})

test("estados V2 coerentes: claude=native; copilot/gemini/windsurf=instruction_backed; kiro=reference_only", async () => {
  const { getAdapterInfo } = await imp()
  assert.equal(getAdapterInfo("claude").state, "native")
  assert.equal(getAdapterInfo("codex").state, "adapter_backed")
  assert.equal(getAdapterInfo("cursor").state, "adapter_backed")
  assert.equal(getAdapterInfo("copilot").state, "instruction_backed")
  assert.equal(getAdapterInfo("gemini").state, "instruction_backed")
  assert.equal(getAdapterInfo("windsurf").state, "instruction_backed")
  assert.equal(getAdapterInfo("kiro").state, "reference_only")
})
