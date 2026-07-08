import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("analyzeParallelSafety: independentes → parallel_safe", async () => {
  const { analyzeParallelSafety } = await imp("src/skills/parallel-preflight.js")
  const r = analyzeParallelSafety([{ id: "a" }, { id: "b" }, { id: "c" }])
  assert.equal(r.recommendation, "parallel_safe"); assert.equal(r.safe, true)
  assert.deepEqual(r.dependentSteps, [])
})

test("analyzeParallelSafety: cadeia linear → sequential_required", async () => {
  const { analyzeParallelSafety } = await imp("src/skills/parallel-preflight.js")
  const r = analyzeParallelSafety([{ id: "a" }, { id: "b", dependsOn: ["a"] }])
  assert.equal(r.recommendation, "sequential_required"); assert.equal(r.safe, false)
})

test("analyzeParallelSafety: mistura independentes + dependentes → mixed_waves", async () => {
  const { analyzeParallelSafety } = await imp("src/skills/parallel-preflight.js")
  const r = analyzeParallelSafety([{ id: "a" }, { id: "b" }, { id: "c", dependsOn: ["a"] }])
  assert.equal(r.recommendation, "mixed_waves")
  assert.deepEqual(r.dependentSteps, ["c"])
})

test("analyzeParallelSafety: ciclo → cycle_error (Kahn)", async () => {
  const { analyzeParallelSafety, PARALLEL_PREFLIGHT_SCHEMA } = await imp("src/skills/parallel-preflight.js")
  const r = analyzeParallelSafety([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }])
  assert.equal(r.hasCycle, true); assert.equal(r.recommendation, "cycle_error")
  assert.equal(PARALLEL_PREFLIGHT_SCHEMA, "gstack.parallel-preflight.v1")
})

test("parallelPreflightNote: frase honesta por recomendação", async () => {
  const { parallelPreflightNote } = await imp("src/skills/parallel-preflight.js")
  assert.match(parallelPreflightNote({ recommendation: "mixed_waves", dependentSteps: ["x"], totalSteps: 3 }), /wave/i)
  assert.match(parallelPreflightNote({ recommendation: "sequential_required" }), /sequencial/i)
})

// ── start --proof ────────────────────────────────────────────────────────────────
test("start --proof: roda proof no fim (runner injetado) e anexa resultado", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-proof-"))
  let proofCalled = false
  try {
    const r = await startCommand(["--proof", "--design-system", "none"], {
      cwd: dir, objective: "criar landing page", projectName: "lp", mode: "lite",
      prompt: async () => "lp", select: async (_q, c) => c[0], confirm: async () => true,
      exec: () => ({ ok: true }), gateExec: () => ({ ok: true, code: 0 }),
      devRunner: () => ({ services: [] }), verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
      scoutRunner: () => ({ status: "not_applicable" }),
      proofRunner: () => { proofCalled = true; return { ready: true, blockers: [] } },
    })
    assert.equal(r.executed, true)
    assert.equal(proofCalled, true, "proofRunner foi chamado")
    assert.equal(r.proof.ready, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
