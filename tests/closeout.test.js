import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtempSync(path.join(tmpdir(), p))

test("buildCloseout: schema + campos; renderCloseoutMarkdown resume", async () => {
  const { buildCloseout, renderCloseoutMarkdown } = await imp("src/skills/closeout.js")
  const c = buildCloseout({ runId: "r1", command: "start", status: "done", changed: ["a.js", "b.js"] })
  assert.equal(c.schemaVersion, "gstack.closeout.v1"); assert.equal(c.status, "done")
  assert.equal(c.changedFiles.length, 2)
  const md = renderCloseoutMarkdown(c)
  assert.match(md, /Status: done/); assert.match(md, /Arquivos alterados: 2/)
})

test("runCloseoutSync: grava closeout.json + .md em runs/<runId>", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "run-x", command: "verify", status: "ready" })
    assert.equal(c.toolsRefresh.state, "not_run", "sem refresh injetado não roda")
    assert.ok(existsSync(path.join(dir, ".gstack", "runs", "run-x", "closeout.json")))
    assert.ok(existsSync(path.join(dir, ".gstack", "runs", "run-x", "closeout.md")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: refresh que quebra → degraded honesto (nunca esconde, nunca lança)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-deg-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "r", command: "start", status: "done", refresh: () => { throw new Error("graphify travou") } })
    assert.equal(c.toolsRefresh.state, "degraded")
    assert.match(c.toolsRefresh.error, /graphify travou/)
    const ok = runCloseoutSync({ cwd: dir, runId: "r2", command: "start", status: "done", refresh: () => ({ state: "ok", refreshed: ["graphify"] }) })
    assert.equal(ok.toolsRefresh.state, "ok")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: proof AUTOMÁTICO em sucesso (done) — grava ready/blockers (PRD36 36.10)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-proof-")
  try {
    let called = 0
    const proof = () => { called++; return { ready: true, blockers: [] } }
    const c = runCloseoutSync({ cwd: dir, runId: "rp", command: "start", status: "done", proof })
    assert.equal(called, 1, "proof roda no encerramento OK")
    assert.equal(c.proof.ran, true)
    assert.equal(c.proof.ready, true)
    assert.deepEqual(c.proof.blockers, [])
    assert.match(readFileSync(path.join(dir, ".gstack", "runs", "rp", "closeout.md"), "utf-8"), /Proof: ready=true/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: proof NÃO roda em run que parou/handoff (só sucesso)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-noproof-")
  try {
    let called = 0
    const c = runCloseoutSync({ cwd: dir, runId: "rh", command: "start", status: "handoff", proof: () => { called++; return { ready: true } } })
    assert.equal(called, 0, "proof num run falho seria ruído")
    assert.equal(c.proof.ran, false)
    assert.equal(c.proof.state, "skipped_not_success")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: proof que quebra → degraded honesto (nunca esconde, nunca lança)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-proofdeg-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "rd", command: "start", status: "done", proof: () => { throw new Error("proof timeout") } })
    assert.equal(c.proof.state, "degraded")
    assert.match(c.proof.error, /proof timeout/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("buildCloseout: sem learning informado -> candidate:null por default (nunca ausente)", async () => {
  const { buildCloseout } = await imp("src/skills/closeout.js")
  const c = buildCloseout({ runId: "r1", command: "start", status: "done" })
  assert.deepEqual(c.learning, { candidate: null })
})

test("runCloseoutSync: detect injetado produz candidate no closeout.json (PRD46 S46.2)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-detect-")
  try {
    const fakeCandidate = { id: "lc_test", status: "observed", validity: { status: "eligible" } }
    const c = runCloseoutSync({ cwd: dir, runId: "rdetect", command: "start", status: "done", detect: () => ({ candidate: fakeCandidate }) })
    assert.deepEqual(c.learning.candidate, fakeCandidate)
    const onDisk = JSON.parse(readFileSync(path.join(dir, ".gstack", "runs", "rdetect", "closeout.json"), "utf-8"))
    assert.equal(onDisk.learning.candidate.id, "lc_test")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: sem sinal, detect retorna candidate:null (sem ruído)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-nodetect-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "rnull", command: "start", status: "done", detect: () => ({ candidate: null }) })
    assert.equal(c.learning.candidate, null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: detect que quebra -> degraded honesto (nunca lança, candidate:null)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-detectdeg-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "rdeg", command: "start", status: "done", detect: () => { throw new Error("journal corrompido") } })
    assert.equal(c.learning.candidate, null)
    assert.match(c.learning.error, /journal corrompido/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("runCloseoutSync: sem detect injetado -> candidate:null (compat retroativa, nada quebra)", async () => {
  const { runCloseoutSync } = await imp("src/skills/closeout.js")
  const dir = mk("gstack-closeout-nodetectarg-")
  try {
    const c = runCloseoutSync({ cwd: dir, runId: "rcompat", command: "start", status: "done" })
    assert.deepEqual(c.learning, { candidate: null })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("start: o pipeline grava closeout.json no run (wiring run-loop)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mk("gstack-closeout-start-")
  try {
    const r = await startCommand([], {
      cwd: dir, objective: "criar landing page", projectName: "lp", mode: "lite",
      designSystem: "none", prompt: async () => "lp", select: async (_q, c) => c[0], confirm: async () => true,
      exec: () => ({ ok: true }), gateExec: () => ({ ok: true, code: 0 }),
      devRunner: () => ({ services: [] }), verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
      scoutRunner: () => ({ status: "not_applicable" }),
    })
    assert.equal(r.executed, true)
    const cp = path.join(dir, ".gstack", "runs", r.pipeline.runId, "closeout.json")
    assert.ok(existsSync(cp), "closeout.json escrito pelo pipeline")
    const written = JSON.parse(readFileSync(cp, "utf-8"))
    assert.equal(written.command, "start")
    assert.ok(written.learning, "wiring do detector (S46.2) presente no closeout real")
    assert.equal(written.learning.candidate, null, "run limpo de primeira não produz candidate")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("start: retry resolvido no create -> detector produz candidate REAL via wiring run-loop (E2E)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mk("gstack-closeout-retry-")
  try {
    let calls = 0
    const r = await startCommand([], {
      cwd: dir, objective: "criar landing page", projectName: "lp2", mode: "lite",
      designSystem: "none", prompt: async () => "lp2", select: async (_q, c) => c[0], confirm: async () => true,
      exec: () => { calls++; if (calls === 1) throw new Error("flaky"); return { ok: true } },
      gateExec: () => ({ ok: true, code: 0 }),
      devRunner: () => ({ services: [] }), verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
      scoutRunner: () => ({ status: "not_applicable" }),
    })
    assert.equal(r.executed, true)
    assert.ok(r.pipeline.attempts >= 2, "precisou de mais de 1 tentativa (retry real)")
    const cp = path.join(dir, ".gstack", "runs", r.pipeline.runId, "closeout.json")
    const written = JSON.parse(readFileSync(cp, "utf-8"))
    assert.ok(written.learning.candidate, "retry resolvido produz candidate REAL — wiring lê o journal.jsonl de verdade")
    assert.equal(written.learning.candidate.status, "observed", "closeout nunca promove")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
