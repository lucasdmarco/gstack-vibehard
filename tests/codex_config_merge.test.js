import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parse as parseToml } from "smol-toml"

const read = (p) => readFileSync(p, "utf-8")
const write = (p, c) => writeFileSync(p, c)

const repoRoot = path.resolve(import.meta.dirname, "..")
const codexModule = path.join(repoRoot, "src", "harness", "codex.js")

const USER_CONFIG = `# config do usuario
model = "o3"
approval_policy = "on-request"

[mcp_servers.meu_server]
command = "node"
args = ["meu-mcp.js"]

[mcp_servers.supabase]
command = "npx"
args = ["custom-supabase", "--minha-flag"]
`

test("mergeCodexConfig preserva config do usuario e adiciona hooks/mcp gstack", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-codex-"))
  try {
    const cfg = path.join(tmp, "config.toml")
    await writeFile(cfg, USER_CONFIG)
    const { mergeCodexConfig } = await import(`${pathToFileURL(codexModule)}?t=${Date.now()}`)

    mergeCodexConfig(cfg, read, write)

    const parsed = parseToml(await readFile(cfg, "utf-8"))
    // chaves do usuario preservadas
    assert.equal(parsed.model, "o3")
    assert.equal(parsed.approval_policy, "on-request")
    assert.deepEqual(parsed.mcp_servers.meu_server.args, ["meu-mcp.js"])
    // usuario vence em servidor de mesmo nome (supabase customizado preservado)
    assert.deepEqual(parsed.mcp_servers.supabase.args, ["custom-supabase", "--minha-flag"])
    // gstack adiciona seus hooks e servidores
    assert.ok(parsed.hooks.on_stop[0].includes("stop.py"))
    assert.ok(parsed.mcp_servers.fallow)
    assert.ok(parsed.mcp_servers.headroom)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("stripGstackFromCodexConfig remove so chaves gstack, preserva o resto", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-codex-strip-"))
  try {
    const cfg = path.join(tmp, "config.toml")
    await writeFile(cfg, USER_CONFIG)
    const { mergeCodexConfig, stripGstackFromCodexConfig } = await import(`${pathToFileURL(codexModule)}?t=${Date.now()}`)
    mergeCodexConfig(cfg, read, write)
    stripGstackFromCodexConfig(cfg, read, write)

    const parsed = parseToml(await readFile(cfg, "utf-8"))
    // config do usuario intacta
    assert.equal(parsed.model, "o3")
    assert.deepEqual(parsed.mcp_servers.meu_server.args, ["meu-mcp.js"])
    assert.deepEqual(parsed.mcp_servers.supabase.args, ["custom-supabase", "--minha-flag"])
    // chaves gstack removidas
    assert.equal(parsed.mcp_servers.fallow, undefined)
    assert.equal(parsed.mcp_servers.headroom, undefined)
    assert.equal(parsed.hooks, undefined)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("mergeCodexConfig em arquivo inexistente escreve config gstack pura", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-codex-new-"))
  try {
    const cfg = path.join(tmp, "config.toml")
    const { mergeCodexConfig } = await import(`${pathToFileURL(codexModule)}?t=${Date.now()}`)
    mergeCodexConfig(cfg, read, write)
    const parsed = parseToml(await readFile(cfg, "utf-8"))
    assert.ok(parsed.hooks.on_stop[0].includes("stop.py"))
    assert.ok(parsed.mcp_servers.fallow)
    assert.ok(parsed.agent.skills_dir.includes(".agents/skills"))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
