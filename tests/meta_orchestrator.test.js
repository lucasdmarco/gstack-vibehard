import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "meta", "orchestrator.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

// ── REGRA DE OURO (DoD §11.4.1): o gate determinístico DECIDE; LLM é advisory ──
test("decideStatus: LLM aprova + QG FALHA → failed (NUNCA passed)", async () => {
  const { decideStatus } = await imp()
  assert.equal(decideStatus({ deterministicGate: { passed: false, reason: "testes falharam" }, llmReview: { ok: true } }).status, "failed")
  // QG passa + LLM ok → passed
  assert.equal(decideStatus({ deterministicGate: { passed: true }, llmReview: { ok: true } }).status, "passed")
  // QG passa + LLM aponta risco alto → needs_human_review (não passed)
  assert.equal(decideStatus({ deterministicGate: { passed: true }, llmReview: { risk: "high" } }).status, "needs_human_review")
  // Fallow/QG ausente → blocked_gate_missing (não passed)
  assert.equal(decideStatus({ deterministicGate: { missing: true }, llmReview: { ok: true } }).status, "blocked_gate_missing")
})

test("pickExecutor/pickVerifier: especialidade escolhe executor; verifier é DIFERENTE", async () => {
  const { pickExecutor, pickVerifier } = await imp()
  const matrix = { claude: ["implementation", "refactor"], codex: ["code-review", "tests"], opencode: ["isolated-task"] }
  assert.equal(pickExecutor({ specialty: "implementation" }, matrix), "claude")
  assert.equal(pickExecutor({ specialty: "code-review" }, matrix), "codex")
  assert.equal(pickVerifier("claude", matrix), "codex", "verifier prefere quem faz code-review e ≠ executor")
  assert.notEqual(pickVerifier("codex", matrix), "codex", "nunca o próprio executor")
})

// ── orquestração: executor implementa, verifier revisa (advisory), gate decide ──
test("runOrchestration: passo limpo → passed; provenance separa advisory de gate", async () => {
  const { runOrchestration } = await imp()
  const events = []
  const r = await runOrchestration({
    runId: "r1", steps: [{ id: "s1", specialty: "implementation" }],
    executeStep: () => ({ branch: "task/s1", diff: "+ok" }),
    verifierReview: () => ({ ok: true }),
    gate: () => ({ passed: true }),
    record: (e) => events.push(e.intent),
  })
  assert.equal(r.status, "done")
  assert.equal(r.steps[0].status, "passed")
  assert.notEqual(r.steps[0].executor, r.steps[0].verifier, "executor ≠ verifier")
  assert.ok(events.includes("orchestrate:llm_review_advisory"))
  assert.ok(events.includes("orchestrate:deterministic_gate"))
})

// ── DoD: LLM aprova mas o gate falha → run NÃO passa ──
test("runOrchestration: reviewer aprova + QG falha → failed/partial, nunca passed", async () => {
  const { runOrchestration } = await imp()
  const r = await runOrchestration({
    runId: "r2", steps: [{ id: "s1" }],
    executeStep: () => ({ branch: "b" }),
    verifierReview: () => ({ ok: true }), // LLM aprova
    gate: () => ({ passed: false, reason: "lint falhou" }), // QG falha
  })
  assert.equal(r.steps[0].status, "failed")
  assert.notEqual(r.status, "done") // partial/handoff, nunca tudo-passed
})

// ── §11.4: verifier NÃO pode ser o executor em risco alto → handoff ──
test("runOrchestration: risco alto sem verifier independente → handoff", async () => {
  const { runOrchestration } = await imp()
  const r = await runOrchestration({
    runId: "r3", steps: [{ id: "s1", specialty: "implementation", risk: "high" }],
    matrix: { claude: ["implementation"] }, // só um harness → não há verifier independente
    executeStep: () => ({ branch: "b" }),
  })
  assert.equal(r.status, "handoff")
  assert.equal(r.handoff.reason, "verifier_must_differ")
})

// ── hard caps: falhas repetidas → handoff ──
test("runOrchestration: abortOnRepeatedFailure → handoff após N falhas", async () => {
  const { runOrchestration } = await imp()
  const r = await runOrchestration({
    runId: "r4", steps: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
    executeStep: () => ({ branch: "b" }),
    gate: () => ({ passed: false, reason: "x" }),
    caps: { maxConsecutiveSameFailure: 2 },
  })
  assert.equal(r.status, "handoff")
  assert.equal(r.handoff.reason, "abortOnRepeatedFailure")
  assert.equal(r.iterations, 2)
})

// ═══ v2 (PRD14 §6.5): waves por dependsOn, paralelismo, reviewer plugável ═══

