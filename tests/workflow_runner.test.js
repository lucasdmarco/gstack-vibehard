import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const runnerMod = path.join(repoRoot, "src", "workflow-graph", "runner.js")
const jMod = path.join(repoRoot, "src", "workflow-graph", "journal.js")

async function withTmp(fn) {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-wf-"))
  try { return await fn(path.join(tmp, "runs")) } finally { await rm(tmp, { recursive: true, force: true }) }
}

test("runner: verifier passa na 1a -> status passed, 1 iteracao", async () => {
  await withTmp(async (base) => {
    const { runWorkflow } = await import(`${pathToFileURL(runnerMod)}?t=${Date.now()}`)
    const r = runWorkflow({
      task: "t", journalBase: base, runId: "r1",
      worker: () => ({ ok: true, summary: "fez" }),
      verifier: () => ({ passed: true, signature: "tests_passed" }),
    })
    assert.equal(r.status, "passed")
    assert.equal(r.iterations, 1)
  })
})

test("runner: mesma falha repetida -> circuit breaker handoff", async () => {
  await withTmp(async (base) => {
    const { runWorkflow } = await import(`${pathToFileURL(runnerMod)}?t=${Date.now()}`)
    const r = runWorkflow({
      task: "t", journalBase: base, runId: "r2",
      budget: { maxIterations: 9, maxConsecutiveSameFailure: 2 },
      worker: () => ({ ok: true }),
      verifier: () => ({ passed: false, signature: "tests_failed" }),
    })
    assert.equal(r.status, "handoff")
    assert.equal(r.iterations, 2, "para no cap de falha consecutiva")
  })
})

test("runner: falhas diferentes esgotam maxIterations -> handoff (humanHandoffOnCap)", async () => {
  await withTmp(async (base) => {
    const { runWorkflow } = await import(`${pathToFileURL(runnerMod)}?t=${Date.now()}`)
    let i = 0
    const r = runWorkflow({
      task: "t", journalBase: base, runId: "r3",
      budget: { maxIterations: 3, maxConsecutiveSameFailure: 99, humanHandoffOnCap: true },
      worker: () => ({ ok: true }),
      verifier: () => ({ passed: false, signature: "fail_" + (++i) }),
    })
    assert.equal(r.iterations, 3)
    assert.equal(r.status, "handoff")
  })
})

test("runner: journal registra eventos do run", async () => {
  await withTmp(async (base) => {
    const { runWorkflow } = await import(`${pathToFileURL(runnerMod)}?t=${Date.now()}`)
    const { runStats } = await import(`${pathToFileURL(jMod)}?t=${Date.now()}`)
    runWorkflow({
      task: "t", journalBase: base, runId: "r4",
      worker: () => ({ ok: true }), verifier: () => ({ passed: true }),
    })
    const s = runStats(base, "r4")
    assert.ok(s.events >= 4)
    assert.ok(s.started && s.ended)
  })
})
