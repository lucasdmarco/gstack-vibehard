import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.3 — Índice unificado de sessões sobre o State Store JÁ REAL (PRD14 §4.4).
// Um session id canônico; nenhuma cópia de transcript; refs quebradas são `stale`, nunca
// sucesso silencioso.

test("buildSessionRecord: status fora do enum tipado -> lança (sem meio-termo silencioso)", async () => {
  const { buildSessionRecord } = await imp("src/state/session-index.js")
  assert.throws(() => buildSessionRecord({ sessionId: "s1", runId: "r1", planId: "p1", objective: "x", status: "kinda_done" }), /status de sessão inválido/)
})

test("buildSessionRecord: session id canônico determinístico a partir do runId", async () => {
  const { sessionIdFor } = await imp("src/state/session-index.js")
  assert.equal(sessionIdFor("run-abc"), sessionIdFor("run-abc"))
  assert.notEqual(sessionIdFor("run-abc"), sessionIdFor("run-xyz"))
})

test("buildSessionRecord: objetivo truncado — nunca carrega transcript/journal inteiro", async () => {
  const { buildSessionRecord } = await imp("src/state/session-index.js")
  const huge = "x".repeat(5000)
  const r = buildSessionRecord({ sessionId: "s1", runId: "r1", planId: "p1", objective: huge, status: "running" })
  assert.ok(r.objective.length <= 500)
})

test("statusForSession: mapeia status do run-loop pro enum de sessão — 'done'->passed, 'handoff'->waiting_user, default->blocked (fail-closed)", async () => {
  const { statusForSession } = await imp("src/state/session-index.js")
  assert.equal(statusForSession("done"), "passed")
  assert.equal(statusForSession("handoff"), "waiting_user")
  assert.equal(statusForSession("cancelled"), "cancelled")
  assert.equal(statusForSession("algo-desconhecido"), "blocked", "nunca vira 'passed' por omissão")
})

test("activeSession: sessão mais recente NÃO terminal é a candidata a retomada", async () => {
  const { activeSession } = await imp("src/state/session-index.js")
  const sessions = [
    { sessionId: "s2", status: "passed", updatedAt: "2026-01-02T00:00:00Z" },
    { sessionId: "s1", status: "waiting_user", updatedAt: "2026-01-01T00:00:00Z" },
  ]
  const a = activeSession(sessions)
  assert.equal(a.sessionId, "s1")
})

test("activeSession: TODAS terminais -> null (nada a retomar, honesto)", async () => {
  const { activeSession } = await imp("src/state/session-index.js")
  assert.equal(activeSession([{ sessionId: "s1", status: "passed" }, { sessionId: "s2", status: "cancelled" }]), null)
})

test("activeSession: lista vazia -> null", async () => {
  const { activeSession } = await imp("src/state/session-index.js")
  assert.equal(activeSession([]), null)
})

test("refStatus: ref ausente -> 'absent'; ref presente mas arquivo sumiu -> 'stale' (NUNCA sucesso silencioso)", async () => {
  const { refStatus } = await imp("src/state/session-index.js")
  assert.equal(refStatus(null, () => true), "absent")
  assert.equal(refStatus("some/path.json", () => false), "stale")
  assert.equal(refStatus("some/path.json", () => true), "ok")
})

test("listSessions: usa o State Store real (openStateStore) — não duplica storage", async () => {
  const { listSessions } = await imp("src/state/session-index.js")
  const { openStateStore } = await imp("src/state/store.js")
  const { mkdtempSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-session-index-"))
  try {
    const store = openStateStore(dir, { forceJsonl: true })
    store.record("sessions", { sessionId: "s1", status: "running" })
    store.close()
    const store2 = openStateStore(dir, { forceJsonl: true })
    const sessions = listSessions(store2)
    store2.close()
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].sessionId, "s1")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
