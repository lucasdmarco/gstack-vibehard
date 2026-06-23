import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "installer", "agent-distribution.js")
const { npxArgv } = await import(`${pathToFileURL(path.join(repoRoot, "src", "installer", "deps.js"))}`)
// comando npx resolvido p/ a plataforma atual (Windows → `cmd.exe /c npx ...`)
const connectCmd = (h) => { const { file, argv } = npxArgv(["@agentmemory/agentmemory", "connect", h]); return [file, ...argv].join(" ") }

test("installs generated agents into detected harnesses and writes manifest", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-agent-distribution-"))
  try {
    const projectRoot = path.join(tmp, "pkg")
    const home = path.join(tmp, "home")
    const cwd = path.join(tmp, "project")
    await mkdir(path.join(projectRoot, "agents", "generated", "claude", "deployer"), { recursive: true })
    await mkdir(path.join(projectRoot, "agents", "generated", "codex"), { recursive: true })
    await mkdir(path.join(projectRoot, "agents", "generated", "cursor", "rules"), { recursive: true })
    await mkdir(path.join(home, ".claude"), { recursive: true })
    await mkdir(path.join(home, ".codex"), { recursive: true })
    await mkdir(path.join(home, ".opencode"), { recursive: true })
    await mkdir(path.join(cwd, ".cursor"), { recursive: true })

    await writeFile(path.join(projectRoot, "agents", "generated", "claude", "deployer", "SKILL.md"), "# Deployer\n")
    await writeFile(path.join(projectRoot, "agents", "generated", "codex", "deployer.toml"), "name = \"deployer\"\n")
    await writeFile(path.join(projectRoot, "agents", "generated", "cursor", "AGENTS.md"), "# Cursor Agents\n")
    await writeFile(path.join(projectRoot, "agents", "generated", "cursor", "rules", "deployer.mdc"), "# Deployer Cursor\n")

    const commands = []
    const { installGeneratedAgentLayer } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
    const report = { added: [], updated: [], skipped: [], errors: [] }
    const result = await installGeneratedAgentLayer({
      projectRoot,
      home,
      cwd,
      report,
      info: () => {},
      success: () => {},
      warn: () => {},
      exec: (file, args) => {
        const cmd = [file, ...args].join(" ")
        commands.push(cmd)
        if (cmd.includes("connect opencode")) throw new Error("offline")
        return Buffer.from("ok")
      },
      now: () => "2026-06-08T00:00:00.000Z",
    })

    assert.deepEqual(result.detectedHarnesses.map((h) => h.id).sort(), ["claude", "codex", "cursor", "opencode"])
    assert.equal(existsSync(path.join(home, ".claude", "agents", "gstack-vibehard", "deployer", "SKILL.md")), true)
    assert.equal(existsSync(path.join(home, ".codex", "agents", "gstack-vibehard", "deployer.toml")), true)
    assert.equal(existsSync(path.join(cwd, ".cursor", "agents", "gstack-vibehard", "AGENTS.md")), true)
    assert.equal(existsSync(path.join(home, ".opencode", "agents", "gstack-vibehard", "rules", "deployer.mdc")), true)
    assert.deepEqual(commands, ["claude", "codex", "cursor", "opencode"].map(connectCmd))

    const manifestPath = path.join(home, ".gstack_vibehard", "install-manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifest.version, 1)
    assert.equal(manifest.generatedAgents.source.endsWith(path.join("agents", "generated")), true)
    assert.equal(manifest.agentmemory.claude.status, "success")
    assert.equal(manifest.agentmemory.opencode.status, "warning")
    assert.equal(manifest.agentDirectories.claude.endsWith(path.join(".claude", "agents", "gstack-vibehard")), true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("respects selected harness ids", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-agent-selection-"))
  try {
    const projectRoot = path.join(tmp, "pkg")
    const home = path.join(tmp, "home")
    const cwd = path.join(tmp, "project")
    await mkdir(path.join(projectRoot, "agents", "generated", "claude", "deployer"), { recursive: true })
    await mkdir(path.join(projectRoot, "agents", "generated", "codex"), { recursive: true })
    await mkdir(path.join(projectRoot, "agents", "generated", "cursor", "rules"), { recursive: true })
    await mkdir(path.join(home, ".claude"), { recursive: true })
    await mkdir(path.join(home, ".codex"), { recursive: true })
    await mkdir(path.join(cwd, ".cursor"), { recursive: true })

    await writeFile(path.join(projectRoot, "agents", "generated", "claude", "deployer", "SKILL.md"), "# Deployer\n")
    await writeFile(path.join(projectRoot, "agents", "generated", "codex", "deployer.toml"), "name = \"deployer\"\n")
    await writeFile(path.join(projectRoot, "agents", "generated", "cursor", "AGENTS.md"), "# Cursor Agents\n")

    const commands = []
    const { installGeneratedAgentLayer } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
    const result = await installGeneratedAgentLayer({
      projectRoot,
      home,
      cwd,
      harnessIds: ["claude", "cursor"],
      info: () => {},
      success: () => {},
      warn: () => {},
      exec: (file, args) => {
        commands.push([file, ...args].join(" "))
        return Buffer.from("ok")
      },
    })

    assert.deepEqual(result.detectedHarnesses.map((h) => h.id), ["claude", "cursor"])
    assert.equal(existsSync(path.join(home, ".claude", "agents", "gstack-vibehard", "deployer", "SKILL.md")), true)
    assert.equal(existsSync(path.join(home, ".codex", "agents", "gstack-vibehard", "deployer.toml")), false)
    assert.deepEqual(commands, ["claude", "cursor"].map(connectCmd))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("keeps generated agent copy failures non-blocking", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-agent-copy-failure-"))
  try {
    const projectRoot = path.join(tmp, "pkg")
    const home = path.join(tmp, "home")
    await mkdir(path.join(projectRoot, "agents", "generated", "claude", "deployer"), { recursive: true })
    await mkdir(path.join(projectRoot, "agents", "generated", "codex"), { recursive: true })
    await mkdir(path.join(home, ".claude"), { recursive: true })
    await mkdir(path.join(home, ".codex"), { recursive: true })
    await writeFile(path.join(projectRoot, "agents", "generated", "claude", "deployer", "SKILL.md"), "# Deployer\n")
    await writeFile(path.join(projectRoot, "agents", "generated", "codex", "deployer.toml"), "name = \"deployer\"\n")

    const commands = []
    const report = { added: [], updated: [], skipped: [], errors: [] }
    const { installGeneratedAgentLayer } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
    const result = await installGeneratedAgentLayer({
      projectRoot,
      home,
      report,
      harnessIds: ["claude", "codex"],
      info: () => {},
      success: () => {},
      warn: () => {},
      exec: (file, args) => {
        commands.push([file, ...args].join(" "))
        return Buffer.from("ok")
      },
      copyDir: (_src, dst) => {
        if (dst.includes(`${path.sep}.codex${path.sep}`)) throw new Error("permission denied")
        mkdirSync(dst, { recursive: true })
      },
    })

    assert.equal(result.agentDirectories.claude.endsWith(path.join(".claude", "agents", "gstack-vibehard")), true)
    assert.equal(result.agentDirectories.codex, undefined)
    assert.deepEqual(commands, [connectCmd("claude")])
    assert.equal(report.errors.some((item) => item.includes("generated agents: codex: permission denied")), true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("does not detect Cursor from CLI alone", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-agent-cursor-cli-"))
  try {
    const projectRoot = path.join(tmp, "pkg")
    const home = path.join(tmp, "home")
    const cwd = path.join(tmp, "project")
    await mkdir(path.join(projectRoot, "agents", "generated", "cursor", "rules"), { recursive: true })
    await mkdir(home, { recursive: true })
    await mkdir(cwd, { recursive: true })
    await writeFile(path.join(projectRoot, "agents", "generated", "cursor", "AGENTS.md"), "# Cursor Agents\n")

    const { installGeneratedAgentLayer } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
    const result = await installGeneratedAgentLayer({
      projectRoot,
      home,
      cwd,
      info: () => {},
      success: () => {},
      warn: () => {},
      exec: (file, args) => {
        if ([file, ...args].join(" ") === "cursor --version") return Buffer.from("ok")
        throw new Error("not found")
      },
    })

    assert.equal(result.detectedHarnesses.some((h) => h.id === "cursor"), false)
    assert.equal(existsSync(path.join(cwd, ".cursor")), false)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("installs Graphify git hooks only inside git projects", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-graphify-hook-"))
  try {
    const repo = path.join(tmp, "repo")
    const noGit = path.join(tmp, "no-git")
    await mkdir(path.join(repo, ".git"), { recursive: true })
    await mkdir(noGit, { recursive: true })

    const commands = []
    const report = { added: [], updated: [], skipped: [], errors: [] }
    const { installGraphifyGitHooks } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)

    const installed = installGraphifyGitHooks({
      cwd: repo,
      report,
      success: () => {},
      warn: () => {},
      info: () => {},
      exec: (file, args, options) => {
        commands.push({ cmd: [file, ...args].join(" "), cwd: options.cwd })
        return Buffer.from("ok")
      },
    })
    const skipped = installGraphifyGitHooks({
      cwd: noGit,
      report,
      success: () => {},
      warn: () => {},
      info: () => {},
      exec: (file, args, options) => {
        commands.push({ cmd: [file, ...args].join(" "), cwd: options.cwd })
        return Buffer.from("unexpected")
      },
    })

    assert.equal(installed.status, "success")
    assert.equal(skipped.status, "skipped")
    const gfx = npxArgv(["graphify", "hook", "install"])
    assert.deepEqual(commands, [{ cmd: [gfx.file, ...gfx.argv].join(" "), cwd: repo }])
    assert.equal(report.updated.includes("Graphify git hooks"), true)
    assert.equal(report.skipped.includes("Graphify git hooks: sem .git"), true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("keeps Graphify git hook install failures non-blocking", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-graphify-hook-failure-"))
  try {
    const repo = path.join(tmp, "repo")
    await mkdir(path.join(repo, ".git"), { recursive: true })

    const warnings = []
    const report = { added: [], updated: [], skipped: [], errors: [] }
    const { installGraphifyGitHooks } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
    const result = installGraphifyGitHooks({
      cwd: repo,
      report,
      success: () => {},
      warn: (message) => warnings.push(message),
      info: () => {},
      exec: () => {
        throw new Error("npx missing")
      },
    })

    assert.equal(result.status, "warning")
    assert.equal(warnings.some((message) => message.includes("Graphify git hooks: npx missing")), true)
    assert.equal(report.errors.some((message) => message.includes("Graphify git hooks: npx missing")), true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
