import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const invMod = path.join(repoRoot, "src", "mcp", "inventory.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

const FAKE_TOKEN = "ghp_" + "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"
const FAKE_STRIPE = "sk_live_" + "X".repeat(24)

/** Monta um HOME/projeto falsos com configs MCP dos 4 leitores. */
async function mkFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-home-"))
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-proj-"))

  // claude: ~/.mcp.json com segredo em env VALUE e em arg inline
  await writeFile(path.join(home, ".mcp.json"), JSON.stringify({
    mcpServers: {
      github: { command: "npx", args: ["-y", "@github/mcp", "--token", FAKE_TOKEN], env: { GH_TOKEN: FAKE_TOKEN } },
      playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
    },
  }))
  // claude: ~/.claude.json duplica playwright (fragmentação intra-harness)
  await writeFile(path.join(home, ".claude.json"), JSON.stringify({
    mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp"] } },
  }))
  // codex: config.toml com env de credencial
  await mkdir(path.join(home, ".codex"), { recursive: true })
  await writeFile(path.join(home, ".codex", "config.toml"), [
    "[mcp_servers.supabase]",
    'command = "npx"',
    'args = ["-y", "@supabase/mcp-server"]',
    "[mcp_servers.supabase.env]",
    `SUPABASE_ACCESS_TOKEN = "${FAKE_STRIPE}"`,
  ].join("\n"))
  // opencode: JSONC com comentários (leitor precisa tolerar)
  await mkdir(path.join(home, ".config", "opencode"), { recursive: true })
  await writeFile(path.join(home, ".config", "opencode", "opencode.jsonc"), [
    "{",
    "  // servidores MCP do opencode",
    '  "mcp": {',
    '    "playwright": { "type": "local", "command": ["npx", "-y", "@playwright/mcp"] } /* duplicado */',
    "  }",
    "}",
  ].join("\n"))
  // projeto: .mcp.json com URL contendo credencial embutida
  await writeFile(path.join(cwd, ".mcp.json"), JSON.stringify({
    mcpServers: { "pp-stripe": { url: `https://user:${FAKE_STRIPE}@mcp.example.com/sse` } },
  }))
  return { home, cwd }
}

test("mcp inventory: agrega os 4 leitores, detecta fragmentação e NUNCA vaza segredo", async () => {
  const { home, cwd } = await mkFixture()
  try {
    const { buildMcpInventory } = await imp(invMod)
    const inv = buildMcpInventory({ home, cwd })

    assert.equal(inv.schemaVersion, "gstack.mcp.v1")
    assert.equal(inv.aggregates.serverCount, 6, "github + 2x playwright(claude) + supabase + playwright(opencode) + pp-stripe(projeto)")
    assert.equal(inv.aggregates.harnessCount, 4, "claude, codex, opencode, project")

    // fragmentação: playwright em 3 fontes (2 do claude + 1 do opencode)
    const frag = inv.fragmentation.find((f) => f.name === "playwright")
    assert.ok(frag, "playwright duplicado detectado")
    assert.equal(frag.count, 3)
    assert.ok(frag.harnesses.includes("claude") && frag.harnesses.includes("opencode"))
    assert.equal(inv.aggregates.duplicateServerCount, 1)

    // secrets: github (env+inline), supabase (env), pp-stripe (url) = 3
    assert.equal(inv.aggregates.serversWithSecrets, 3)
    const gh = inv.servers.find((s) => s.name === "github")
    assert.deepEqual(gh.envKeys, ["GH_TOKEN"], "só o NOME da env sai")
    assert.deepEqual(gh.secretEnvKeys, ["GH_TOKEN"])
    assert.ok(gh.hasInlineSecret, "token no arg detectado")

    // invariante absoluto: NENHUM valor de segredo no JSON inteiro
    const flat = JSON.stringify(inv)
    assert.ok(!flat.includes(FAKE_TOKEN.slice(4)), "token do github não vaza")
    assert.ok(!flat.includes(FAKE_STRIPE.slice(8)), "chave stripe não vaza")
    assert.match(flat, /\*\*\*REDACTED\*\*\*/, "segredo inline aparece redigido")
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

test("mcp inventory: config ausente não quebra (máquina limpa = inventário vazio)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-empty-"))
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-empty-proj-"))
  try {
    const { buildMcpInventory } = await imp(invMod)
    const inv = buildMcpInventory({ home, cwd })
    assert.equal(inv.aggregates.serverCount, 0)
    assert.equal(inv.fragmentation.length, 0)
    assert.ok(inv.sources.every((s) => s.exists === false), "todas as fontes reportadas como ausentes")
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

test("mcp inventory: config INVÁLIDA vira valid:false com erro resumido (nunca crash)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-bad-"))
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-bad-proj-"))
  try {
    await writeFile(path.join(home, ".mcp.json"), "{ nao é json ")
    await mkdir(path.join(home, ".codex"), { recursive: true })
    await writeFile(path.join(home, ".codex", "config.toml"), "[[[toml quebrado")
    const { buildMcpInventory } = await imp(invMod)
    const inv = buildMcpInventory({ home, cwd })
    const badJson = inv.sources.find((s) => s.path.endsWith(".mcp.json") && s.harness === "claude")
    const badToml = inv.sources.find((s) => s.path.endsWith("config.toml"))
    assert.equal(badJson.valid, false)
    assert.ok(badJson.error, "erro resumido presente")
    assert.equal(badToml.valid, false)
    assert.equal(inv.aggregates.serverCount, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})

test("stripJsonComments: preserva // e /* dentro de strings", async () => {
  const { stripJsonComments } = await imp(path.join(repoRoot, "src", "mcp", "readers", "opencode.js"))
  const src = '{ "url": "https://x/a//b", /* c */ "a": 1 // fim\n}'
  const parsed = JSON.parse(stripJsonComments(src))
  assert.equal(parsed.url, "https://x/a//b", "URL com // intacta")
  assert.equal(parsed.a, 1)
})

test("mcp inventory: BOM no JSON não quebra o leitor (Windows/PowerShell)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-bom-"))
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mcpinv-bom-proj-"))
  try {
    await writeFile(path.join(home, ".mcp.json"), "﻿" + JSON.stringify({ mcpServers: { fallow: { command: "npx", args: ["-y", "fallow", "mcp"] } } }))
    const { buildMcpInventory } = await imp(invMod)
    const inv = buildMcpInventory({ home, cwd })
    assert.equal(inv.servers.filter((s) => s.name === "fallow").length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})
