import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("contrato de eventos: 8 eventos normalizados + níveis fixos", async () => {
  const { EVENTS, EVENT_LEVELS } = await imp("src/harness/events.js")
  assert.deepEqual(EVENTS, ["session.start", "session.stop", "message.output", "tool.before", "tool.after", "mcp.call", "file.write", "command.exec"])
  assert.deepEqual(EVENT_LEVELS, ["enforced", "partial", "advisory", "unsupported"])
})

test("declarações: Claude/Cursor/OpenCode/Codex/Devin + instrucionais cobrem TODO o contrato", async () => {
  const { EVENTS, EVENT_DECLARATIONS } = await imp("src/harness/events.js")
  for (const h of ["claude", "cursor", "opencode", "codex", "devin", "gemini", "copilot", "windsurf", "kiro", "hermes"]) {
    const d = EVENT_DECLARATIONS[h]
    assert.ok(d, `declaração de ${h}`)
    assert.ok(d.target && d.residualRisk, `${h}: target + risco residual obrigatórios`)
    for (const e of EVENTS) assert.ok(d.events[e], `${h}: evento ${e} declarado`)
  }
  // instrucional NUNCA enforced
  for (const h of ["gemini", "copilot", "windsurf", "kiro", "codex"]) {
    assert.ok(!Object.values(EVENT_DECLARATIONS[h].events).includes("enforced"), `${h} não declara enforced`)
  }
  // claude (real_hooks) declara enforced no pre-tool
  assert.equal(EVENT_DECLARATIONS.claude.events["tool.before"], "enforced")
})

test("ledger: grava sanitizado — secrets redigidos, campos proibidos fora, truncado", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ev-"))
  try {
    const { recordHarnessEvent, readHarnessEvents, eventsPath } = await imp("src/harness/events.js")
    const rec = recordHarnessEvent(cwd, {
      event: "tool.before", harness: "claude",
      intent: "exec", target: "npm run build",
      // secret DEVE ser redigido
      note: "token=ghp_ABCDEF1234567890abcdef1234567890abcd fim",
      // campos proibidos DEVEM sumir por completo
      prompt: "system prompt inteiro do usuário",
      apikey: "sk-live-should-never-persist",
      // valor gigante DEVE ser truncado
      big: "x".repeat(1000),
    })
    assert.equal(rec.event, "tool.before")
    assert.equal(rec.intent, "exec")
    // proibidos ausentes
    assert.equal(rec.prompt, undefined)
    assert.equal(rec.apikey, undefined)
    // secret redigido, nunca em claro
    assert.ok(!/ghp_ABCDEF/.test(rec.note), "secret não pode aparecer em claro")
    assert.ok(rec.note.includes("REDACTED"))
    // truncado
    assert.ok(rec.big.length <= 320 && rec.big.includes("truncado"))

    // e nada disso vaza para o arquivo em disco
    const raw = await readFile(eventsPath(cwd), "utf-8")
    assert.ok(!raw.includes("ghp_ABCDEF"))
    assert.ok(!raw.includes("system prompt inteiro"))
    assert.ok(!raw.includes("sk-live-should-never-persist"))

    const back = readHarnessEvents(cwd, { limit: 10 })
    assert.equal(back.length, 1)
    assert.equal(back[0].intent, "exec")
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("ledger: evento fora do contrato é REJEITADO (não grava)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ev-"))
  try {
    const { recordHarnessEvent, readHarnessEvents } = await imp("src/harness/events.js")
    const rec = recordHarnessEvent(cwd, { event: "tool.sabotage", harness: "claude", intent: "x" })
    assert.equal(rec.error, "unknown_event")
    assert.deepEqual(readHarnessEvents(cwd), [], "evento inválido nunca é persistido")
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("ledger: --limit devolve só os N mais recentes, em ordem", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ev-"))
  try {
    const { recordHarnessEvent, readHarnessEvents } = await imp("src/harness/events.js")
    for (let i = 0; i < 5; i++) recordHarnessEvent(cwd, { event: "command.exec", harness: "claude", intent: `cmd${i}` })
    const last2 = readHarnessEvents(cwd, { limit: 2 })
    assert.equal(last2.length, 2)
    assert.deepEqual(last2.map((e) => e.intent), ["cmd3", "cmd4"])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
