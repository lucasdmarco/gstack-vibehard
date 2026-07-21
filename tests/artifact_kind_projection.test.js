import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("projectArtifactKind: skill projeta como installed_skill; rule_pack/reference_pack NUNCA", async () => {
  const { projectArtifactKind } = await imp("src/skills/source-lock.js")
  assert.equal(projectArtifactKind("skill"), "installed_skill")
  assert.equal(projectArtifactKind("rule_pack"), "merged_into_gates")
  assert.equal(projectArtifactKind("reference_pack"), "progressive_disclosure_only")
})

test("projectArtifactKind: tipo desconhecido -> null honesto (nunca inventa projeção)", async () => {
  const { projectArtifactKind } = await imp("src/skills/source-lock.js")
  assert.equal(projectArtifactKind("qualquer-coisa"), null)
})

test("appearsAsInstalledSkill: só 'skill' aparece como skill instalada — DoD do S46.5", async () => {
  const { appearsAsInstalledSkill, ARTIFACT_KINDS } = await imp("src/skills/source-lock.js")
  for (const kind of ARTIFACT_KINDS) {
    assert.equal(appearsAsInstalledSkill(kind), kind === "skill", `${kind}: só 'skill' deve aparecer instalada`)
  }
})

test("todos os ARTIFACT_KINDS têm projeção honesta declarada (nenhum fica sem mapeamento)", async () => {
  const { ARTIFACT_KINDS, projectArtifactKind } = await imp("src/skills/source-lock.js")
  for (const kind of ARTIFACT_KINDS) assert.ok(projectArtifactKind(kind), `${kind} sem projeção`)
})
