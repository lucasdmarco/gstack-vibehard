import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("verification-profiles: 5 perfis com comandos preferidos/fallback e critérios", async () => {
  const { VERIFICATION_PROFILES, getVerificationProfile } = await imp("src/project-plan/verification-profiles.js")
  assert.equal(Object.keys(VERIFICATION_PROFILES).length, 5)
  for (const p of Object.values(VERIFICATION_PROFILES)) {
    assert.ok(p.preferredCommands.length && p.fallbackCommands.length && p.successCriteria.length)
    assert.ok(Array.isArray(p.requiredSignals) && Array.isArray(p.optionalSignals))
  }
  assert.equal(getVerificationProfile("compiler-driven").preferredCommands[0], "npm run typecheck")
  assert.equal(getVerificationProfile("inexistente"), null)
})

test("verification-profiles: preview/browser é OPCIONAL no product-iteration", async () => {
  const { getVerificationProfile } = await imp("src/project-plan/verification-profiles.js")
  const p = getVerificationProfile("product-iteration")
  assert.ok(p.optionalSignals.some((s) => /preview|screenshot/.test(s)))
  assert.ok(!p.requiredSignals.some((s) => /preview|screenshot|browser/.test(s)), "browser não é required (runtime futuro)")
})
