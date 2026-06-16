import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cliModule = path.join(repoRoot, "src", "printing-press", "cli.js")
const toolsModule = path.join(repoRoot, "src", "commands", "tools.js")

test("runPrintingPress usa pin, args em array e shell:false", async () => {
  const { runPrintingPress, PP_PKG } = await import(`${pathToFileURL(cliModule)}?t=${Date.now()}`)
  let captured
  const exec = (file, args, opts) => { captured = { file, args, opts }; return "[]" }
  const res = runPrintingPress(["search", "stripe", "--json"], { exec })
  assert.equal(res.ok, true)
  assert.equal(captured.file, "npx")
  assert.deepEqual(captured.args, ["-y", PP_PKG, "search", "stripe", "--json"])
  assert.equal(captured.opts.shell, false)
})

test("ppSearch parseia JSON e rejeita query insegura", async () => {
  const { ppSearch, PrintingPressError } = await import(`${pathToFileURL(cliModule)}?t=${Date.now()}`)
  const exec = () => JSON.stringify([{ slug: "stripe" }, { slug: "stripe-cli" }])
  const r = ppSearch("stripe", { exec })
  assert.equal(r.available, true)
  assert.equal(r.items.length, 2)
  assert.throws(() => ppSearch("stripe; rm -rf /", { exec }), PrintingPressError)
})

test("discovery degrada gracioso quando exec falha (sem rede)", async () => {
  const { ppList } = await import(`${pathToFileURL(cliModule)}?t=${Date.now()}`)
  const exec = () => { throw new Error("offline") }
  const r = ppList({ exec })
  assert.equal(r.available, false)
  assert.deepEqual(r.items, [])
})

test("tools suggested le o registry do projeto e nao toca rede", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-tools-"))
  try {
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    await writeFile(path.join(tmp, ".gstack", "integrations.json"), JSON.stringify({
      schemaVersion: 1,
      printingPress: { suggested: ["stripe", "linear"] },
      routing: { reads: "printing-press", writes: "composio" },
    }))
    const { toolsCommand } = await import(`${pathToFileURL(toolsModule)}?t=${Date.now()}`)
    // nao deve lancar; le local
    await toolsCommand(["suggested"], { cwd: tmp })
    assert.ok(true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("tools enable-printing-press marca enabled sem instalar nada", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-tools-en-"))
  try {
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    await writeFile(path.join(tmp, ".gstack", "integrations.json"), JSON.stringify({
      schemaVersion: 1, printingPress: { enabled: false, suggested: ["stripe"] },
    }))
    const { toolsCommand } = await import(`${pathToFileURL(toolsModule)}?t=${Date.now()}`)
    await toolsCommand(["enable-printing-press"], { cwd: tmp })
    const reg = JSON.parse(await readFile(path.join(tmp, ".gstack", "integrations.json"), "utf-8"))
    assert.equal(reg.printingPress.enabled, true)
    assert.equal(reg.printingPress.discoveryInstalled, true)
    // nunca cria .mcp.json
    assert.equal(existsSync(path.join(tmp, ".mcp.json")), false)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
