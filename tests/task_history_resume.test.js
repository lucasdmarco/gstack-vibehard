import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.3 — `task history`/`task inspect`: mesma verdade operacional do State Store
// real (não duplica). Refs quebradas aparecem `stale`, nunca sucesso silencioso.

test("taskCommand history --json: lista sessões reais do State Store, mais recente primeiro", async () => {
  const { taskCommand } = await imp("src/commands/task.js")
  const { openStateStore } = await imp("src/state/store.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-task-history-"))
  try {
    const store = openStateStore(dir)
    store.record("sessions", { sessionId: "s1", runId: "r1", planId: "p1", objective: "primeira", status: "passed" })
    store.record("sessions", { sessionId: "s2", runId: "r2", planId: "p2", objective: "segunda", status: "waiting_user" })
    store.close()
    const chunks = []
    const orig = process.stdout.write
    process.stdout.write = (s) => { chunks.push(s); return true }
    try { await taskCommand(["history", "--json"], { cwd: dir }) } finally { process.stdout.write = orig }
    const out = JSON.parse(chunks.join(""))
    assert.equal(out.sessions.length, 2)
    assert.equal(out.sessions[0].sessionId, "s2", "mais recente primeiro")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("taskCommand inspect <sessionId> --json: mostra a sessão + status de refs (stale se arquivo sumiu)", async () => {
  const { taskCommand } = await imp("src/commands/task.js")
  const { openStateStore } = await imp("src/state/store.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-task-inspect-"))
  try {
    const store = openStateStore(dir)
    store.record("sessions", { sessionId: "s1", runId: "r1", planId: "p1", objective: "x", status: "blocked", proofRef: "/caminho/inexistente/status.json" })
    store.close()
    const chunks = []
    const orig = process.stdout.write
    process.stdout.write = (s) => { chunks.push(s); return true }
    try { await taskCommand(["inspect", "s1", "--json"], { cwd: dir }) } finally { process.stdout.write = orig }
    const out = JSON.parse(chunks.join(""))
    assert.equal(out.session.sessionId, "s1")
    assert.equal(out.refs.proofRef, "stale", "ref quebrada nunca é sucesso silencioso")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("taskCommand inspect <sessionId inexistente> --json: erro honesto, não crash", async () => {
  const { taskCommand } = await imp("src/commands/task.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-task-inspect-missing-"))
  try {
    const chunks = []
    const orig = process.stdout.write
    process.stdout.write = (s) => { chunks.push(s); return true }
    try { await taskCommand(["inspect", "id-que-nao-existe", "--json"], { cwd: dir }) } finally { process.stdout.write = orig }
    const out = JSON.parse(chunks.join(""))
    assert.equal(out.error, "session_not_found")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
