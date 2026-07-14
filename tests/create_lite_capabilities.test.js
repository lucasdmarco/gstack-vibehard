import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD42 S42.0A — Capability Truth do modo LITE. O create Lite NÃO pode materializar
// capacidades exclusivas do Full: Casdoor/Headroom (MCP), OpenHands (sandbox) nem a
// orquestração de tickets (paperclip/symphony). Contrato Lite = projeto isolado, sem
// escrita global, sem backend externo. Cada asserção tem CONTROLE NEGATIVO no Full.

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")
const silent = { info: () => {}, success: () => {}, warn: () => {}, error: () => {} }

async function scaffold(cwd, args) {
  const { createProject } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
  return createProject({ args, cwd, projectRoot: repoRoot, now: () => "2026-07-13T00:00:00.000Z",
    logger: silent, execSync: () => Buffer.from("ok") })
}

test("LITE não materializa Casdoor/Headroom (.mcp.json), OpenHands (sandbox) nem paperclip", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-lite-cap-"))
  process.env.GSTACK_SKIP_PREFLIGHT = "1"; process.env.GSTACK_SKIP_SIDE_EFFECTS = "1"
  try {
    const cwd = path.join(tmp, "ws"); await mkdir(cwd, { recursive: true })
    await scaffold(cwd, ["app-lite"])
    const appDir = path.join(cwd, "app-lite")

    // Casdoor/Headroom NÃO podem aparecer no .mcp.json (nem via arquivo presente).
    const mcpPath = path.join(appDir, ".mcp.json")
    if (existsSync(mcpPath)) {
      const mcp = JSON.parse(await readFile(mcpPath, "utf8"))
      const servers = mcp.mcpServers || {}
      assert.equal(Boolean(servers["casdoor-gateway"]), false, "Lite não pode declarar casdoor-gateway")
      assert.equal(Boolean(servers.headroom), false, "Lite não pode declarar headroom")
    }

    // Orquestração de tickets (paperclip/symphony) é capacidade Full.
    assert.equal(existsSync(path.join(appDir, "paperclip.toml")), false, "Lite não escreve paperclip.toml")
    assert.equal(existsSync(path.join(appDir, "symphony.yml")), false, "Lite não escreve symphony.yml")

    // app.json não pode declarar sandbox OpenHands nem ticketOrchestration em Lite.
    const app = JSON.parse(await readFile(path.join(appDir, ".gstack", "app.json"), "utf8"))
    assert.notEqual(app.sandbox, "openhands", "Lite não declara sandbox OpenHands")
    assert.equal(app.sandbox, "none", "Lite declara sandbox=none (excluído honesto)")
    assert.equal(app.ticketOrchestration, null, "Lite não declara ticketOrchestration")
  } finally {
    delete process.env.GSTACK_SKIP_PREFLIGHT; delete process.env.GSTACK_SKIP_SIDE_EFFECTS
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test("CONTROLE NEGATIVO — FULL materializa Casdoor/Headroom, OpenHands e paperclip", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-full-cap-"))
  process.env.GSTACK_SKIP_PREFLIGHT = "1"; process.env.GSTACK_SKIP_SIDE_EFFECTS = "1"
  try {
    const cwd = path.join(tmp, "ws"); await mkdir(cwd, { recursive: true })
    await scaffold(cwd, ["app-full", "--full"])
    const appDir = path.join(cwd, "app-full")

    const mcp = JSON.parse(await readFile(path.join(appDir, ".mcp.json"), "utf8"))
    assert.equal(Boolean(mcp.mcpServers["casdoor-gateway"]), true, "Full declara casdoor-gateway")
    assert.equal(Boolean(mcp.mcpServers.headroom), true, "Full declara headroom")
    assert.equal(existsSync(path.join(appDir, "paperclip.toml")), true, "Full escreve paperclip.toml")

    const app = JSON.parse(await readFile(path.join(appDir, ".gstack", "app.json"), "utf8"))
    assert.equal(app.sandbox, "openhands", "Full declara sandbox OpenHands")
    assert.equal(app.ticketOrchestration, "paperclip", "Full declara ticketOrchestration")
  } finally {
    delete process.env.GSTACK_SKIP_PREFLIGHT; delete process.env.GSTACK_SKIP_SIDE_EFFECTS
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
