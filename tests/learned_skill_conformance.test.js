import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const SPEC = {
  id: "resolve-flaky-retry",
  triggerTokens: ["retry", "flaky", "deploy"],
  positiveCases: ["preciso resolver um retry flaky no deploy", "o deploy está flaky, tenta de novo"],
  negativeCases: ["quero criar um novo componente React", "adicionar autenticação com JWT"],
}

test("evaluateLearnedSkillActivation: skill promovida ativa nos casos positivos e NÃO nos negativos -> conformant", async () => {
  const { evaluateLearnedSkillActivation } = await imp("src/skills/behavioral-conformance.js")
  const r = evaluateLearnedSkillActivation(SPEC)
  assert.equal(r.verdict, "conformant")
})

test("evaluateLearnedSkillActivation: FALHA se não ativar em algum caso positivo (DoD)", async () => {
  const { evaluateLearnedSkillActivation } = await imp("src/skills/behavioral-conformance.js")
  const r = evaluateLearnedSkillActivation({ ...SPEC, positiveCases: [...SPEC.positiveCases, "isto não deveria ativar mas deveria"] })
  assert.equal(r.verdict, "nonconformant")
})

test("evaluateLearnedSkillActivation: FALHA se ativar em algum caso negativo (DoD)", async () => {
  const { evaluateLearnedSkillActivation } = await imp("src/skills/behavioral-conformance.js")
  const r = evaluateLearnedSkillActivation({ ...SPEC, negativeCases: [...SPEC.negativeCases, "um retry flaky de propósito pra confundir"] })
  assert.equal(r.verdict, "nonconformant")
})

test("evaluateLearnedSkillActivation: sem casos positivos OU negativos -> nunca conformant (invariante refactor)", async () => {
  const { evaluateLearnedSkillActivation } = await imp("src/skills/behavioral-conformance.js")
  const semNegativos = evaluateLearnedSkillActivation({ ...SPEC, negativeCases: [] })
  assert.equal(semNegativos.verdict, "nonconformant")
  const semPositivos = evaluateLearnedSkillActivation({ ...SPEC, positiveCases: [] })
  assert.equal(semPositivos.verdict, "nonconformant")
})

test("learnedSkillActivationSpec: plugável em runP0Conformance/aggregateRelease sem mudar contrato", async () => {
  const { learnedSkillActivationSpec, runConformance, aggregateRelease } = await imp("src/skills/behavioral-conformance.js")
  const spec = learnedSkillActivationSpec(SPEC)
  const report = runConformance(spec)
  const release = aggregateRelease([report])
  assert.equal(release.ready, true)
  assert.equal(release.reports[0].skill, "resolve-flaky-retry")
})
