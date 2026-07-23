import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.4 — Graphify query-first. Escopo real: NÃO duplica o que já existe
 * (probeGraphify/freshness em tools/readiness.js, bounded query em
 * context-docs/scout.js) — só fecha os gaps de verdade: subcomandos REALMENTE
 * suportados (declarativo, sourced do próprio código), policy soft/strict
 * explícita (nunca implícita), migração honesta do .graphify/deps.json legado,
 * e uma declaração honesta de conformance por harness (nenhum "enforced" sem
 * prova — mesmo invariante de claimsFakeHooks em harness/capabilities.js).
 */

async function tmpProject() { return mkdtemp(path.join(tmpdir(), "gstack-graphify-adapter-")) }

test("GRAPHIFY_SUBCOMMANDS: só os subcomandos REALMENTE invocados pelo código, nada inventado", async () => {
  const { GRAPHIFY_SUBCOMMANDS } = await imp("src/tools/graphify-adapter.js")
  assert.ok(GRAPHIFY_SUBCOMMANDS.includes("update"))
  assert.ok(GRAPHIFY_SUBCOMMANDS.includes("index"))
  assert.ok(!GRAPHIFY_SUBCOMMANDS.includes("query"), "graphify não tem subcomando query -- GStack lê graph.json direto")
})

test("resolveQueryFirstPolicy: default soft_query_first sem config explícita", async () => {
  const { resolveQueryFirstPolicy } = await imp("src/tools/graphify-adapter.js")
  assert.equal(resolveQueryFirstPolicy({}), "soft_query_first")
  assert.equal(resolveQueryFirstPolicy(null), "soft_query_first")
})

test("resolveQueryFirstPolicy: strict_first_read só com policy explícita do projeto", async () => {
  const { resolveQueryFirstPolicy } = await imp("src/tools/graphify-adapter.js")
  assert.equal(resolveQueryFirstPolicy({ contextRetrieval: { graphifyQueryFirst: "strict_first_read" } }), "strict_first_read")
  assert.equal(resolveQueryFirstPolicy({ contextRetrieval: { graphifyQueryFirst: "bogus_value" } }), "soft_query_first", "valor desconhecido nunca vira strict por acidente")
})

