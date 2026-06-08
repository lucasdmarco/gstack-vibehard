import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")

test("create scaffolds with Control Plane, MCP Gateway, Mesh Federation, and Ticket Orchestration", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-create-"))
  try {
    const cwd = path.join(tmp, "workspace")
    await mkdir(cwd, { recursive: true })

    const commands = []
    process.env.GSTACK_SKIP_PREFLIGHT = "1"
    const { createProject } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
    const result = await createProject({
      args: ["teste-app"],
      cwd,
      projectRoot: repoRoot,
      now: () => "2026-06-08T00:00:00.000Z",
      logger: {
        info: () => {},
        success: () => {},
        warn: () => {},
        error: () => {},
      },
      execSync: (cmd, options = {}) => {
        commands.push({ cmd, cwd: options.cwd })
        if (cmd.includes("atomic init") || cmd.includes("ecc2") || cmd.includes("agentmemory") || cmd.includes("agent-hooks") || cmd.includes("graphify")) {
          return Buffer.from("ok")
        }
        return Buffer.from("ok")
      },
    })

    const appDir = path.join(cwd, "teste-app")
    assert.equal(result.projectDir, appDir)

    // Pillar 1: Control Plane
    assert.equal(existsSync(path.join(appDir, ".gstack", "control-plane.yaml")), true)
    const cpYaml = await readFile(path.join(appDir, ".gstack", "control-plane.yaml"), "utf8")
    assert.match(cpYaml, /daemon:/)
    assert.match(cpYaml, /dashboard: true/)
    assert.match(cpYaml, /sessions: true/)

    // Pillar 2: MCP Gateway
    assert.equal(existsSync(path.join(appDir, ".mcp.json")), true)
    const mcp = JSON.parse(await readFile(path.join(appDir, ".mcp.json"), "utf8"))
    assert.equal(Boolean(mcp.mcpServers["permit-gateway"]), true)
    assert.equal(mcp.mcpServers["permit-gateway"].args[0], "-y")
    assert.equal(mcp.mcpServers["permit-gateway"].args[1], "@permitio/mcp-gateway")
    // No direct connections remain
    assert.equal(mcp.mcpServers["supabase"], undefined)
    assert.equal(mcp.mcpServers["composio"], undefined)

    // Pillar 3: Mesh Federation
    assert.equal(existsSync(path.join(appDir, ".gstack", "federation.toml")), true)
    const fedToml = await readFile(path.join(appDir, ".gstack", "federation.toml"), "utf8")
    assert.match(fedToml, /\[mesh\]/)
    assert.match(fedToml, /hybrid = \["bm25", "vector", "graph"\]/)

    // Pillar 4: Ticket Orchestration
    assert.equal(existsSync(path.join(appDir, "paperclip.toml")), true)
    const paperclip = await readFile(path.join(appDir, "paperclip.toml"), "utf8")
    assert.match(paperclip, /orchestrator = "paperclip"/)
    assert.match(paperclip, /provider = "jira"/)
    assert.equal(existsSync(path.join(appDir, "symphony.yml")), true)

    // app.json metadata
    const app = JSON.parse(await readFile(path.join(appDir, ".gstack", "app.json"), "utf8"))
    assert.equal(app.controlPlane, "ecc2")
    assert.equal(app.mcpGateway, "permitio")
    assert.equal(app.meshFederation, true)
    assert.equal(app.ticketOrchestration, "paperclip")

    // AGENTS.md documents the pillars
    const agents = await readFile(path.join(appDir, "AGENTS.md"), "utf8")
    assert.match(agents, /Control Plane/)
    assert.match(agents, /MCP Gateway/)
    assert.match(agents, /Mesh Federation/)
    assert.match(agents, /Ticket Orchestration/)

    // Core scaffold still works
    assert.equal(existsSync(path.join(appDir, "Dockerfile")), true)
    assert.equal(existsSync(path.join(appDir, ".gstack", "services.json")), true)
    assert.equal(existsSync(path.join(appDir, ".claude", "teams", "supervisor.json")), true)
    assert.equal(existsSync(path.join(appDir, ".atomicignore")), true)
  } finally {
    delete process.env.GSTACK_SKIP_PREFLIGHT
    await rm(tmp, { recursive: true, force: true })
  }
})
