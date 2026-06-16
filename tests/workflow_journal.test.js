import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const jMod = path.join(repoRoot, "src", "workflow-graph", "journal.js")
const sMod = path.join(repoRoot, "src", "workflow-graph", "schema.js")

test("journal: append + replay detecta journal_hit em no concluido", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-jrnl-"))
  try {
    const { appendEvent, isJournalHit, completedNodes, runStats } = await import(`${pathToFileURL(jMod)}?t=${Date.now()}`)
    const base = path.join(tmp, "runs")
    appendEvent(base, "run1", { event: "run_started" })
    appendEvent(base, "run1", { event: "node_started", nodeId: "planner" })
    appendEvent(base, "run1", { event: "node_completed", nodeId: "planner" })
    appendEvent(base, "run1", { event: "node_failed", nodeId: "verifier" })

    assert.equal(isJournalHit(base, "run1", "planner"), true, "planner concluido -> hit")
    assert.equal(isJournalHit(base, "run1", "verifier"), false, "verifier falhou -> nao hit")
    assert.deepEqual([...completedNodes(base, "run1")], ["planner"])
    const stats = runStats(base, "run1")
    assert.equal(stats.completed, 1)
    assert.equal(stats.failed, 1)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("journal: nunca persiste secret/transcript", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-jrnl-sec-"))
  try {
    const { appendEvent, readJournal } = await import(`${pathToFileURL(jMod)}?t=${Date.now()}`)
    const base = path.join(tmp, "runs")
    appendEvent(base, "r", { event: "node_completed", nodeId: "x", secret: "API_KEY", transcript: "huge..." })
    const evs = readJournal(base, "r")
    assert.equal(evs[0].secret, undefined)
    assert.equal(evs[0].transcript, undefined)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("schema: valida grafo (arestas referenciam nos existentes)", async () => {
  const { makeNode, makeEdge, validateGraph } = await import(`${pathToFileURL(sMod)}?t=${Date.now()}`)
  const good = {
    nodes: [makeNode("a", "planner"), makeNode("b", "verifier")],
    edges: [makeEdge("a", "b", "tests_passed")],
  }
  assert.equal(validateGraph(good).valid, true)
  const bad = { nodes: [makeNode("a", "planner")], edges: [makeEdge("a", "z", "x")] }
  assert.equal(validateGraph(bad).valid, false)
})
