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
  const r = runOrchestration({
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
  const r = runOrchestration({
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
  const r = runOrchestration({
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
  const r = runOrchestration({
    runId: "r4", steps: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
    executeStep: () => ({ branch: "b" }),
    gate: () => ({ passed: false, reason: "x" }),
    caps: { maxConsecutiveSameFailure: 2 },
  })
  assert.equal(r.status, "handoff")
  assert.equal(r.handoff.reason, "abortOnRepeatedFailure")
  assert.equal(r.iterations, 2)
})
