import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const skillMd = (rel) => readFileSync(path.join(repoRoot, "skills", "skills", rel, "SKILL.md"), "utf-8")

test("skill-creator: única fonte canônica de autoria com disciplina de aprendizado verificável", () => {
  const body = skillMd("skill-creator")
  assert.match(body, /única fonte canônica de autoria/i)
  assert.match(body, /golden path/i)
  assert.match(body, /skill \| memory \| skip/)
  assert.match(body, /Dedupe antes de criar/i)
  assert.match(body, /Verified by:/)
  assert.match(body, /Failure pattern:/)
  assert.match(body, /What did not work:/)
  assert.match(body, /Secrets apenas por referência/i)
  assert.match(body, /Staging, nunca escrita direta/i)
  assert.match(body, /Freshness e supersession/i)
})

test("skill-authoring: alias fino — encaminha para skill-creator, não duplica template/checklist", () => {
  const body = skillMd("skill-authoring")
  assert.match(body, /alias fino/i)
  assert.match(body, /fonte canônica de autoria é `skill-creator`/i)
  // não deve duplicar o checklist de finalização nem o template completo do skill-creator
  assert.doesNotMatch(body, /Checklist Before Finishing/)
  assert.doesNotMatch(body, /Progressive Disclosure/)
  assert.doesNotMatch(body, /Verified by:/)
  // alias deve ser bem mais curto que a fonte canônica
  const canonical = skillMd("skill-creator")
  assert.ok(body.length < canonical.length / 2, "alias deve ser significativamente mais curto que a fonte canônica")
})

test("project-lifecycle: ganha learning closeout opcional e não bloqueante", () => {
  const body = skillMd("project-lifecycle")
  assert.match(body, /LEARNING CLOSEOUT/i)
  assert.match(body, /opcional, nunca bloqueante/i)
  assert.match(body, /Salvar como memória, propor uma skill ou descartar/)
})

test("find-skills: consulta governança local e pede consentimento antes da rede; nunca -g -y por default", () => {
  const body = skillMd("find-skills")
  assert.match(body, /Consult Local Governance First/i)
  assert.match(body, /consent before running any external.network search/is)
  assert.doesNotMatch(body, /-g -y/, "não deve mais recomendar instalação global sem confirmação como default")
  assert.match(body, /project-scoped by default/i)
})

test("create-rule: project-scoped por default; escrita global exige consentimento, backup e restore", () => {
  const body = skillMd("create-rule")
  assert.match(body, /project-scoped por default/i)
  assert.match(body, /Escrita global exige consentimento separado/i)
  assert.match(body, /backup/i)
  assert.match(body, /restaurar|restore/i)
  assert.match(body, /Não anexe conteúdo arbitrário/i)
})

test("registry: referências metodológicas do PRD46 presentes e marcadas como nunca-runtime", () => {
  const registry = JSON.parse(readFileSync(path.join(repoRoot, ".docs", "RESEARCH", "repository-registry.json"), "utf-8"))
  const urls = registry.externalReferences.map((r) => r.url)
  for (const url of [
    "https://github.com/kulaxyz/self-learning-skills",
    "https://github.com/vercel-labs/skills",
    "https://github.com/vercel-labs/agent-skills",
  ]) {
    assert.ok(urls.includes(url), `registry deve listar ${url}`)
    const entry = registry.externalReferences.find((r) => r.url === url)
    assert.equal(entry.status, "active_reference")
    assert.match(entry.note, /NUNCA.*runtime/i)
  }
})
