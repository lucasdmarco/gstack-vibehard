import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const repoRoot = path.resolve(import.meta.dirname, "..")
const buildScript = path.join(repoRoot, "scripts", "scripts", "build_agents.js")

test("build_agents generates isolated Claude, Codex and Cursor adapters", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gstack-build-agents-"))
  try {
    await mkdir(path.join(root, "core"), { recursive: true })
    await mkdir(path.join(root, "knowledge"), { recursive: true })
    await mkdir(path.join(root, "agents", "agents"), { recursive: true })

    await writeFile(path.join(root, "core", "01-regras-base.md"), "# Quality Gate\n\nRun deterministic checks before delivery.\n")
    await writeFile(path.join(root, "knowledge", "frontend.md"), "---\nid: frontend\ntags: frontend, react, ui, design\napplies_to: frontend-specialist\n---\n# Frontend\n\nUse accessible React patterns.\n")
    await writeFile(path.join(root, "knowledge", "deployer.md"), `---
id: deployer
agent: true
name: deployer
description: CLI-only deploy specialist for GitHub and Vercel.
tools: Bash, Read
model: inherit
tags: deploy, vercel, github
---

# Deployer

Use gh repo create and vercel --prod only after npx fallow audit --format json passes.
`)
    await writeFile(path.join(root, "agents", "agents", "frontend-specialist.md"), `---
name: frontend-specialist
description: Senior frontend specialist for React UI work.
tools: Read, Edit
model: inherit
skills: frontend-design, react
---

# Frontend Specialist

Build production-grade interfaces.
`)
    await writeFile(path.join(root, "agents", "agents", "backend-specialist.md"), `---
name: backend-specialist
description: Backend agent that mentions system design but is not frontend.
tools: Read, Edit
model: inherit
skills: api-patterns
---

# Backend Specialist

Use clear API design boundaries.
`)

    const result = spawnSync(process.execPath, [buildScript, "--root", root], {
      cwd: repoRoot,
      encoding: "utf8",
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)

    const claudeSkill = path.join(root, "agents", "generated", "claude", "frontend-specialist", "SKILL.md")
    const codexAgent = path.join(root, "agents", "generated", "codex", "frontend-specialist.toml")
    const cursorAgents = path.join(root, "agents", "generated", "cursor", "AGENTS.md")
    const cursorRule = path.join(root, "agents", "generated", "cursor", "rules", "frontend-specialist.mdc")
    const backendSkill = path.join(root, "agents", "generated", "claude", "backend-specialist", "SKILL.md")
    const deployerSkill = path.join(root, "agents", "generated", "claude", "deployer", "SKILL.md")
    const deployerCodex = path.join(root, "agents", "generated", "codex", "deployer.toml")

    assert.equal(existsSync(claudeSkill), true)
    assert.equal(existsSync(codexAgent), true)
    assert.equal(existsSync(cursorAgents), true)
    assert.equal(existsSync(cursorRule), true)
    assert.equal(existsSync(deployerSkill), true)
    assert.equal(existsSync(deployerCodex), true)

    const claudeText = await readFile(claudeSkill, "utf8")
    assert.match(claudeText, /name: frontend-specialist/)
    assert.match(claudeText, /Quality Gate/)
    assert.match(claudeText, /Use accessible React patterns/)

    const codexText = await readFile(codexAgent, "utf8")
    assert.match(codexText, /name = "frontend-specialist"/)
    assert.match(codexText, /instructions = """/)

    const cursorText = await readFile(cursorAgents, "utf8")
    assert.match(cursorText, /frontend-specialist/)

    const backendText = await readFile(backendSkill, "utf8")
    assert.doesNotMatch(backendText, /Use accessible React patterns/)

    const deployerText = await readFile(deployerSkill, "utf8")
    assert.match(deployerText, /gh repo create/)
    assert.match(deployerText, /vercel --prod/)
    assert.match(deployerText, /npx fallow audit --format json/)
    assert.equal((deployerText.match(/# Deployer/g) || []).length, 1)

    const generatedManifest = JSON.parse(await readFile(path.join(root, "agents", "generated", "manifest.json"), "utf8"))
    assert.equal(generatedManifest.agents, 3)
    // Manifest V2 (PRD 13 PR13.1): hashes da fonte + adapter versions + security verdict
    assert.equal(generatedManifest.schemaVersion, 2)
    assert.match(generatedManifest.source.coreHash, /^sha256:[0-9a-f]{64}$/)
    assert.match(generatedManifest.source.agentsHash, /^sha256:/)
    assert.ok(generatedManifest.compilerVersion)
    assert.ok(generatedManifest.adapters.claude && generatedManifest.security.verdict)
    // Execution Contract presente em TODO adapter gerado
    assert.match(claudeText, /## GStack Execution Contract/)
    assert.match(claudeText, /LLM cross-review is advisory only/)
    assert.match(codexText, /advisory only/)
    const cursorRuleText = await readFile(cursorRule, "utf8")
    assert.match(cursorRuleText, /treat the gate as blocked, not passed/)

    const checkResult = spawnSync(process.execPath, [buildScript, "--root", root, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
    assert.equal(checkResult.status, 0, checkResult.stderr || checkResult.stdout)

    // ABUSO: editar um adapter à mão → --check FALHA (drift guard)
    await writeFile(claudeSkill, claudeText + "\nEDITADO A MAO\n")
    const driftResult = spawnSync(process.execPath, [buildScript, "--root", root, "--check"], { cwd: repoRoot, encoding: "utf8" })
    assert.equal(driftResult.status, 1, "edição manual em generated deve falhar o --check")
    assert.match((driftResult.stderr || "") + (driftResult.stdout || ""), /desatualiz/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
