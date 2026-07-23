import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..", "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.4 — benchmark COMPARATIVO, nunca uma % fixa alegada como resultado
 * do GStack (regra explícita do plano: "no automatic token-savings percentage
 * is claimed"). Compara bytes considerados por uma consulta bounded ao grafo
 * vs. ler ingenuamente todos os arquivos de um diretório fixture — usando a
 * MESMA heurística honesta já existente (`estimateTokensAvoided` de scout.js),
 * não uma métrica nova inventada para esta sprint.
 */

async function buildFixtureProject(fileCount) {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-retrieval-bench-"))
  await mkdir(path.join(dir, "src"), { recursive: true })
  const nodes = []
  for (let i = 0; i < fileCount; i++) {
    const content = `function widgetHandler${i}() {\n  return ${i}\n}\n`.repeat(20)
    await writeFile(path.join(dir, "src", `file${i}.js`), content)
    nodes.push({ label: `widgetHandler${i}`, source_file: `src/file${i}.js`, source_location: "1-2" })
  }
  await mkdir(path.join(dir, "graphify-out"), { recursive: true })
  await writeFile(path.join(dir, "graphify-out", "graph.json"), JSON.stringify({ built_at_commit: "aaa", nodes, links: [] }))
  return dir
}

async function naiveFullReadBytes(dir) {
  const fs = await import("node:fs/promises")
  const files = await fs.readdir(path.join(dir, "src"))
  let total = 0
  for (const f of files) total += (await fs.stat(path.join(dir, "src", f))).size
  return total
}

test("BENCH comparativo: consulta bounded ao grafo considera MENOS bytes que ler tudo ingenuamente (sem % fixa alegada)", async () => {
  const { queryGraphFirst } = await imp("src/tools/graphify-adapter.js")
  const { estimateTokensAvoided } = await imp("src/context-docs/scout.js")
  const dir = await buildFixtureProject(30)
  try {
    const naiveBytes = await naiveFullReadBytes(dir)
    const r = queryGraphFirst({ cwd: dir, question: "widgetHandler", policy: "soft_query_first", freshness: { state: "fresh" } })
    const estimate = estimateTokensAvoided(naiveBytes, r.results)
    assert.equal(estimate.basis, "bytes_considerados/4 − payload/4 (heurística, não medição)", "mesma heurística honesta reusada, não uma métrica nova")
    assert.ok(r.results.length <= 5, "resultado bounded")
    assert.ok(estimate.estimate > 0, "consulta bounded evita reler o corpus inteiro (comparativo, não percentual fixo)")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("BENCH: cresce o corpus, a consulta bounded continua bounded (não escala linearmente com o corpus)", async () => {
  const { queryGraphFirst } = await imp("src/tools/graphify-adapter.js")
  const small = await buildFixtureProject(5)
  const large = await buildFixtureProject(100)
  try {
    const rSmall = queryGraphFirst({ cwd: small, question: "widgetHandler", policy: "soft_query_first", freshness: { state: "fresh" } })
    const rLarge = queryGraphFirst({ cwd: large, question: "widgetHandler", policy: "soft_query_first", freshness: { state: "fresh" } })
    assert.ok(rSmall.results.length <= 5 && rLarge.results.length <= 5, "bounded independente do tamanho do corpus")
  } finally {
    await rm(small, { recursive: true, force: true })
    await rm(large, { recursive: true, force: true })
  }
})
