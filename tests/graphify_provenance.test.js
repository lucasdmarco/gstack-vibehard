import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "tools", "graphify-provenance.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

/**
 * PRD51 S51.5.1 — o graph.json REAL do upstream (confirmado rodando o
 * binário graphify instalado) não tem `built_at_commit`. Este sidecar é a
 * fonte de proveniência que GStack controla ele mesmo.
 */

test("writeGraphifyProvenance + readGraphifyProvenance: round-trip real em disco", async () => {
  const { writeGraphifyProvenance, readGraphifyProvenance, PROVENANCE_SCHEMA } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-prov-"))
  try {
    const written = writeGraphifyProvenance(cwd, { commit: "abc123", graphifyVersion: "0.8.30", nowIso: () => "2026-07-27T00:00:00.000Z" })
    assert.equal(written.schemaVersion, PROVENANCE_SCHEMA)
    assert.ok(existsSync(path.join(cwd, ".gstack", "graphify-provenance.json")))
    const read = readGraphifyProvenance(cwd)
    assert.deepEqual(read, {
      schemaVersion: PROVENANCE_SCHEMA, builtAtCommit: "abc123", graphifyVersion: "0.8.30", generatedAt: "2026-07-27T00:00:00.000Z",
    })
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("readGraphifyProvenance: ausente -> null honesto (nunca lança)", async () => {
  const { readGraphifyProvenance } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-prov-"))
  try {
    assert.equal(readGraphifyProvenance(cwd), null)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("readGraphifyProvenance: JSON corrompido -> null honesto (nunca lança)", async () => {
  const { readGraphifyProvenance } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-prov-"))
  try {
    await mkdir(path.join(cwd, ".gstack"), { recursive: true })
    await writeFile(path.join(cwd, ".gstack", "graphify-provenance.json"), "{ not json")
    assert.equal(readGraphifyProvenance(cwd), null)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("graphSchemaDrift: shape REAL do upstream (nodes/links/input_tokens/output_tokens) -> zero drift", async () => {
  const { graphSchemaDrift } = await imp()
  const real = { nodes: [], links: [], input_tokens: 100, output_tokens: 50 }
  assert.deepEqual(graphSchemaDrift(real), [])
})

test("graphSchemaDrift: CONTROLE NEGATIVO -- chave de topo desconhecida é detectada, não ignorada em silêncio", async () => {
  const { graphSchemaDrift } = await imp()
  const futureShape = { nodes: [], links: [], schema_version: 3 }
  assert.deepEqual(graphSchemaDrift(futureShape), ["schema_version"])
})
