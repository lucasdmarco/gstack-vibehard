import test from "node:test"
import assert from "node:assert/strict"
import { quotaSufficient, planParallelism, mergeBarrier, packReference, ADAPTIVE_PARALLEL_SCHEMA } from "../src/project-plan/adaptive-parallel.js"

// PRD42 S42.11 — Paralelismo adaptativo. Honestidade: (1) quota unknown NUNCA suficiente;
// (2) DAG misto pergunta ao usuário (não auto); (3) merge barrier exige gates comuns; (4) pack
// por referência (hash), não inline.

test("quota unknown (não numérica) NUNCA é suficiente", () => {
  assert.equal(quotaSufficient({}).sufficient, false)
  assert.equal(quotaSufficient({ available: null, needed: 2 }).sufficient, false)
  assert.match(quotaSufficient({}).reason, /unknown/)
  assert.equal(quotaSufficient({ available: 4, needed: 2 }).sufficient, true)
  assert.equal(quotaSufficient({ available: 1, needed: 2 }).sufficient, false)
})

test("independente + quota ok → parallel", () => {
  const p = planParallelism([{ id: "a" }, { id: "b" }], { quota: { available: 4, needed: 2 } })
  assert.equal(p.schema, ADAPTIVE_PARALLEL_SCHEMA)
  assert.equal(p.mode, "parallel")
})

test("DAG misto → ask_user (não auto-decide)", () => {
  const p = planParallelism([{ id: "a" }, { id: "b" }, { id: "c", dependsOn: ["a"] }], { quota: { available: 8, needed: 3 } })
  assert.equal(p.mode, "ask_user")
  assert.match(p.reason, /misto|usuário/i)
})

test("CONTROLE NEGATIVO: quota unknown → ask_user mesmo com DAG paralelo", () => {
  const p = planParallelism([{ id: "a" }, { id: "b" }], { quota: {} })
  assert.equal(p.mode, "ask_user", "sem quota conhecida não paraleliza sozinho")
})

test("encadeado → sequential; ciclo → blocked", () => {
  assert.equal(planParallelism([{ id: "a" }, { id: "b", dependsOn: ["a"] }], { quota: { available: 4, needed: 1 } }).mode, "sequential")
  assert.equal(planParallelism([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }], { quota: { available: 4, needed: 1 } }).mode, "blocked")
})

test("merge barrier: branch sem gate comum bloqueia; todas com os gates → ready", () => {
  const gates = ["qg", "lint"]
  const blocked = mergeBarrier([
    { id: "feat-x", gates: { qg: true, lint: true } },
    { id: "feat-y", gates: { qg: true } }, // falta lint
  ], gates)
  assert.equal(blocked.ready, false)
  assert.deepEqual(blocked.blocked, [{ branch: "feat-y", missing: ["lint"] }])

  const ready = mergeBarrier([{ id: "feat-x", gates: { qg: true, lint: true } }], gates)
  assert.equal(ready.ready, true)
})

test("packReference: por hash, nunca inlinado (ref estável)", () => {
  const pack = { objective: "SaaS", files: ["a.js", "b.js"] }
  const r1 = packReference(pack)
  const r2 = packReference(pack)
  assert.equal(r1.inlined, false)
  assert.equal(r1.ref, r2.ref, "hash determinístico")
  assert.notEqual(r1.ref, packReference({ objective: "other" }).ref)
})
