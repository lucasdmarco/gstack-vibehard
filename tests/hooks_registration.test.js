import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const claudeModule = path.join(repoRoot, "src", "harness", "claude.js")
const cursorModule = path.join(repoRoot, "src", "harness", "cursor.js")

test("registerClaudeHooks escreve formato real de hooks no settings.json", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-claude-hooks-"))
  try {
    const settingsPath = path.join(tmp, "settings.json")
    const { registerClaudeHooks } = await import(`${pathToFileURL(claudeModule)}?t=${Date.now()}`)
    const report = { added: [], updated: [], skipped: [], errors: [] }

    registerClaudeHooks(report, path.join(tmp, "hooks"), settingsPath)

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"))
    // Formato oficial: hooks.<Evento> = [{ matcher?, hooks: [{type, command, timeout}] }]
    assert.ok(Array.isArray(settings.hooks.PreToolUse))
    assert.equal(settings.hooks.PreToolUse[0].matcher, "Write|Edit|Bash")
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].type, "command")
    assert.ok(settings.hooks.PreToolUse[0].hooks[0].command.includes("pre_tool_use_security.py"))
    assert.ok(Array.isArray(settings.hooks.Stop))
    assert.ok(settings.hooks.Stop[0].hooks[0].command.includes("stop.py"))
    assert.ok(settings.hooks.SessionStart[0].hooks[0].command.includes("session_start.py"))
    assert.ok(settings.hooks.UserPromptSubmit[0].hooks[0].command.includes("user_prompt_submit.py"))
    // PostToolUse REAL (PRD36 36.2): roteador incremental, matcher Write|Edit
    assert.ok(Array.isArray(settings.hooks.PostToolUse), "PostToolUse registrado")
    assert.equal(settings.hooks.PostToolUse[0].matcher, "Write|Edit")
    assert.ok(settings.hooks.PostToolUse[0].hooks[0].command.includes("post_tool_use_review.py"))
    // Nunca a chave ficticia
    assert.equal(settings.lifecycleHooks, undefined)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("registerClaudeHooks e idempotente e preserva hooks do usuario", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-claude-hooks-idem-"))
  try {
    const settingsPath = path.join(tmp, "settings.json")
    const userSettings = {
      model: "opus",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "meu-hook-pessoal.sh" }] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(userSettings))

    const { registerClaudeHooks } = await import(`${pathToFileURL(claudeModule)}?t=${Date.now()}`)
    const report = { added: [], updated: [], skipped: [], errors: [] }
    registerClaudeHooks(report, path.join(tmp, "hooks"), settingsPath)
    registerClaudeHooks(report, path.join(tmp, "hooks"), settingsPath) // 2x = idempotente

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"))
    assert.equal(settings.model, "opus")
    const preToolUse = settings.hooks.PreToolUse
    const userEntries = preToolUse.filter((e) => e.hooks.some((h) => h.command.includes("meu-hook-pessoal")))
    const gstackEntries = preToolUse.filter((e) => e.hooks.some((h) => h.command.includes("pre_tool_use_security.py")))
    assert.equal(userEntries.length, 1, "hook do usuario preservado")
    assert.equal(gstackEntries.length, 1, "registro gstack nao duplicado")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("registerCursorHooks escreve formato oficial version 1 e preserva config", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-cursor-hooks-"))
  try {
    const hooksJsonPath = path.join(tmp, "hooks.json")
    await writeFile(hooksJsonPath, JSON.stringify({
      version: 1,
      hooks: { stop: [{ command: "meu-audit.sh" }] },
    }))

    const { registerCursorHooks } = await import(`${pathToFileURL(cursorModule)}?t=${Date.now()}`)
    const report = { added: [], updated: [], skipped: [], errors: [] }
    registerCursorHooks(report, path.join(tmp, "hooks"), hooksJsonPath)
    registerCursorHooks(report, path.join(tmp, "hooks"), hooksJsonPath) // idempotente

    const config = JSON.parse(await readFile(hooksJsonPath, "utf-8"))
    assert.equal(config.version, 1)
    const stopCommands = config.hooks.stop.map((h) => h.command)
    assert.ok(stopCommands.some((c) => c.includes("meu-audit.sh")), "hook do usuario preservado")
    assert.equal(stopCommands.filter((c) => c.includes("stop.py")).length, 1, "gstack nao duplicado")
    assert.ok(config.hooks.beforeShellExecution.some((h) => h.command.includes("pre_tool_use_security.py")))
    assert.ok(config.hooks.sessionStart.some((h) => h.command.includes("session_start.py")))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
