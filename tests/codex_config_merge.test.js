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

[hooks]
on_stop = ["meu-hook-pessoal.sh"]

[mcp_servers.meu_server]
command = "node"
args = ["meu-mcp.js"]

[mcp_servers.supabase]
command = "npx"
args = ["custom-supabase", "--minha-flag"]
`

test("mergeCodexConfig com mcp:true preserva config do usuario, LIMPA hooks inertes e adiciona mcp", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-codex-"))
  try {
    const cfg = path.join(tmp, "config.toml")
    await writeFile(cfg, USER_CONFIG)
    const { mergeCodexConfig } = await import(`${pathToFileURL(codexModule)}?t=${Date.now()}`)

    mergeCodexConfig(cfg, { mcp: true, readImpl: read, writeImpl: write })

    const parsed = parseToml(await readFile(cfg, "utf-8"))
    // chaves do usuario preservadas
    assert.equal(parsed.model, "o3")
    assert.equal(parsed.approval_policy, "on-request")
    assert.deepEqual(parsed.mcp_servers.meu_server.args, ["meu-mcp.js"])
    // usuario vence em servidor de mesmo nome (supabase customizado preservado)
    assert.deepEqual(parsed.mcp_servers.supabase.args, ["custom-supabase", "--minha-flag"])
    // O hook do usuario e PRESERVADO; o do GStack e REMOVIDO. A confrontacao com
    // o binario do Codex 0.145.0 mostrou que aquelas chaves nunca existiram, e
    // limpar aqui alcanca quem ja instalou -- que so passa pelo merge.
    assert.ok(parsed.hooks.on_stop.includes("meu-hook-pessoal.sh"), "hook do usuario preservado")
    assert.equal(parsed.hooks.on_stop.some((c) => c.includes("stop.py")), false,
      "configuracao inerte e removida, nao reescrita")
    assert.ok(parsed.mcp_servers.fallow)
    assert.ok(parsed.mcp_servers.headroom)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("mergeCodexConfig DEFAULT (opt-out): NÃO escreve mcp_servers gstack; preserva os do usuário", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-codex-nomcp-"))
  try {
    const cfg = path.join(tmp, "config.toml")
    await writeFile(cfg, USER_CONFIG)
    const { mergeCodexConfig } = await import(`${pathToFileURL(codexModule)}?t=${Date.now()}`)
    mergeCodexConfig(cfg, { readImpl: read, writeImpl: write }) // sem mcp
    const parsed = parseToml(await readFile(cfg, "utf-8"))
    assert.equal(parsed.mcp_servers.fallow, undefined, "sem --global-mcp não injeta fallow")
    assert.equal(parsed.mcp_servers.context7, undefined)
    // servidores do usuário preservados; NENHUM hook gstack escrito
    assert.deepEqual(parsed.mcp_servers.meu_server.args, ["meu-mcp.js"])
    assert.equal(parsed.hooks.on_stop.some((c) => c.includes("stop.py")), false)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("mergeCodexConfig com mcpServers=['playwright']: escreve SÓ o playwright", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-codex-one-"))
  try {
    const cfg = path.join(tmp, "config.toml")
    const { mergeCodexConfig } = await import(`${pathToFileURL(codexModule)}?t=${Date.now()}`)
    mergeCodexConfig(cfg, { mcp: true, mcpServers: ["playwright"], readImpl: read, writeImpl: write })
    const parsed = parseToml(await readFile(cfg, "utf-8"))
    assert.ok(parsed.mcp_servers.playwright, "playwright presente")
    assert.equal(parsed.mcp_servers.supabase, undefined, "supabase placeholder NÃO escrito")
    assert.equal(parsed.mcp_servers.context7, undefined, "context7 placeholder NÃO escrito")
    assert.equal(parsed.mcp_servers.fallow, undefined)
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
    mergeCodexConfig(cfg, { mcp: true, readImpl: read, writeImpl: write })
    stripGstackFromCodexConfig(cfg, read, write)

    const parsed = parseToml(await readFile(cfg, "utf-8"))
    // config do usuario intacta
    assert.equal(parsed.model, "o3")
    assert.deepEqual(parsed.mcp_servers.meu_server.args, ["meu-mcp.js"])
    assert.deepEqual(parsed.mcp_servers.supabase.args, ["custom-supabase", "--minha-flag"])
    // chaves gstack removidas
    assert.equal(parsed.mcp_servers.fallow, undefined)
    assert.equal(parsed.mcp_servers.headroom, undefined)
    // hook do usuario em on_stop sobrevive ao strip; comando gstack removido
    assert.ok(parsed.hooks.on_stop.includes("meu-hook-pessoal.sh"), "hook do usuario preservado no strip")
    assert.ok(!parsed.hooks.on_stop.some((c) => c.includes("stop.py")), "comando gstack removido")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("mergeCodexConfig em arquivo inexistente escreve config gstack pura", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-codex-new-"))
  try {
    const cfg = path.join(tmp, "config.toml")
    const { mergeCodexConfig } = await import(`${pathToFileURL(codexModule)}?t=${Date.now()}`)
    mergeCodexConfig(cfg, { mcp: true, readImpl: read, writeImpl: write })
    const parsed = parseToml(await readFile(cfg, "utf-8"))
    // Arquivo novo: sem bloco de hook, porque o GStack nao o escreve mais.
    assert.equal("hooks" in parsed, false, "nenhuma configuracao inerte em config nova")
    assert.ok(parsed.mcp_servers.fallow)
    assert.ok(parsed.agent.skills_dir.includes(".agents/skills"))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
