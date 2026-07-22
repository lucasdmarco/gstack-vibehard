import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.1 — "a mesma semântica é testada em Claude, Codex e OpenCode": a decisão de
// first-run não pode depender de qual harness é qual — só de installed/callable.

test("decideFirstRun: mesma semântica para Claude, Codex e OpenCode — 1 apto sempre vira auto_selected", async () => {
  const { decideFirstRun } = await imp("src/onboarding/first-run.js")
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  for (const id of ["claude", "codex", "opencode"]) {
    const profiles = [buildHarnessSessionProfile(id, { installed: true, callable: true, enforcement: "native_enforced" })]
    const r = decideFirstRun({ profiles, requiresLlm: true })
    assert.equal(r.status, "auto_selected", `${id}: mesma semântica`)
    assert.equal(r.harness, id)
  }
})

test("decideFirstRun: mesma semântica para os 3 harnesses quando NENHUM está apto", async () => {
  const { decideFirstRun } = await imp("src/onboarding/first-run.js")
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  for (const id of ["claude", "codex", "opencode"]) {
    const profiles = [buildHarnessSessionProfile(id, { installed: false, callable: false, enforcement: null })]
    const r = decideFirstRun({ profiles, requiresLlm: true })
    assert.equal(r.status, "blocked", `${id}: mesma semântica de bloqueio`)
  }
})

test("applyFirstRunChoice: harness inexistente na lista de alvo é sempre rejected, para qualquer id", async () => {
  const { applyFirstRunChoice } = await imp("src/onboarding/first-run.js")
  for (const id of ["claude", "codex", "opencode"]) {
    const r = applyFirstRunChoice([], id)
    assert.equal(r.status, "rejected")
  }
})

test("detectTargetProfiles: roda REAL (sem mock) para claude/codex/opencode — sempre 3 perfis, schema estável", async () => {
  const { detectTargetProfiles, TARGET_HARNESSES } = await imp("src/onboarding/first-run.js")
  const profiles = detectTargetProfiles()
  assert.equal(profiles.length, TARGET_HARNESSES.length)
  for (const p of profiles) {
    assert.equal(p.schemaVersion, "gstack.harness-session-profile.v1")
    assert.equal(typeof p.installed, "boolean")
    assert.equal(typeof p.callable, "boolean")
    assert.equal(p.auth, "unknown")
  }
})
