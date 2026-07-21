import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("promotedSourceHash: só artifactKind 'skill' entra no hash — rule_pack/reference_pack são FILTRADOS", async () => {
  const { promotedSourceHash, hashFiles } = await imp("src/agents/factory.js")
  const files = [
    { rel: "a.md", content: "conteúdo skill", artifactKind: "skill" },
    { rel: "b.md", content: "conteúdo rule pack", artifactKind: "rule_pack" },
    { rel: "c.md", content: "conteúdo reference pack", artifactKind: "reference_pack" },
  ]
  const onlySkill = promotedSourceHash(files)
  const expected = hashFiles([files[0]])
  assert.equal(onlySkill, expected, "hash deve bater com só o arquivo skill, ignorando rule/reference pack")
})

test("promotedSourceHash: sem artifactKind declarado -> assume 'skill' (compat com candidates antigos)", async () => {
  const { promotedSourceHash, hashFiles } = await imp("src/agents/factory.js")
  const files = [{ rel: "a.md", content: "x" }]
  assert.equal(promotedSourceHash(files), hashFiles(files))
})

test("promotedSourceHash: lista vazia -> hash determinístico de vazio (nunca null/undefined)", async () => {
  const { promotedSourceHash } = await imp("src/agents/factory.js")
  const h = promotedSourceHash([])
  assert.match(h, /^sha256:[0-9a-f]{64}$/)
  assert.equal(h, promotedSourceHash([]))
})

test("sourceHashes: promotedHash entra no manifest v2 sem quebrar o contrato existente (compat)", async () => {
  const { sourceHashes } = await imp("src/agents/factory.js")
  const h = sourceHashes({ coreFiles: [], knowledgeFiles: [], agentFiles: [] })
  assert.ok(h.coreHash && h.knowledgeHash && h.agentsHash, "chaves antigas continuam presentes")
  assert.match(h.promotedHash, /^sha256:[0-9a-f]{64}$/, "chave nova presente e determinística")
})

test("sourceHashes: promotedFiles com rule_pack misturado não muda o hash (filtrado igual)", async () => {
  const { sourceHashes } = await imp("src/agents/factory.js")
  const withOnlySkill = sourceHashes({ promotedFiles: [{ rel: "a.md", content: "x", artifactKind: "skill" }] })
  const withMixed = sourceHashes({ promotedFiles: [{ rel: "a.md", content: "x", artifactKind: "skill" }, { rel: "b.md", content: "y", artifactKind: "rule_pack" }] })
  assert.equal(withOnlySkill.promotedHash, withMixed.promotedHash)
})
