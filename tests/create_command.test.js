import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")

test("create scaffolds with 5-phase DAG boot (Casdoor, Atomic, Daemons, Omniharness, Scaffold)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-create-"))
  try {
    const cwd = path.join(tmp, "workspace")
    await mkdir(cwd, { recursive: true })

    const commands = []
    process.env.GSTACK_SKIP_PREFLIGHT = "1"
    // Sem side-effects externos (npx/docker/git): teste hermético, sem handles
    // presos no projectDir → evita EBUSY na limpeza no Windows.
    process.env.GSTACK_SKIP_SIDE_EFFECTS = "1"
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
        return Buffer.from("ok")
      },
    })

    const appDir = path.join(cwd, "teste-app")
    assert.equal(result.projectDir, appDir)

    // Phase 1: Casdoor IAM config
    assert.equal(existsSync(path.join(appDir, ".gstack", "casdoor.json")), true)
    const casdoorConfig = JSON.parse(await readFile(path.join(appDir, ".gstack", "casdoor.json"), "utf8"))
    assert.equal(casdoorConfig.endpoint, "http://localhost:8000")
    assert.equal(casdoorConfig.iamMode, "local-sqlite")

    // Phase 2: Atomic VCS
    assert.equal(existsSync(path.join(appDir, ".atomicignore")), true)
    assert.equal(existsSync(path.join(appDir, ".atomic", "workspace.toml")), true)

    // Phase 3: Control Plane & Memory
    assert.equal(existsSync(path.join(appDir, ".gstack", "control-plane.yaml")), true)
    const cpYaml = await readFile(path.join(appDir, ".gstack", "control-plane.yaml"), "utf8")
    assert.match(cpYaml, /daemon:/)
    assert.match(cpYaml, /dashboard: true/)
    assert.match(cpYaml, /sessions: true/)

    assert.equal(existsSync(path.join(appDir, ".gstack", "federation.toml")), true)
    const fedToml = await readFile(path.join(appDir, ".gstack", "federation.toml"), "utf8")
    assert.match(fedToml, /\[mesh\]/)
    assert.match(fedToml, /hybrid = \["bm25", "vector", "graph"\]/)

    // Phase 4: Omniharness — skills dir + AGENTS.md
    assert.equal(existsSync(path.join(appDir, ".claude", "skills", "superpowers-cycle.md")), true)
    assert.equal(existsSync(path.join(appDir, ".claude", "skills", "quality-gate.md")), true)

    // Phase 5: MCP Gateway (Casdoor + Headroom, no Permit.io)
    assert.equal(existsSync(path.join(appDir, ".mcp.json")), true)
    const mcp = JSON.parse(await readFile(path.join(appDir, ".mcp.json"), "utf8"))
    assert.equal(Boolean(mcp.mcpServers["casdoor-gateway"]), true)
    assert.equal(mcp.mcpServers["casdoor-gateway"].args[0], "exec")
    // No Permit.io or direct connections
    assert.equal(mcp.mcpServers["permit-gateway"], undefined)
    assert.equal(mcp.mcpServers["supabase"], undefined)
    assert.equal(mcp.mcpServers["composio"], undefined)

    // Phase 5: Ticket Orchestration
    assert.equal(existsSync(path.join(appDir, "paperclip.toml")), true)
    const paperclip = await readFile(path.join(appDir, "paperclip.toml"), "utf8")
    assert.match(paperclip, /orchestrator = "paperclip"/)
    assert.match(paperclip, /auto_fixable = true/)
    assert.equal(existsSync(path.join(appDir, "symphony.yml")), true)

    // app.json metadata
    const app = JSON.parse(await readFile(path.join(appDir, ".gstack", "app.json"), "utf8"))
    assert.equal(app.controlPlane, "ecc2")
    assert.equal(app.mcpGateway, "casdoor")
    assert.equal(app.meshFederation, true)
    assert.equal(app.ticketOrchestration, "paperclip")
    assert.equal(app.iam, "casdoor-local")

    // AGENTS.md documents the stack
    const agents = await readFile(path.join(appDir, "AGENTS.md"), "utf8")
    assert.match(agents, /Casdoor/)
    assert.match(agents, /Control Plane/)
    assert.match(agents, /Mesh Federation/)
    assert.match(agents, /Omniharness/)
    assert.match(agents, /auto_fixable/)

    // Core scaffold still works
    assert.equal(existsSync(path.join(appDir, "Dockerfile")), true)
    assert.equal(existsSync(path.join(appDir, ".gstack", "services.json")), true)
    assert.equal(existsSync(path.join(appDir, ".claude", "teams", "supervisor.json")), true)
    assert.equal(existsSync(path.join(appDir, ".claude", "teams", "pipeline.json")), true)
    assert.equal(existsSync(path.join(appDir, ".claude", "teams", "producer-reviewer.json")), true)
    assert.equal(existsSync(path.join(appDir, ".claude", "teams", "validator.json")), true)
  } finally {
    delete process.env.GSTACK_SKIP_PREFLIGHT
    delete process.env.GSTACK_SKIP_SIDE_EFFECTS
    // maxRetries/retryDelay: defesa extra contra EBUSY/EPERM transitório no Windows.
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