test("buildWaves: independentes na mesma wave; dependsOn empurra pra wave seguinte", async () => {
  const { buildWaves } = await imp()
  const waves = buildWaves([
    { id: "a" }, { id: "b" },
    { id: "c", dependsOn: ["a"] },
    { id: "d", dependsOn: ["c", "b"] },
    { id: "e", dependsOn: ["inexistente"] }, // dep desconhecida = ignorada
  ])
  assert.deepEqual(waves.map((w) => w.map((s) => s.id)), [["a", "b", "e"], ["c"], ["d"]])
})

test("buildWaves: ciclo de dependência degrada para sequencial (ordem dada)", async () => {
  const { buildWaves } = await imp()
  const waves = buildWaves([{ id: "x", dependsOn: ["y"] }, { id: "y", dependsOn: ["x"] }])
  assert.deepEqual(waves.map((w) => w.map((s) => s.id)), [["x"], ["y"]], "um por wave, nunca paralelo")
})

test("runOrchestration v2: passos independentes rodam em PARALELO até a concorrência", async () => {
  const { runOrchestration } = await imp()
  let inFlight = 0
  let peak = 0
  const r = await runOrchestration({
    runId: "v2p",
    steps: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
    concurrency: 2,
    executeStep: async (step) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((res) => setTimeout(res, 20))
      inFlight -= 1
      return { branch: `b-${step.id}` }
    },
    gate: () => ({ passed: true }),
  })
  assert.equal(r.status, "done")
  assert.equal(r.steps.length, 4)
  assert.equal(peak, 2, "concorrência respeitada (2 em voo, nunca mais)")
})

test("runOrchestration v2: dependsOn NUNCA roda antes da dependência terminar", async () => {
  const { runOrchestration } = await imp()
  const order = []
  const r = await runOrchestration({
    runId: "v2d",
    steps: [{ id: "impl" }, { id: "test", dependsOn: ["impl"] }],
    concurrency: 4,
    executeStep: async (step) => {
      order.push(`start:${step.id}`)
      await new Promise((res) => setTimeout(res, 10))
      order.push(`end:${step.id}`)
      return { branch: step.id }
    },
    gate: () => ({ passed: true }),
  })
  assert.equal(r.status, "done")
  assert.ok(order.indexOf("end:impl") < order.indexOf("start:test"), "test só começa após impl terminar")
})

test("runOrchestration v2: reviewer plugável DISPONÍVEL sinaliza risco → needs_human_review", async () => {
  const { runOrchestration } = await imp()
  const reviewer = { id: "fake", available: true, mode: "advisory", review: () => ({ ok: false, flagged: true, advisory: true }) }
  const r = await runOrchestration({
    runId: "v2r", steps: [{ id: "s1" }], reviewer,
    executeStep: () => ({ branch: "b" }),
    gate: () => ({ passed: true }), // QG passa; LLM flag → humano decide, nunca auto-passed
  })
  assert.equal(r.steps[0].status, "needs_human_review")
  assert.equal(r.reviewerCoverage, "llm_advisory_plus_gate")
})

test("runOrchestration v2: reviewer INDISPONÍVEL → fallback determinístico DECLARADO", async () => {
  const { runOrchestration } = await imp()
  const reviewer = { id: "opencode", available: false, mode: "deterministic_only", note: "binário ausente" }
  const r = await runOrchestration({
    runId: "v2f", steps: [{ id: "s1" }], reviewer,
    executeStep: () => ({ branch: "b" }),
    gate: () => ({ passed: true }),
  })
  assert.equal(r.steps[0].status, "passed", "gate determinístico decide sozinho")
  assert.equal(r.reviewerCoverage, "deterministic_only", "cobertura reduzida DECLARADA, não OK falso")
  assert.equal(r.reviewer.id, "opencode")
})

test("runOrchestration v2: resultado documenta os LIMITES atuais (aceite PRD14 §8)", async () => {
  const { runOrchestration, ORCHESTRATION_LIMITS } = await imp()
  const r = await runOrchestration({ runId: "v2l", steps: [{ id: "s1" }], executeStep: () => ({}), gate: () => ({ passed: true }) })
  assert.deepEqual(r.limits, [...ORCHESTRATION_LIMITS])
  assert.ok(r.limits.some((l) => /advisory/.test(l)), "declara que LLM nunca aprova sozinho")
})

test("runOrchestration v2: reviewer aprovando NÃO salva gate reprovado (regra de ouro intacta)", async () => {
  const { runOrchestration } = await imp()
  const reviewer = { id: "fake", available: true, mode: "advisory", review: () => ({ ok: true, advisory: true }) }
  const r = await runOrchestration({
    runId: "v2g", steps: [{ id: "s1" }], reviewer,
    executeStep: () => ({ branch: "b" }),
    gate: () => ({ passed: false, reason: "QG falhou" }),
  })
  assert.equal(r.steps[0].status, "failed", "LLM-only NUNCA aprova")
})
