import test from "node:test"
import assert from "node:assert/strict"
import {
  quotaSufficient, planParallelism, mergeBarrier, packReference, ADAPTIVE_PARALLEL_SCHEMA,
  reserveFanoutBudget, releaseFanoutBudget, branchesToRetry, applyUserChoice,
} from "../src/project-plan/adaptive-parallel.js"

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

// PRD47 S47.8 — Paralelismo adaptativo dentro do Golden Path. Fecha o que faltava em
// adaptive-parallel.js: budget reservado ANTES do fan-out (nunca duas vezes pro mesmo
// run), isolamento de falha por branch (falha de uma não obriga repetir as demais), e
// escolha explícita do usuário por sequencial (mesmo com análise favorável a paralelo).

test("reserveFanoutBudget: reserva atômica — primeira reserva ok", () => {
  const r = reserveFanoutBudget({}, { runId: "run-1", needed: 3 })
  assert.equal(r.ok, true)
  assert.equal(r.ledger["run-1"], 3)
})

test("reserveFanoutBudget: NUNCA reserva duas vezes pro MESMO fan-out (DoD — teste #12 do §12.1)", () => {
  const first = reserveFanoutBudget({}, { runId: "run-1", needed: 3 })
  const second = reserveFanoutBudget(first.ledger, { runId: "run-1", needed: 3 })
  assert.equal(second.ok, false)
  assert.match(second.reason, /nunca reserva duas vezes/)
  assert.equal(second.ledger["run-1"], 3, "ledger original preservado, sem duplo-booking")
})

test("reserveFanoutBudget: runs DIFERENTES reservam independentemente", () => {
  const a = reserveFanoutBudget({}, { runId: "run-1", needed: 2 })
  const b = reserveFanoutBudget(a.ledger, { runId: "run-2", needed: 5 })
  assert.equal(b.ok, true)
  assert.deepEqual(b.ledger, { "run-1": 2, "run-2": 5 })
})

test("releaseFanoutBudget: libera e permite reservar de novo pro mesmo runId", () => {
  const reserved = reserveFanoutBudget({}, { runId: "run-1", needed: 3 })
  const released = releaseFanoutBudget(reserved.ledger, "run-1")
  assert.equal("run-1" in released, false)
  const again = reserveFanoutBudget(released, { runId: "run-1", needed: 3 })
  assert.equal(again.ok, true)
})

test("branchesToRetry: só as branches que FALHARAM — passed NUNCA é obrigada a repetir (DoD)", () => {
  const results = [
    { branch: "feat-a", status: "passed" },
    { branch: "feat-b", status: "failed" },
    { branch: "feat-c", status: "passed" },
  ]
  assert.deepEqual(branchesToRetry(results), ["feat-b"])
})

test("branchesToRetry: todas passed → nada a repetir", () => {
  assert.deepEqual(branchesToRetry([{ branch: "a", status: "passed" }, { branch: "b", status: "passed" }]), [])
})

test("applyUserChoice: usuário pode SEMPRE forçar sequencial, mesmo com análise favorável a paralelo (DoD)", () => {
  const plan = planParallelism([{ id: "a" }, { id: "b" }], { quota: { available: 4, needed: 2 } })
  assert.equal(plan.mode, "parallel")
  const forced = applyUserChoice(plan, "sequential")
  assert.equal(forced.mode, "sequential")
  assert.equal(forced.userOverride, true)
})

test("applyUserChoice: sem escolha do usuário, o plano original é preservado", () => {
  const plan = planParallelism([{ id: "a" }, { id: "b" }], { quota: { available: 4, needed: 2 } })
  assert.deepEqual(applyUserChoice(plan, null), plan)
})
