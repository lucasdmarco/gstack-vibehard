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
 * PRD51 S51.7.6 — restauração/uninstall REAL das projeções de hook de design.
 *
 * Achado que motivou o sub-sprint: `applyDesignHookProjections` (PRD49 S49.3)
 * chamava `versionedBackup()` antes de escrever, mas NADA no repo inteiro lia
 * ou restaurava desse backup, e `visual hooks` só expunha `install`/`status` —
 * não existia verbo de remoção. O cenário 14 do `rc-checklist-prd49.js` estava
 * honestamente marcado `not_executed` por causa disso.
 *
 * A invariante que estes testes travam é a disciplina "config sacred" do
 * projeto: arquivo COMPARTILHADO com o usuário nunca é apagado nem reescrito
 * fora da nossa parte; arquivo gstack-owned inteiro pode sumir. Round-trip
 * install -> uninstall tem que devolver o conteúdo humano BYTE A BYTE.
 */

const tmpProject = () => mkdtemp(path.join(tmpdir(), "gstack-hook-uninstall-"))
const cleanup = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })

const CLAUDE = [".claude", "settings.json"]
const COPILOT = [".github", "copilot-instructions.md"]
const CURSOR = [".cursor", "rules", "gstack-design-detector.mdc"]

test("removeMarkerBlock: complemento exato de mergeMarkerBlock — conteúdo humano volta BYTE A BYTE", async () => {
  const { mergeMarkerBlock, removeMarkerBlock, buildInstructionalDesignHookBlock } = await imp("src/harness/design-hooks.js")
  const original = "# Meu projeto\n\nRegras específicas do time aqui.\n"
  const withBlock = mergeMarkerBlock(original, buildInstructionalDesignHookBlock())
  assert.notEqual(withBlock, original, "o merge realmente mudou o arquivo")
  assert.equal(removeMarkerBlock(withBlock), original, "round-trip devolve o original byte a byte")
})

test("removeMarkerBlock: sem marcador presente devolve o original intacto (idempotente)", async () => {
  const { removeMarkerBlock } = await imp("src/harness/design-hooks.js")
  const humano = "# Nada nosso aqui\n\ntexto do usuário\n"
  assert.equal(removeMarkerBlock(humano), humano)
  assert.equal(removeMarkerBlock(removeMarkerBlock(humano)), humano)
})

test("round-trip REAL: install -> uninstall preserva conteúdo humano dos 3 arquivos COMPARTILHADOS", async () => {
  const { applyDesignHookProjections, removeDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    const agents = "# Meu projeto\n\nRegras específicas do time aqui.\n"
    const copilot = "# Instruções do time\n\nnada a ver com design.\n"
    const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }] }, someUserKey: 42 }
    await mkdir(path.join(dir, ".claude"), { recursive: true })
    await mkdir(path.join(dir, ".github"), { recursive: true })
    await writeFile(path.join(dir, "AGENTS.md"), agents)
    await writeFile(path.join(dir, ...COPILOT), copilot)
    await writeFile(path.join(dir, ...CLAUDE), JSON.stringify(settings, null, 2) + "\n")

    applyDesignHookProjections(dir)
    const out = removeDesignHookProjections(dir)
    assert.equal(out.schemaVersion, "gstack.design-hook-projection.v1")
    assert.equal(out.ok, true)

    assert.equal(await readFile(path.join(dir, "AGENTS.md"), "utf-8"), agents, "AGENTS.md humano byte a byte")
    assert.equal(await readFile(path.join(dir, ...COPILOT), "utf-8"), copilot, "copilot-instructions humano byte a byte")
    const after = JSON.parse(readFileSync(path.join(dir, ...CLAUDE), "utf-8"))
    assert.deepEqual(after.hooks.PreToolUse, settings.hooks.PreToolUse, "hook do usuário intocado")
    assert.equal(after.someUserKey, 42, "chave arbitrária do usuário preservada")
    assert.equal(after.hooks.PostToolUse, undefined, "container vazio some — nenhum lixo nosso fica")
  } finally { await cleanup(dir) }
})

test("uninstall: arquivo gstack-owned inteiro (.mdc do Cursor) é APAGADO", async () => {
  const { applyDesignHookProjections, removeDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    applyDesignHookProjections(dir)
    assert.ok(existsSync(path.join(dir, ...CURSOR)), "install criou a regra")
    const out = removeDesignHookProjections(dir)
    assert.equal(existsSync(path.join(dir, ...CURSOR)), false, "regra gstack-owned removida")
    assert.equal(out.results.find((r) => r.harness === "cursor").action, "removed_file")
  } finally { await cleanup(dir) }
})

test("uninstall em projeto VIRGEM (install criou os arquivos): estado volta ao anterior — nenhum arquivo nosso sobra", async () => {
  const { applyDesignHookProjections, removeDesignHookProjections, designHookStatus } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    applyDesignHookProjections(dir)
    assert.ok(designHookStatus(dir).every((r) => r.installed === true))
    removeDesignHookProjections(dir)
    assert.ok(designHookStatus(dir).every((r) => r.installed === false), "status reflete a remoção real")
    assert.equal(existsSync(path.join(dir, "AGENTS.md")), false, "arquivo que só existia por nossa causa some")
    assert.equal(existsSync(path.join(dir, ...COPILOT)), false)
    assert.equal(existsSync(path.join(dir, ...CLAUDE)), false, "settings.json que sobrou `{}` some")
  } finally { await cleanup(dir) }
})

test("uninstall é IDEMPOTENTE: rodar 2x não falha e não muda nada na segunda", async () => {
  const { applyDesignHookProjections, removeDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    applyDesignHookProjections(dir)
    removeDesignHookProjections(dir)
    const second = removeDesignHookProjections(dir)
    assert.equal(second.ok, true)
    assert.ok(second.results.every((r) => r.action === "not_installed"), "segunda passada não acha nada pra remover")
  } finally { await cleanup(dir) }
})

