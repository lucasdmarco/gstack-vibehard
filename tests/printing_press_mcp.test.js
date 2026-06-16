import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mcpModule = path.join(repoRoot, "src", "printing-press", "mcp.js")

test("enableMcp cria pp-<tool> no .mcp.json do projeto (project-scoped)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-mcp-"))
  try {
    const { enableMcp, listMcp } = await import(`${pathToFileURL(mcpModule)}?t=${Date.now()}`)
    const r = enableMcp(tmp, "stripe", { skipBinaryCheck: true })
    assert.equal(r.status, "enabled")
    assert.equal(r.name, "pp-stripe")
    const cfg = JSON.parse(await readFile(path.join(tmp, ".mcp.json"), "utf-8"))
    assert.ok(cfg.mcpServers["pp-stripe"])
    assert.deepEqual(listMcp(tmp), ["pp-stripe"])
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("enableMcp preserva servidores do usuario e nao sobrescreve mesmo nome", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-mcp-user-"))
  try {
    await writeFile(path.join(tmp, ".mcp.json"), JSON.stringify({
      mcpServers: {
        "meu-server": { command: "node", args: ["x.js"] },
        "pp-stripe": { command: "meu-stripe-custom", args: ["--flag"] },
      },
    }))
    const { enableMcp } = await import(`${pathToFileURL(mcpModule)}?t=${Date.now()}`)
    const r = enableMcp(tmp, "stripe", { skipBinaryCheck: true })
    assert.equal(r.status, "exists", "nao sobrescreve pp-stripe customizado")
    const cfg = JSON.parse(await readFile(path.join(tmp, ".mcp.json"), "utf-8"))
    assert.deepEqual(cfg.mcpServers["pp-stripe"].args, ["--flag"], "customizacao do usuario preservada")
    assert.ok(cfg.mcpServers["meu-server"], "servidor do usuario intacto")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("disableMcp remove so o pp-<tool> do gstack, preserva o resto", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-mcp-dis-"))
  try {
    const { enableMcp, disableMcp } = await import(`${pathToFileURL(mcpModule)}?t=${Date.now()}`)
    await writeFile(path.join(tmp, ".mcp.json"), JSON.stringify({
      mcpServers: { "meu-server": { command: "node" } },
    }))
    enableMcp(tmp, "linear", { skipBinaryCheck: true })
    const r = disableMcp(tmp, "linear")
    assert.equal(r.status, "disabled")
    const cfg = JSON.parse(await readFile(path.join(tmp, ".mcp.json"), "utf-8"))
    assert.equal(cfg.mcpServers["pp-linear"], undefined)
    assert.ok(cfg.mcpServers["meu-server"], "servidor do usuario preservado")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("enableMcp rejeita tool invalida", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-mcp-inv-"))
  try {
    const { enableMcp } = await import(`${pathToFileURL(mcpModule)}?t=${Date.now()}`)
    assert.equal(enableMcp(tmp, "x; rm -rf /").status, "invalid_tool")
    assert.equal(existsSync(path.join(tmp, ".mcp.json")), false)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("enableMcp bloqueia se a tool nao esta instalada (installed:false)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-mcp-noinst-"))
  try {
    const { enableMcp } = await import(`${pathToFileURL(mcpModule)}?t=${Date.now()}`)
    const r = enableMcp(tmp, "stripe", { installed: false })
    assert.equal(r.status, "not_installed")
    assert.equal(existsSync(path.join(tmp, ".mcp.json")), false, "nao escreve .mcp.json")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("enableMcp bloqueia se o binario MCP nao responde (missing_binary)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-mcp-nobin-"))
  try {
    const { enableMcp } = await import(`${pathToFileURL(mcpModule)}?t=${Date.now()}`)
    const r = enableMcp(tmp, "stripe", { installed: true, exec: () => { throw new Error("not found") } })
    assert.equal(r.status, "missing_binary")
    assert.equal(existsSync(path.join(tmp, ".mcp.json")), false)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
