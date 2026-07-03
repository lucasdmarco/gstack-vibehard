import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const steps = [{ id: "scaffold" }, { id: "build" }, { id: "test" }]

test("resume: não repete passo já provado; retoma do primeiro pending/failed", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-loop-"))
  try {
    const { runEvidenceLoop } = await imp("src/project-plan/evidence-loop.js")
    // 1ª rodada: scaffold prova, build FALHA → para
    const ran1 = []
    const r1 = runEvidenceLoop({
      cwd, taskId: "tk", objective: "x", steps,
      runStep: ({ step }) => {
        ran1.push(step.id)
        if (step.id === "build") return { status: "failed", source: "build", result: "compile error" }
        return { status: "proved", source: "command" }
      },
    })
    assert.equal(r1.status, "handoff")
    assert.deepEqual(ran1, ["scaffold", "build"], "parou no build; nunca chegou em test")

    // 2ª rodada: NÃO repete scaffold (já provado); retoma em build, agora tudo prova
    const ran2 = []
    const r2 = runEvidenceLoop({
      cwd, taskId: "tk", objective: "x", steps,
      runStep: ({ step }) => { ran2.push(step.id); return { status: "proved", source: step.id === "test" ? "test" : "build" } },
    })
    assert.deepEqual(ran2, ["build", "test"], "retomou do build, pulou scaffold provado")
    assert.equal(r2.status, "complete")
    assert.equal(r2.summary.complete, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("hard cap: falha resumível repetida gera handoff, sem loop infinito", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-loop-"))
  try {
    const { runEvidenceLoop } = await imp("src/project-plan/evidence-loop.js")
    let calls = 0
    // 3 passos, todos "pending" (resumível) — hard cap deve fechar em handoff
    const r = runEvidenceLoop({
      cwd, taskId: "cap", objective: "y", hardCap: 2,
      steps: [{ id: "a" }, { id: "b" }, { id: "c" }],
      runStep: () => { calls++; return { status: "pending", source: "command", result: "ainda não" } },
    })
    assert.equal(r.status, "handoff")
    assert.equal(r.reason, "hard_cap")
    assert.ok(calls <= 2, "hard cap corta a execução")
    assert.ok(r.handoffPath)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("resume total: se tudo já provado, loop não roda nada e fica complete", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-loop-"))
  try {
    const { runEvidenceLoop } = await imp("src/project-plan/evidence-loop.js")
    const { recordEvidence } = await imp("src/project-plan/evidence-ledger.js")
    for (const s of steps) recordEvidence(cwd, "done", { step: s.id, source: "test", status: "proved" })
    let ran = 0
    const r = runEvidenceLoop({ cwd, taskId: "done", objective: "z", steps, runStep: () => { ran++; return { status: "proved", source: "test" } } })
    assert.equal(ran, 0, "nada a retomar → runStep nunca chamado")
    assert.equal(r.status, "complete")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
