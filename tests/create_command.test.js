import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")

test("create scaffolds a complete omniharness workspace and keeps post-install failures non-blocking", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-create-"))
  try {
    const cwd = path.join(tmp, "workspace")
    await mkdir(cwd, { recursive: true })

    const commands = []
    const warnings = []
    const { createProject } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
    const result = await createProject({
      args: ["teste-app"],
      cwd,
      projectRoot: repoRoot,
      now: () => "2026-06-08T00:00:00.000Z",
      logger: {
        info: () => {},
        success: () => {},
        warn: (message) => warnings.push(message),
        error: () => {},
      },
      execSync: (cmd, options = {}) => {
        commands.push({ cmd, cwd: options.cwd })
        if (cmd.includes("agentmemory") || cmd.includes("graphify")) {
          throw new Error("offline")
        }
        return Buffer.from("ok")
      },
    })

    const appDir = path.join(cwd, "teste-app")
    assert.equal(result.projectDir, appDir)
    assert.equal(result.warnings.length >= 2, true)
    assert.equal(existsSync(path.join(appDir, "Dockerfile")), true)
    assert.equal(existsSync(path.join(appDir, ".dockerignore")), true)
    assert.equal(existsSync(path.join(appDir, "scripts", "dev.sh")), true)
    assert.equal(existsSync(path.join(appDir, "scripts", "workspace_manager.py")), true)
    assert.equal(existsSync(path.join(appDir, "scripts", "deep_research.py")), true)
    assert.equal(existsSync(path.join(appDir, "scripts", "team_builder.py")), true)
    assert.equal(existsSync(path.join(appDir, ".gstack", "app.json")), true)
    assert.equal(existsSync(path.join(appDir, ".gstack", "services.json")), true)
    assert.equal(existsSync(path.join(appDir, ".gstack", "secrets.schema.json")), true)
    assert.equal(existsSync(path.join(appDir, ".cursor", "rules", "gstack.mdc")), true)
    assert.equal(existsSync(path.join(appDir, ".windsurf", "rules", "gstack.md")), true)
    assert.equal(existsSync(path.join(appDir, ".clinerules")), true)
    assert.equal(existsSync(path.join(appDir, "AGENTS.md")), true)

    const app = JSON.parse(await readFile(path.join(appDir, ".gstack", "app.json"), "utf8"))
    assert.equal(app.name, "teste-app")
    assert.equal(app.runtime, "gstack-workspace")
    assert.equal(app.createdAt, "2026-06-08T00:00:00.000Z")

    const services = JSON.parse(await readFile(path.join(appDir, ".gstack", "services.json"), "utf8"))
    assert.deepEqual(services.services.map((service) => service.name), ["web", "api"])

    const mcp = JSON.parse(await readFile(path.join(appDir, ".mcp.json"), "utf8"))
    assert.equal(Boolean(mcp.mcpServers["agentmemory-graphify"]), true)
    assert.equal(Boolean(mcp.mcpServers.mom), true)
    assert.equal(Boolean(mcp.mcpServers.headroom), true)

    assert.deepEqual(commands, [
      { cmd: "npx @agentmemory/agentmemory connect claude", cwd: appDir },
      { cmd: "npx @agentmemory/agentmemory connect codex", cwd: appDir },
      { cmd: "npx @agentmemory/agentmemory connect cursor", cwd: appDir },
      { cmd: "npx @agentmemory/agentmemory connect windsurf", cwd: appDir },
      { cmd: "npx @agentmemory/agentmemory connect cline", cwd: appDir },
      { cmd: "npx @agentmemory/agentmemory connect opencode", cwd: appDir },
      { cmd: "npx graphify hook install", cwd: appDir },
    ])
    assert.equal(warnings.some((message) => message.includes("AgentMemory claude: offline")), true)
    assert.equal(warnings.some((message) => message.includes("Graphify git hooks: offline")), true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
