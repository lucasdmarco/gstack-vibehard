import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.3 — projeções de hook PROJECT-LOCAL (nunca globais). Escopo
 * recalibrado após revisão de design: cada harness recebe exatamente o
 * mecanismo que REALMENTE tem hoje (src/harness/events.js/adapter-matrix.js):
 *   - Claude: hook real (PostToolUse, advisory — tool.after já é "advisory")
 *   - Codex + OpenCode: bloco instrucional compartilhado em AGENTS.md
 *     (ambos leem AGENTS.md; nenhum tem API de hook project-local real)
 *   - Copilot: bloco instrucional em .github/copilot-instructions.md
 *   - Cursor: regra .mdc project-local (rules_only, mesmo formato já usado
 *     em agents/generated/cursor/rules/*.mdc)
 * NADA bloqueia (todos advisory/instructional) — nenhum destes mecanismos é
 * enforcement real além do que já está documentado por harness.
 */

async function tmpProject() {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-design-hooks-"))
  return dir
}

test("applyDesignHookProjections: projeto vazio -> cria os 4 artefatos project-local", async () => {
  const { applyDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    const result = applyDesignHookProjections(dir)
    assert.equal(result.schemaVersion, "gstack.design-hook-projection.v1")
    assert.equal(result.ok, true)
    assert.ok(existsSync(path.join(dir, ".claude", "settings.json")))
    assert.ok(existsSync(path.join(dir, "AGENTS.md")))
    assert.ok(existsSync(path.join(dir, ".github", "copilot-instructions.md")))
    assert.ok(existsSync(path.join(dir, ".cursor", "rules", "gstack-design-detector.mdc")))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectClaudeHook: sem settings.json -> cria com hook PostToolUse advisory (nunca bloqueia)", async () => {
  const { projectClaudeHook } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    const r = projectClaudeHook(dir)
    assert.equal(r.ok, true)
    assert.equal(r.action, "created")
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf-8"))
    assert.ok(Array.isArray(settings.hooks.PostToolUse))
    const cmd = settings.hooks.PostToolUse[0].hooks[0].command
    assert.match(cmd, /visual detect/)
    assert.ok(!/--force|--yes\b/.test(cmd), "nunca implicit --force")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectClaudeHook: settings.json existente com hooks de OUTRO evento -> preservado byte-for-byte", async () => {
  const { projectClaudeHook } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    await mkdir(path.join(dir, ".claude"), { recursive: true })
    const existing = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }] }, someUserKey: 42 }
    await writeFile(path.join(dir, ".claude", "settings.json"), JSON.stringify(existing, null, 2))
    const r = projectClaudeHook(dir)
    assert.equal(r.ok, true)
    assert.equal(r.action, "merged")
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf-8"))
    assert.deepEqual(settings.hooks.PreToolUse, existing.hooks.PreToolUse, "hook do usuário intocado")
    assert.equal(settings.someUserKey, 42, "chave arbitrária do usuário preservada")
    assert.ok(Array.isArray(settings.hooks.PostToolUse))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectClaudeHook: idempotente -- rodar 2x não duplica a entrada gstack", async () => {
  const { projectClaudeHook } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    projectClaudeHook(dir)
    projectClaudeHook(dir)
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf-8"))
    assert.equal(settings.hooks.PostToolUse.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectClaudeHook: settings.json malformado -> ABORTA sem mutação (nunca implicit --force)", async () => {
  const { projectClaudeHook } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    await mkdir(path.join(dir, ".claude"), { recursive: true })
    const malformed = "{ isso nao e json valido"
    await writeFile(path.join(dir, ".claude", "settings.json"), malformed)
    const r = projectClaudeHook(dir)
    assert.equal(r.ok, false)
    assert.equal(r.reason, "malformed_json_abort_no_mutation")
    const onDisk = await readFile(path.join(dir, ".claude", "settings.json"), "utf-8")
    assert.equal(onDisk, malformed, "arquivo malformado nunca é tocado")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectAgentsMdBlock: AGENTS.md existente com conteúdo do usuário -> preservado fora dos marcadores", async () => {
  const { projectAgentsMdBlock } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    const userContent = "# Meu projeto\n\nRegras específicas do time aqui.\n"
    await writeFile(path.join(dir, "AGENTS.md"), userContent)
    const r = projectAgentsMdBlock(dir)
    assert.equal(r.ok, true)
    assert.equal(r.action, "merged")
    const content = await readFile(path.join(dir, "AGENTS.md"), "utf-8")
    assert.ok(content.startsWith(userContent.trimEnd()), "conteúdo do usuário preservado no topo")
    assert.match(content, /gstack_vibehard:design-hooks:begin/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectAgentsMdBlock: idempotente -- rodar 2x substitui o MESMO bloco, não duplica", async () => {
  const { projectAgentsMdBlock } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    projectAgentsMdBlock(dir)
    projectAgentsMdBlock(dir)
    const content = await readFile(path.join(dir, "AGENTS.md"), "utf-8")
    const occurrences = content.split("gstack_vibehard:design-hooks:begin").length - 1
    assert.equal(occurrences, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectCopilotInstructions: cria .github/copilot-instructions.md preservando conteúdo prévio", async () => {
  const { projectCopilotInstructions } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    await mkdir(path.join(dir, ".github"), { recursive: true })
    await writeFile(path.join(dir, ".github", "copilot-instructions.md"), "# Instruções do time\n")
    const r = projectCopilotInstructions(dir)
    assert.equal(r.ok, true)
    const content = await readFile(path.join(dir, ".github", "copilot-instructions.md"), "utf-8")
    assert.match(content, /Instruções do time/)
    assert.match(content, /gstack_vibehard:design-hooks:begin/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("projectCursorRule: cria .cursor/rules/gstack-design-detector.mdc, determinístico entre chamadas", async () => {
  const { projectCursorRule } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    const r1 = projectCursorRule(dir)
    const content1 = await readFile(path.join(dir, ".cursor", "rules", "gstack-design-detector.mdc"), "utf-8")
    const r2 = projectCursorRule(dir)
    const content2 = await readFile(path.join(dir, ".cursor", "rules", "gstack-design-detector.mdc"), "utf-8")
    assert.equal(r1.ok, true)
    assert.equal(content1, content2, "conteúdo gerado é determinístico")
    assert.match(content1, /alwaysApply: false/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("designHookStatus: read-only -- NUNCA escreve no filesystem", async () => {
  const { designHookStatus } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    const before = designHookStatus(dir)
    assert.ok(before.every((r) => r.installed === false))
    assert.ok(!existsSync(path.join(dir, ".claude")), "status nunca cria diretórios")
    assert.ok(!existsSync(path.join(dir, "AGENTS.md")), "status nunca cria AGENTS.md")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("designHookStatus: reflete instalação real após applyDesignHookProjections", async () => {
  const { applyDesignHookProjections, designHookStatus } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    applyDesignHookProjections(dir)
    const after = designHookStatus(dir)
    assert.ok(after.every((r) => r.installed === true))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

async function captureStdout(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await fn() } finally { process.stdout.write = orig }
  return out.trim().split("\n").pop()
}

test("CLI visual hooks status --json: projeto vazio -> todos installed:false", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = await tmpProject()
  try {
    const out = await captureStdout(() => visualCommand(["hooks", "status", "--json"], { cwd: dir }))
    const parsed = JSON.parse(out)
    assert.ok(parsed.results.every((r) => r.installed === false))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("CLI visual hooks install --json depois status --json: reflete instalação real", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = await tmpProject()
  try {
    const installOut = JSON.parse(await captureStdout(() => visualCommand(["hooks", "install", "--json"], { cwd: dir })))
    assert.equal(installOut.ok, true)
    const statusOut = JSON.parse(await captureStdout(() => visualCommand(["hooks", "status", "--json"], { cwd: dir })))
    assert.ok(statusOut.results.every((r) => r.installed === true))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("CONTROLE NEGATIVO: applyDesignHookProjections NUNCA escreve fora do projectRoot informado", async () => {
  const { applyDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const outer = await tmpProject()
  const inner = path.join(outer, "project")
  await mkdir(inner, { recursive: true })
  try {
    applyDesignHookProjections(inner)
    assert.ok(!existsSync(path.join(outer, "AGENTS.md")), "nada vaza para o diretório pai")
    assert.ok(!existsSync(path.join(outer, ".claude")))
    assert.ok(existsSync(path.join(inner, "AGENTS.md")))
  } finally { await rm(outer, { recursive: true, force: true }) }
})
