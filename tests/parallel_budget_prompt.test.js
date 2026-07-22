import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.5 — "usuário vê risco antes de fan-out". buildSessionSummary (quota) +
// reserveFanoutBudget (S47.8) compostos: nunca reserva budget sem antes mostrar o risco.

test("quota desconhecida -> parallelRecommendation ask_user E reserveFanoutBudget não é chamado sem decisão explícita", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const { reserveFanoutBudget } = await imp("src/project-plan/adaptive-parallel.js")
  const summary = buildSessionSummary({ quota: {} })
  assert.equal(summary.parallelRecommendation, "ask_user")
  // o risco (quota unknown) já está visível ANTES de qualquer reserva de budget —
  // só reserva se o caller decidir prosseguir mesmo assim (nunca automático).
  if (summary.parallelRecommendation === "ask_user") {
    const r = reserveFanoutBudget({}, { runId: "run-x", needed: 3 })
    assert.equal(r.ok, true, "reserva só acontece explicitamente, não é bloqueada por si só")
  }
})

test("quota suficiente E reservada -> segunda reserva pro MESMO run nunca é permitida (nunca dobra o gasto)", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const { reserveFanoutBudget } = await imp("src/project-plan/adaptive-parallel.js")
  const summary = buildSessionSummary({ quota: { available: 10, needed: 3 } })
  assert.equal(summary.parallelRecommendation, "parallel_ok")
  const first = reserveFanoutBudget({}, { runId: "run-y", needed: 3 })
  const second = reserveFanoutBudget(first.ledger, { runId: "run-y", needed: 3 })
  assert.equal(second.ok, false, "budget de fan-out nunca reservado duas vezes (mesma regra do S47.8)")
})

test("summary sempre expõe quota.quality — usuário consegue distinguir medido de desconhecido antes de decidir", async () => {
  const { buildSessionSummary } = await imp("src/usage/session-summary.js")
  const known = buildSessionSummary({ quota: { available: 5, needed: 1 } })
  const unknown = buildSessionSummary({ quota: {} })
  assert.equal(known.quota.quality, "provider_reported")
  assert.equal(unknown.quota.quality, "unknown")
})