test("uninstall em projeto que NUNCA instalou: no-op honesto, nunca toca arquivo do usuário", async () => {
  const { removeDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    const alheio = "# AGENTS.md do usuário, sem nada do gstack\n"
    await writeFile(path.join(dir, "AGENTS.md"), alheio)
    const out = removeDesignHookProjections(dir)
    assert.equal(out.ok, true)
    assert.ok(out.results.every((r) => r.action === "not_installed"))
    assert.equal(await readFile(path.join(dir, "AGENTS.md"), "utf-8"), alheio, "arquivo sem marcador nunca é tocado")
  } finally { await cleanup(dir) }
})

test("CONTROLE NEGATIVO: settings.json MALFORMADO -> aborta sem mutação (não apaga config do usuário)", async () => {
  const { removeProjectClaudeHook } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    await mkdir(path.join(dir, ".claude"), { recursive: true })
    const malformed = "{ isso nao e json valido"
    await writeFile(path.join(dir, ...CLAUDE), malformed)
    const r = removeProjectClaudeHook(dir)
    assert.equal(r.ok, false)
    assert.equal(r.reason, "malformed_json_abort_no_mutation")
    assert.equal(await readFile(path.join(dir, ...CLAUDE), "utf-8"), malformed, "arquivo malformado nunca é tocado nem apagado")
  } finally { await cleanup(dir) }
})

test("CONTROLE NEGATIVO: settings.json com hooks de outro dono e NENHUM nosso -> not_installed, nada reescrito", async () => {
  const { removeProjectClaudeHook } = await imp("src/harness/design-hooks.js")
  const dir = await tmpProject()
  try {
    await mkdir(path.join(dir, ".claude"), { recursive: true })
    const alheio = JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "outra-ferramenta --check" }] }] } }, null, 2) + "\n"
    await writeFile(path.join(dir, ...CLAUDE), alheio)
    const r = removeProjectClaudeHook(dir)
    assert.equal(r.action, "not_installed")
    assert.equal(await readFile(path.join(dir, ...CLAUDE), "utf-8"), alheio, "hook de terceiro no MESMO evento sobrevive intacto")
  } finally { await cleanup(dir) }
})

test("CONTROLE NEGATIVO: uninstall NUNCA escreve/apaga fora do projectRoot informado", async () => {
  const { applyDesignHookProjections, removeDesignHookProjections } = await imp("src/harness/design-hooks.js")
  const outer = await tmpProject()
  const inner = path.join(outer, "project")
  try {
    await mkdir(inner, { recursive: true })
    await writeFile(path.join(outer, "AGENTS.md"), "# do pai, intocável\n")
    applyDesignHookProjections(inner)
    removeDesignHookProjections(inner)
    assert.equal(await readFile(path.join(outer, "AGENTS.md"), "utf-8"), "# do pai, intocável\n")
    assert.equal(existsSync(path.join(inner, "AGENTS.md")), false)
  } finally { await cleanup(outer) }
})

async function captureStdout(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await fn() } finally { process.stdout.write = orig }
  return out.trim().split("\n").pop()
}

// CLI real — mesmo gate de consentimento do install (remover também mexe em config).
test("CLI: `visual hooks uninstall --json --yes` remove de verdade e o status reflete", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = await tmpProject()
  try {
    await captureStdout(() => visualCommand(["hooks", "install", "--json", "--yes"], { cwd: dir }))
    const out = JSON.parse(await captureStdout(() => visualCommand(["hooks", "uninstall", "--json", "--yes"], { cwd: dir })))
    assert.equal(out.ok, true)
    const status = JSON.parse(await captureStdout(() => visualCommand(["hooks", "status", "--json"], { cwd: dir })))
    assert.ok(status.results.every((r) => r.installed === false))
  } finally { await cleanup(dir) }
})

test("CLI: `visual hooks uninstall` SEM --yes (não-interativo) -> recusa honesta, nada removido", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = await tmpProject()
  try {
    await captureStdout(() => visualCommand(["hooks", "install", "--json", "--yes"], { cwd: dir }))
    const out = JSON.parse(await captureStdout(() => visualCommand(["hooks", "uninstall", "--json"], { cwd: dir })))
    assert.equal(out.error, "needs_confirmation")
    assert.ok(existsSync(path.join(dir, ...CURSOR)), "nada removido sem consentimento")
  } finally { await cleanup(dir) }
})

test("CLI: usuário RECUSA no prompt de uninstall (confirm injetado) -> cancelado, projeções intactas", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = await tmpProject()
  try {
    await captureStdout(() => visualCommand(["hooks", "install", "--json", "--yes"], { cwd: dir }))
    const out = JSON.parse(await captureStdout(() => visualCommand(["hooks", "uninstall", "--json"], { cwd: dir, confirm: async () => false })))
    assert.equal(out.cancelled, true)
    assert.ok(existsSync(path.join(dir, "AGENTS.md")), "recusa não remove nada")
  } finally { await cleanup(dir) }
})

test("CLI: verbo desconhecido em `visual hooks` não executa remoção acidental", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const dir = await tmpProject()
  try {
    await captureStdout(() => visualCommand(["hooks", "install", "--json", "--yes"], { cwd: dir }))
    await captureStdout(() => visualCommand(["hooks", "remove", "--json", "--yes"], { cwd: dir }))
    assert.ok(existsSync(path.join(dir, ...CURSOR)), "verbo inválido nunca remove")
  } finally { process.exitCode = 0; await cleanup(dir) }
})
