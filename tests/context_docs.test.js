import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const regMod = path.join(repoRoot, "src", "context-docs", "registry.js")
const cmdMod = path.join(repoRoot, "src", "commands", "context.js")

test("buildContextRegistry: schema summary-only com 4 fontes", async () => {
  const { buildContextRegistry } = await import(`${pathToFileURL(regMod)}?t=${Date.now()}`)
  const r = buildContextRegistry()
  assert.equal(r.schemaVersion, 1)
  assert.equal(r.sessionStart.injectMode, "summary-only")
  assert.deepEqual(Object.keys(r.sources), ["adr", "prd", "plans", "research"])
})

test("countDocs conta .md por categoria sem ler conteudo", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-ctx-"))
  try {
    await mkdir(path.join(tmp, "docs", "adr"), { recursive: true })
    await mkdir(path.join(tmp, "docs", "prd"), { recursive: true })
    await writeFile(path.join(tmp, "docs", "adr", "001.md"), "# adr")
    await writeFile(path.join(tmp, "docs", "adr", "002.md"), "# adr2")
    await writeFile(path.join(tmp, "docs", "prd", "p.md"), "# prd")
    await writeFile(path.join(tmp, "docs", "adr", ".gitkeep"), "")
    const { countDocs } = await import(`${pathToFileURL(regMod)}?t=${Date.now()}`)
    const c = countDocs(tmp)
    assert.equal(c.adr, 2)
    assert.equal(c.prd, 1)
    assert.equal(c.total, 3)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("context init e idempotente e cria docs dirs", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-ctxinit-"))
  try {
    const { contextCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    await contextCommand(["init"], { cwd: tmp })
    assert.equal(existsSync(path.join(tmp, ".gstack", "context.json")), true)
    assert.equal(existsSync(path.join(tmp, "docs", "adr", ".gitkeep")), true)
    // marca o arquivo e re-roda: nao sobrescreve
    await writeFile(path.join(tmp, ".gstack", "context.json"), '{"meu":"custom"}')
    await contextCommand(["init"], { cwd: tmp })
    const after = JSON.parse(await readFile(path.join(tmp, ".gstack", "context.json"), "utf-8"))
    assert.equal(after.meu, "custom", "init nao sobrescreve context.json existente")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
