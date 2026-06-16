import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const hermesMod = path.join(repoRoot, "src", "harness", "hermes.js")
const detMod = path.join(repoRoot, "src", "harness", "detector.js")

function freshReport() { return { added: [], updated: [], skipped: [], errors: [] } }

test("installHermes: copia skills + escreve AGENTS.md (filesystem garantido)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-hermes-"))
  try {
    const { installHermes } = await import(`${pathToFileURL(hermesMod)}?t=${Date.now()}`)
    const report = freshReport()
    // exec que simula hermes AUSENTE (--version lança) -> sem registro MCP
    const exec = () => { throw new Error("hermes not found") }
    const r = await installHermes({ mcp: true, skills: true }, report, { home, projectRoot: repoRoot, exec })

    const skillsDir = path.join(home, ".hermes", "skills")
    const agents = path.join(home, ".hermes", "AGENTS.md")
    assert.ok(existsSync(skillsDir), "criou ~/.hermes/skills")
    assert.ok(readdirSync(skillsDir).length > 0, "copiou ao menos uma skill")
    assert.ok(existsSync(agents), "escreveu AGENTS.md")
    assert.match(readFileSync(agents, "utf-8"), /Quality Gate/, "guidance instrucional presente")
    assert.equal(r.mcpRegistered, 0, "binario ausente -> nenhum MCP registrado")
    assert.ok(report.skipped.some((s) => /binario ausente/.test(s)))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("installHermes: hermes presente -> registra os MCP servers de base.mcp.json (idempotente)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-hermes2-"))
  try {
    const { installHermes } = await import(`${pathToFileURL(hermesMod)}?t=${Date.now()}`)
    const report = freshReport()
    const calls = []
    // exec que simula hermes PRESENTE: --version ok; mcp add registrado
    const exec = (file, argv) => {
      assert.equal(file, "hermes")
      if (argv[0] === "--version") return Buffer.from("hermes 1.0")
      calls.push(argv)
      return Buffer.from("")
    }
    const r = await installHermes({ mcp: true, skills: true }, report, { home, projectRoot: repoRoot, exec })

    assert.ok(r.mcpRegistered > 0, "registrou ao menos um MCP server")
    // todas as chamadas de registro seguem `mcp add <name> --command ...`
    for (const argv of calls) {
      assert.equal(argv[0], "mcp")
      assert.equal(argv[1], "add")
      assert.ok(argv.includes("--command"))
    }
    // bate com os servidores reais do base.mcp.json
    const base = JSON.parse(readFileSync(path.join(repoRoot, "mcp-configs", "base.mcp.json"), "utf-8"))
    assert.equal(r.mcpRegistered, Object.keys(base.mcpServers).length)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("detector: hermes é detectado quando ~/.hermes existe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-hermes3-"))
  const prevHome = process.env.HOME, prevUP = process.env.USERPROFILE
  try {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(path.join(home, ".hermes"), { recursive: true })
    process.env.HOME = home; process.env.USERPROFILE = home
    const { detectHarnesses, getHarness } = await import(`${pathToFileURL(detMod)}?t=${Date.now()}`)
    const found = detectHarnesses()
    assert.ok(found.some((h) => h.id === "hermes"), "hermes detectado via ~/.hermes")
    const h = getHarness("hermes")
    assert.equal(h.label, "Hermes CLI (NousResearch)")
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevUP === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUP
    await rm(home, { recursive: true, force: true })
  }
})
