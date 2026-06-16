import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "context.js")

// Integração: o comando JS shella o indexer Python real (hermético — só arquivos locais).
test("context index/search via comando JS (bridge Python)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-cidx-"))
  try {
    await mkdir(path.join(tmp, "docs", "adr"), { recursive: true })
    await writeFile(path.join(tmp, "docs", "adr", "001.md"), "# ADR Casdoor\nUsamos [[Casdoor]] para auth.\n")
    const { contextCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)

    await contextCommand(["index"], { cwd: tmp })
    assert.equal(existsSync(path.join(tmp, ".gstack", "context", "context.db")), true, "index cria o db")

    // search não deve lançar e o db existe
    await contextCommand(["search", "Casdoor"], { cwd: tmp })
    await contextCommand(["status", "--db"], { cwd: tmp })
    assert.ok(true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("context search sem índice avisa (não quebra)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-cidx2-"))
  try {
    const { contextCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    await contextCommand(["search", "x"], { cwd: tmp }) // sem db — degrada gracioso
    assert.ok(true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
