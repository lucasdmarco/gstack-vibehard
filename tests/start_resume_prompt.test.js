import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.3 — DoD: após crash real, `start` encontra a sessão (não terminal) e mostra a
// última fase comprovada; duas sessões concorrentes não sobrescrevem estado (append-only).

test("start --dry-run --json: sem sessão nenhuma -> activeSession.hasActive:false", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-resume-none-"))
  try {
    const r = await startCommand(["--dry-run"], { cwd, objective: "app" })
    assert.equal(r.activeSession.hasActive, false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("start --dry-run --json: sessão INTERROMPIDA (waiting_user) real no State Store -> hasActive:true, mesma sessão", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const { openStateStore } = await imp("src/state/store.js")
  const { buildSessionRecord, sessionIdFor } = await imp("src/state/session-index.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-resume-active-"))
  try {
    const store = openStateStore(cwd)
    store.record("sessions", buildSessionRecord({
      sessionId: sessionIdFor("run-crashed"), runId: "run-crashed", planId: "plan-1",
      objective: "app interrompido por crash", status: "waiting_user",
    }))
    store.close()
    const r = await startCommand(["--dry-run"], { cwd, objective: "novo app" })
    assert.equal(r.activeSession.hasActive, true)
    assert.equal(r.activeSession.session.runId, "run-crashed")
    assert.equal(r.activeSession.session.status, "waiting_user", "última fase comprovada visível")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("duas sessões concorrentes (runIds diferentes) NUNCA se sobrescrevem — append-only real", async () => {
  const { openStateStore } = await imp("src/state/store.js")
  const { buildSessionRecord, sessionIdFor, listSessions } = await imp("src/state/session-index.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-resume-concurrent-"))
  try {
    const store = openStateStore(cwd)
    store.record("sessions", buildSessionRecord({ sessionId: sessionIdFor("run-a"), runId: "run-a", planId: "p-a", objective: "a", status: "running" }))
    store.record("sessions", buildSessionRecord({ sessionId: sessionIdFor("run-b"), runId: "run-b", planId: "p-b", objective: "b", status: "running" }))
    const sessions = listSessions(store, { limit: 20 })
    store.close()
    assert.equal(sessions.length, 2)
    assert.ok(sessions.some((s) => s.runId === "run-a"))
    assert.ok(sessions.some((s) => s.runId === "run-b"))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
