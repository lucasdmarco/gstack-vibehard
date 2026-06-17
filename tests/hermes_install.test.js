import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const hermesMod = path.join(repoRoot, "src", "harness", "hermes.js")
const detMod = path.join(repoRoot, "src", "harness", "detector.js")

function freshReport() { return { added: [], updated: [], skipped: [], errors: [] } }

test("installHermes: copia skills + AGENTS.md (filesystem garantido)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-hermes-"))
  try {
    const { installHermes } = await import(`${pathToFileURL(hermesMod)}?t=${Date.now()}`)
    const report = freshReport()
    await installHermes({ mcp: true, skills: true }, report, { home, projectRoot: repoRoot })
    const skillsDir = path.join(home, ".hermes", "skills")
    const agents = path.join(home, ".hermes", "AGENTS.md")
    assert.ok(existsSync(skillsDir) && readdirSync(skillsDir).length > 0, "skills copiadas")
    assert.match(readFileSync(agents, "utf-8"), /Quality Gate/, "guidance presente")
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("installHermes: config.yaml AUSENTE → cria com mcp_servers e enabled:false", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-hermes2-"))
  try {
    const { installHermes } = await import(`${pathToFileURL(hermesMod)}?t=${Date.now()}`)
    const report = freshReport()
    const r = await installHermes({ mcp: true }, report, { home, projectRoot: repoRoot })
    const cfg = path.join(home, ".hermes", "config.yaml")
    assert.ok(existsSync(cfg), "criou config.yaml")
    const yaml = readFileSync(cfg, "utf-8")
    assert.match(yaml, /^mcp_servers:/m)
    assert.match(yaml, /enabled: false/, "servidores desabilitados por segurança")
    // bate com os servidores reais do base.mcp.json
    const base = JSON.parse(readFileSync(path.join(repoRoot, "mcp-configs", "base.mcp.json"), "utf-8"))
    for (const name of Object.keys(base.mcpServers)) assert.ok(yaml.includes(`  ${name}:`), `${name} no config`)
    assert.equal(r.mcpConfig, "created")
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("installHermes: config.yaml EXISTENTE → NUNCA toca; gera snippet lateral", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-hermes3-"))
  try {
    await mkdir(path.join(home, ".hermes"), { recursive: true })
    const cfg = path.join(home, ".hermes", "config.yaml")
    const original = "model: hermes-4\nmcp_servers:\n  meu-oauth:\n    url: \"https://x\"\n    auth: \"oauth\"\n"
    await writeFile(cfg, original)
    const { installHermes } = await import(`${pathToFileURL(hermesMod)}?t=${Date.now()}`)
    const report = freshReport()
    const r = await installHermes({ mcp: true }, report, { home, projectRoot: repoRoot })
    // config.yaml do usuário INTACTO
    assert.equal(readFileSync(cfg, "utf-8"), original, "config.yaml preservado byte a byte")
    // snippet lateral gerado
    const snippet = path.join(home, ".hermes", "gstack-mcp-servers.yaml")
    assert.ok(existsSync(snippet), "snippet mergeável gerado")
    assert.match(readFileSync(snippet, "utf-8"), /mcp_servers:/)
    assert.equal(r.mcpConfig, "snippet")
    assert.ok(report.skipped.some((s) => /preservado/.test(s)))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("emitMcpServersYaml: escapa valores e fecha cada servidor com enabled:false", async () => {
  const { emitMcpServersYaml } = await import(`${pathToFileURL(hermesMod)}?t=${Date.now()}`)
  const y = emitMcpServersYaml({ x: { command: "cmd", args: ["a", "b"], env: { K: "${VAR}" } } })
  assert.match(y, /mcp_servers:/)
  assert.match(y, /command: "cmd"/)
  assert.match(y, /args: \["a", "b"\]/)
  assert.match(y, /K: "\$\{VAR\}"/)
  assert.match(y, /enabled: false/)
})

test("detector: hermes é detectado quando ~/.hermes existe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-hermes4-"))
  const prevHome = process.env.HOME, prevUP = process.env.USERPROFILE
  try {
    await mkdir(path.join(home, ".hermes"), { recursive: true })
    process.env.HOME = home; process.env.USERPROFILE = home
    const { detectHarnesses, getHarness } = await import(`${pathToFileURL(detMod)}?t=${Date.now()}`)
    assert.ok(detectHarnesses().some((h) => h.id === "hermes"))
    assert.equal(getHarness("hermes").label, "Hermes CLI (NousResearch)")
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevUP === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUP
    await rm(home, { recursive: true, force: true })
  }
})