test("loadProjectPolicyFile: ausente/malformado -> {} honesto, nunca lança", async () => {
  const { loadProjectPolicyFile } = await imp("src/tools/graphify-adapter.js")
  const dir = await tmpProject()
  try {
    assert.deepEqual(loadProjectPolicyFile(dir), {})
    await mkdir(path.join(dir, ".gstack"), { recursive: true })
    await writeFile(path.join(dir, ".gstack", "policy.json"), "{ nao e json")
    assert.deepEqual(loadProjectPolicyFile(dir), {}, "malformado nunca lança, nunca fabrica valor")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("loadProjectPolicyFile: lê contextRetrieval real quando presente", async () => {
  const { loadProjectPolicyFile } = await imp("src/tools/graphify-adapter.js")
  const dir = await tmpProject()
  try {
    await mkdir(path.join(dir, ".gstack"), { recursive: true })
    await writeFile(path.join(dir, ".gstack", "policy.json"), JSON.stringify({ contextRetrieval: { graphifyQueryFirst: "strict_first_read" } }))
    const p = loadProjectPolicyFile(dir)
    assert.equal(p.contextRetrieval.graphifyQueryFirst, "strict_first_read")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("queryGraphFirst: soft_query_first com grafo stale -> serve resultados com aviso, nunca bloqueia", async () => {
  const { queryGraphFirst } = await imp("src/tools/graphify-adapter.js")
  const dir = await tmpProject()
  await mkdir(path.join(dir, "graphify-out"), { recursive: true })
  const fs = await import("node:fs/promises")
  await fs.writeFile(path.join(dir, "graphify-out", "graph.json"), JSON.stringify({
    built_at_commit: "aaa", nodes: [{ label: "fooBar", source_file: "src/foo.js", source_location: "1-2" }], links: [],
  }))
  try {
    const r = queryGraphFirst({ cwd: dir, question: "fooBar", policy: "soft_query_first", freshness: { state: "stale" } })
    assert.equal(r.blocked, false)
    assert.ok(r.staleWarning)
    assert.ok(r.results.length >= 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("queryGraphFirst: strict_first_read com grafo stale -> recusa servir, recomenda regenerar", async () => {
  const { queryGraphFirst } = await imp("src/tools/graphify-adapter.js")
  const dir = await tmpProject()
  try {
    const r = queryGraphFirst({ cwd: dir, question: "fooBar", policy: "strict_first_read", freshness: { state: "stale" } })
    assert.equal(r.blocked, true)
    assert.match(r.recommendedAction, /update|index/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("queryGraphFirst: resultado é BOUNDED (reusa graphifyBackend de scout.js, não duplica), nunca o relatório inteiro", async () => {
  const { queryGraphFirst } = await imp("src/tools/graphify-adapter.js")
  const dir = await tmpProject()
  await mkdir(path.join(dir, "graphify-out"), { recursive: true })
  const fs = await import("node:fs/promises")
  const manyNodes = Array.from({ length: 50 }, (_, i) => ({ label: `matchThing${i}`, source_file: `src/f${i}.js`, source_location: "1-2" }))
  await fs.writeFile(path.join(dir, "graphify-out", "graph.json"), JSON.stringify({ built_at_commit: "aaa", nodes: manyNodes, links: [] }))
  try {
    const r = queryGraphFirst({ cwd: dir, question: "matchThing", policy: "soft_query_first", freshness: { state: "fresh" } })
    assert.ok(r.results.length <= 5, "bounded — nunca os 50 nós inteiros")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("legacyDepsJsonStatus: detecta .graphify/deps.json legado, NUNCA migra/apaga sozinho", async () => {
  const { legacyDepsJsonStatus } = await imp("src/tools/graphify-adapter.js")
  const dir = await tmpProject()
  try {
    assert.equal(legacyDepsJsonStatus(dir).present, false)
    await mkdir(path.join(dir, ".graphify"), { recursive: true })
    const fs = await import("node:fs/promises")
    await fs.writeFile(path.join(dir, ".graphify", "deps.json"), "{}")
    const s = legacyDepsJsonStatus(dir)
    assert.equal(s.present, true)
    assert.match(s.migrationNote, /graphify-out\/graph\.json/)
    // controle negativo: o arquivo legado continua lá, ninguém apagou/reescreveu
    assert.equal((await fs.readFile(path.join(dir, ".graphify", "deps.json"), "utf-8")), "{}")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("GRAPHIFY_QUERY_FIRST_CONFORMANCE: nenhum harness reivindica 'enforced' sem prova (mesmo invariante de claimsFakeHooks)", async () => {
  const { GRAPHIFY_QUERY_FIRST_CONFORMANCE } = await imp("src/tools/graphify-adapter.js")
  for (const [harness, decl] of Object.entries(GRAPHIFY_QUERY_FIRST_CONFORMANCE)) {
    assert.ok(["advisory", "unsupported"].includes(decl.route), `${harness}: route deve ser advisory|unsupported, nunca enforced sem prova`)
    assert.ok(decl.reason, `${harness}: precisa de motivo`)
  }
})

test("detectGraphifyPackage: sem probe real -> unknown honesto, nunca fabrica versão", async () => {
  const { detectGraphifyPackage } = await imp("src/tools/graphify-adapter.js")
  const failingProbe = () => ({ ok: false, stdout: "", stderr: "not found" })
  const r = detectGraphifyPackage({ probe: failingProbe })
  assert.equal(r.version, null)
  assert.equal(r.detected, false)
})

test("detectGraphifyPackage: probe com versão real -> extrai a versão do stdout", async () => {
  const { detectGraphifyPackage } = await imp("src/tools/graphify-adapter.js")
  const okProbe = () => ({ ok: true, stdout: "graphify 0.9.22\n" })
  const r = detectGraphifyPackage({ probe: okProbe })
  assert.equal(r.detected, true)
  assert.equal(r.version, "0.9.22")
})
