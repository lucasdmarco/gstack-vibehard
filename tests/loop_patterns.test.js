import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("loop-patterns: 5 padrões com perfil/regras/comandos reais", async () => {
  const { LOOP_PATTERNS } = await imp("src/project-plan/loop-patterns.js")
  const { VERIFICATION_PROFILES } = await imp("src/project-plan/verification-profiles.js")
  const ids = Object.keys(LOOP_PATTERNS)
  assert.deepEqual(ids.sort(), ["compiler-driven", "product-iteration", "review-driven", "runtime-debugging", "test-driven"])
  for (const p of Object.values(LOOP_PATTERNS)) {
    assert.ok(p.bestFor.length && p.intentKeywords.length && p.contextSources.length)
    assert.ok(p.actionStrategy && p.stoppingRules.length)
    assert.ok(VERIFICATION_PROFILES[p.verificationProfile], "perfil existe")
    // recomenda comandos reais do gstack
    assert.ok(p.recommendedCommands.every((c) => /^(context|workflow|delegate) /.test(c)), "comandos reais")
    // nenhum loop "executa" — só recomenda
    assert.ok(!("execute" in p))
  }
})

test("loop-patterns: carga valida perfil e stopping rules (sem referência morta)", async () => {
  // se houvesse referência inexistente, o import lançaria
  await assert.doesNotReject(imp("src/project-plan/loop-patterns.js"))
})
