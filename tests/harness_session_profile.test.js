import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.1 — Harness Session Profile: contrato normalizado read-only. `unknown` NUNCA é
// tratado como `ready`; probe nunca edita config nem dispara login (DoD).

test("probeCommand: comando existente -> detected (execFileSync real, sem mock)", async () => {
  const { probeCommand } = await imp("src/onboarding/harness-probes.js")
  const r = probeCommand(process.execPath, ["--version"], { timeoutMs: 5000 })
  assert.equal(r.state, "detected")
})

test("probeCommand: comando inexistente -> not_found (nunca crash)", async () => {
  const { probeCommand } = await imp("src/onboarding/harness-probes.js")
  const r = probeCommand("comando-que-nao-existe-xyz-123", ["--version"], { timeoutMs: 3000 })
  assert.equal(r.state, "not_found")
})

test("probeCommand: timeout -> 'timeout' (degraded), NUNCA confundido com not_found (DoD)", async () => {
  const { probeCommand } = await imp("src/onboarding/harness-probes.js")
  // node --eval que dorme mais que o timeout — força o probe a estourar de verdade.
  const r = probeCommand(process.execPath, ["-e", "setTimeout(()=>{}, 3000)"], { timeoutMs: 200 })
  assert.equal(r.state, "timeout")
})

test("buildHarnessSessionProfile: harness detectado -> installed:true, auth/models SEMPRE 'unknown' nesta sprint (nunca fabricado)", async () => {
  const { buildHarnessSessionProfile, HARNESS_SESSION_PROFILE_SCHEMA } = await imp("src/onboarding/harness-session-profile.js")
  const p = buildHarnessSessionProfile("claude", { installed: true, callable: true, enforcement: "native_enforced" })
  assert.equal(p.schemaVersion, HARNESS_SESSION_PROFILE_SCHEMA)
  assert.equal(p.harness, "claude")
  assert.equal(p.installed, true)
  assert.equal(p.auth, "unknown", "auth nunca é fabricado como ready sem probe real de login")
  assert.deepEqual(p.models, { status: "unknown", items: [] })
})

test("buildHarnessSessionProfile: harness NÃO detectado -> installed:false, callable:false", async () => {
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  const p = buildHarnessSessionProfile("codex", { installed: false, callable: false, enforcement: null })
  assert.equal(p.installed, false)
  assert.equal(p.callable, false)
})

test("buildHarnessSessionProfile: enforcement instrucional NUNCA aparece como enforced (reusa harness-conformance-matrix do S47.10)", async () => {
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  const p = buildHarnessSessionProfile("copilot", { installed: true, callable: true, enforcement: "instructional_advisory" })
  assert.equal(p.enforcement, "instructional_advisory")
  assert.notEqual(p.enforcement, "native_enforced")
})

test("buildHarnessSessionProfile: probedAt é timestamp ISO real", async () => {
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  const p = buildHarnessSessionProfile("claude", { installed: true, callable: true, enforcement: "native_enforced" })
  assert.ok(!Number.isNaN(Date.parse(p.probedAt)))
})

test("aptHarnesses: só harnesses installed+callable contam como 'aptos' pro primeiro uso", async () => {
  const { buildHarnessSessionProfile, aptHarnesses } = await imp("src/onboarding/harness-session-profile.js")
  const profiles = [
    buildHarnessSessionProfile("claude", { installed: true, callable: true, enforcement: "native_enforced" }),
    buildHarnessSessionProfile("codex", { installed: true, callable: false, enforcement: "adapter_enforced" }),
    buildHarnessSessionProfile("opencode", { installed: false, callable: false, enforcement: null }),
  ]
  const apt = aptHarnesses(profiles)
  assert.deepEqual(apt.map((p) => p.harness), ["claude"])
})
