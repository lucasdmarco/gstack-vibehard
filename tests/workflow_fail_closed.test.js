import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.3 (P0.3) — um workflow podia aprovar implementação que FALHOU. No runner, um
// worker com `ok:false` só logava node_failed e o verifier rodava em seguida, podendo marcar o
// run como `passed` (testes pré-existentes passam sem a tarefa ter sido feita → falso verde).
// Correção: worker falho NÃO chega ao verifier na mesma iteração; consome iteração e vai a
// retry/handoff/failed. Planner e rubric também falham fechado (exceção aborta o run).

const runnerMod = path.resolve(import.meta.dirname, "..", "src", "workflow-graph", "runner.js")
const imp = () => import(`${pathToFileURL(runnerMod)}?t=${Date.now()}`)

async function withBase(fn) {
  const base = await mkdtemp(path.join(tmpdir(), "gstack-wf-"))
  try { return await fn(base) } finally { await rm(base, { recursive: true, force: true }) }
}
const budget = { maxIterations: 3, maxConsecutiveSameFailure: 5, humanHandoffOnCap: false, delegation: { enabled: false } }

test("P0.3: worker ok:false NUNCA deixa o verifier marcar passed na mesma iteração", async () => {
  await withBase(async (base) => {
    const { runWorkflow } = await imp()
    let verifierCalls = 0
    const r = runWorkflow({
      task: "x", journalBase: base, budget,
      // worker SEMPRE falha; verifier SEMPRE aprovaria (o cenário do falso verde).
      worker: () => ({ ok: false, signature: "worker_failed", executed: true }),
      verifier: () => { verifierCalls += 1; return { passed: true, signature: "tests_green" } },
    })
    assert.notEqual(r.status, "passed", "CONTROLE NEGATIVO: worker falho não vira passed")
    assert.equal(verifierCalls, 0, "verifier NÃO roda quando o worker falhou")
    assert.ok(["failed", "handoff"].includes(r.status), `status honesto: ${r.status}`)
  })
})

test("P0.3: worker falho consome iteração e respeita o cap (não loop infinito)", async () => {
  await withBase(async (base) => {
    const { runWorkflow } = await imp()
    let workerCalls = 0
    const r = runWorkflow({
      task: "x", journalBase: base, budget: { ...budget, maxIterations: 3 },
      worker: () => { workerCalls += 1; return { ok: false, signature: "boom", executed: true } },
      verifier: () => ({ passed: true }),
    })
    assert.equal(r.status, "failed")
    assert.ok(workerCalls <= 3, `worker respeitou maxIterations (chamou ${workerCalls})`)
    assert.equal(r.iterations, 3, "consumiu as iterações")
  })
})

test("worker ok:true segue para o verifier normalmente (fluxo feliz preservado)", async () => {
  await withBase(async (base) => {
    const { runWorkflow } = await imp()
    let verifierCalls = 0
    const r = runWorkflow({
      task: "x", journalBase: base, budget,
      worker: () => ({ ok: true, summary: "feito", executed: true }),
      verifier: () => { verifierCalls += 1; return { passed: true, signature: "green" } },
    })
    assert.equal(r.status, "passed", "worker ok + verifier ok = passed")
    assert.equal(verifierCalls, 1, "verifier rodou uma vez")
  })
})

test("worker falho repetido com mesma assinatura vai a handoff (não passed)", async () => {
  await withBase(async (base) => {
    const { runWorkflow } = await imp()
    const r = runWorkflow({
      task: "x", journalBase: base,
      budget: { maxIterations: 10, maxConsecutiveSameFailure: 2, humanHandoffOnCap: true, delegation: { enabled: false } },
      worker: () => ({ ok: false, signature: "same_boom", executed: true }),
      verifier: () => ({ passed: true }),
    })
    assert.equal(r.status, "handoff", "mesma falha consecutiva → handoff humano")
  })
})

test("P0.3: planner que LANÇA aborta o run fail-closed (não segue para worker/verifier)", async () => {
  await withBase(async (base) => {
    const { runWorkflow } = await imp()
    let workerCalls = 0
    const r = runWorkflow({
      task: "x", journalBase: base, budget,
      planner: () => { throw new Error("planner explodiu") },
      worker: () => { workerCalls += 1; return { ok: true, executed: true } },
      verifier: () => ({ passed: true }),
    })
    assert.notEqual(r.status, "passed", "CONTROLE NEGATIVO: planner falho não vira passed")
    assert.equal(workerCalls, 0, "worker não roda se o planner falhou")
    assert.equal(r.status, "failed")
  })
})

test("P0.3: rubric que LANÇA aborta o run fail-closed", async () => {
  await withBase(async (base) => {
    const { runWorkflow } = await imp()
    let workerCalls = 0
    const r = runWorkflow({
      task: "x", journalBase: base, budget,
      rubric: () => { throw new Error("rubric explodiu") },
      worker: () => { workerCalls += 1; return { ok: true, executed: true } },
      verifier: () => ({ passed: true }),
    })
    assert.equal(r.status, "failed", "rubric falho = run failed")
    assert.equal(workerCalls, 0, "worker não roda se o rubric falhou")
  })
})
