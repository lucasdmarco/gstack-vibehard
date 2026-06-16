import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cardMod = path.join(repoRoot, "src", "a2a", "agent-card.js")
const cmdMod = path.join(repoRoot, "src", "commands", "a2a.js")

test("buildAgentCard: JSON válido com as 4 skills reais, sem servidor", async () => {
  const { buildAgentCard } = await import(`${pathToFileURL(cardMod)}?t=${Date.now()}`)
  const card = buildAgentCard()
  // serializa/parseia → JSON válido
  const round = JSON.parse(JSON.stringify(card))
  assert.equal(round.name, "gstack-vibehard")
  assert.equal(round.protocol, "a2a")
  assert.ok(round.url.startsWith("local://"), "offline — sem URL de servidor")
  assert.equal(round.capabilities.pushNotifications, false)
  const ids = round.skills.map((s) => s.id).sort()
  assert.deepEqual(ids, ["context.search", "delegate.opencode", "quality.gate", "workflow.run"])
})

test("a2a card: imprime JSON e não inicia servidor (sem efeito colateral)", async () => {
  const { a2aCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  // captura stdout
  const orig = process.stdout.write
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try {
    await a2aCommand(["card"])
  } finally {
    process.stdout.write = orig
  }
  const parsed = JSON.parse(buf)
  assert.equal(parsed.name, "gstack-vibehard")
  assert.equal(parsed.skills.length, 4)
})
