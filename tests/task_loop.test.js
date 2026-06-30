import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "project-plan", "task-loop.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

function harness(over = {}) {
  const events = []
  const stateCalls = []
  const accepted = []
  const rejected = []
  const base = {
    steps: [{ id: "s1" }, { id: "s2" }],
    journal: (e) => events.push(e),
    setStep: (id, st) => stateCalls.push(`${id}:${st}`),
    makeWorktree: (s) => ({ dir: `/wt/${s.id}`, branch: `task/${s.id}` }),
    applyStep: () => {},
    captureDiff: () => "diff --git a b\n+ console.log(1)\n",
    hygiene: () => ({ blocked: false, findings: [] }),
    accept: (s) => accepted.push(s.id),
    reject: (s, _wt, reason) => rejected.push(`${s.id}:${reason}`),
  }
  return { opts: { ...base, ...over }, events, stateCalls, accepted, rejected }
}

test("happy path: todos os passos aplicam limpo → accept; sem auto-merge (branch registrado)", async () => {
  const { runTaskLoop } = await imp()
  const h = harness()
  const r = runTaskLoop(h.opts)
  assert.equal(r.status, "done")
  assert.deepEqual(r.accepted, ["s1", "s2"])
  assert.deepEqual(h.accepted, ["s1", "s2"])
  assert.ok(h.events.some((e) => e.event === "step_accepted" && e.branch === "task/s1"))
  assert.ok(h.stateCalls.includes("s1:completed"))
})

// ── ABUSO: diff-hygiene bloqueia (segredo/debugger no diff) → needs_review, NÃO aceita ──
test("hygiene bloqueia → reject (needs_review), não chama accept", async () => {
  const { runTaskLoop } = await imp()
  const h = harness({ hygiene: () => ({ blocked: true, findings: [{ id: "secret" }] }) })
  const r = runTaskLoop(h.opts)
  assert.equal(h.accepted.length, 0, "nada é aceito com hygiene bloqueada")
  assert.ok(h.rejected.includes("s1:hygiene"))
  assert.ok(h.stateCalls.includes("s1:needs_review"))
  assert.equal(r.rejected.length, 2)
})

// ── ABUSO: journal NUNCA recebe o diff bruto/segredo/comando ──
test("journal só guarda resumo (stepId/evento/branch/ids) — nunca o diff bruto", async () => {
  const { runTaskLoop } = await imp()
  const h = harness({
    captureDiff: () => "SUPER_SECRET_TOKEN=abc123 in the diff",
    hygiene: () => ({ blocked: true, findings: [{ id: "secret" }] }),
  })
  runTaskLoop(h.opts)
  const dump = JSON.stringify(h.events)
  assert.ok(!dump.includes("SUPER_SECRET_TOKEN"), "o diff/segredo nunca vai pro journal")
  assert.ok(!dump.includes("abc123"))
})

// ── ABUSO: circuit breaker — N falhas consecutivas → handoff humano ──
test("circuit breaker: maxConsecutiveSameFailure falhas → handoff, para o loop", async () => {
  const { runTaskLoop } = await imp()
  const h = harness({
    steps: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
    applyStep: () => { throw new Error("boom") },
    budget: { maxConsecutiveSameFailure: 2 },
  })
  const r = runTaskLoop(h.opts)
  assert.equal(r.status, "handoff")
  assert.equal(r.handoff.reason, "sameFailureLimit")
  assert.equal(r.iterations, 2, "parou após 2 falhas (não rodou s3/s4)")
  assert.ok(h.events.some((e) => e.event === "handoff"))
})

test("circuit breaker reseta no accept (falha, sucesso, falha não dispara)", async () => {
  const { runTaskLoop } = await imp()
  let n = 0
  const h = harness({
    steps: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
    applyStep: () => { if (++n === 2) return; throw new Error("x") }, // s1 falha, s2 ok, s3 falha
    budget: { maxConsecutiveSameFailure: 2 },
  })
  const r = runTaskLoop(h.opts)
  assert.equal(r.status, "done", "accept no meio reseta o contador → sem handoff")
  assert.deepEqual(r.accepted, ["s2"])
})

// ── replay: passos já concluídos são pulados (journal_hit) ──
test("replay: completedSteps são pulados (journal_hit), não re-executados", async () => {
  const { runTaskLoop } = await imp()
  const applied = []
  const h = harness({ completedSteps: ["s1"], applyStep: (s) => applied.push(s.id) })
  const r = runTaskLoop(h.opts)
  assert.deepEqual(r.skipped, ["s1"])
  assert.deepEqual(applied, ["s2"], "s1 não re-executa")
  assert.ok(h.events.some((e) => e.event === "journal_hit" && e.stepId === "s1"))
})

// ── hard cap de iterações → handoff ──
test("maxIterations → handoff antes de exceder o cap", async () => {
  const { runTaskLoop } = await imp()
  const h = harness({ steps: [{ id: "s1" }, { id: "s2" }, { id: "s3" }], budget: { maxIterations: 2 } })
  const r = runTaskLoop(h.opts)
  assert.equal(r.status, "handoff")
  assert.equal(r.handoff.reason, "maxIterations")
  assert.equal(r.accepted.length, 2)
})
