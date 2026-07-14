import test from "node:test"
import assert from "node:assert/strict"
import {
  startInvestigation, reproduce, hypothesize, applyFix, recordRegression, isTerminal,
  MAX_FIX_ATTEMPTS, DEBUG_INVESTIGATION_SCHEMA,
} from "../src/project-plan/debug-investigation.js"

// PRD42 S42.9 — Debug científico. Invariantes: (1) editar antes de reproduzir é BLOQUEADO;
// (2) 3 regressões vermelhas → architecture_review_required (hard halt); (3) reprodução exige
// evidência; (4) caminho feliz chega a regression_green.

test("caminho feliz: reported→reproduced→hypothesis→fix_applied→regression_green", () => {
  const inv = startInvestigation({ bug: "500 no /checkout" })
  assert.equal(inv.schema, DEBUG_INVESTIGATION_SCHEMA)
  reproduce(inv, { reproduced: true, detail: "curl reproduz 500" })
  hypothesize(inv, "faltou await na query")
  applyFix(inv)
  recordRegression(inv, true)
  assert.equal(inv.state, "regression_green")
  assert.equal(isTerminal(inv), true)
})

test("INVARIANTE: editar antes de reproduzir é BLOQUEADO", () => {
  const inv = startInvestigation({ bug: "x" })
  assert.throws(() => applyFix(inv), /editar antes de reproduzir é BLOQUEADO/)
})

test("reprodução exige evidência (não basta afirmar)", () => {
  const inv = startInvestigation({ bug: "x" })
  assert.throws(() => reproduce(inv, {}), /reprodução exige evidence.reproduced/)
  assert.throws(() => reproduce(inv, { reproduced: false }), /reproduced === true/)
})

test("HARD HALT: 3 regressões vermelhas → architecture_review_required", () => {
  const inv = startInvestigation({ bug: "flaky" })
  reproduce(inv, { reproduced: true })
  hypothesize(inv, "h inicial")
  for (let i = 0; i < MAX_FIX_ATTEMPTS; i += 1) {
    // após regressão vermelha o estado já volta a `hypothesis` — aplica-se nova correção direto.
    applyFix(inv)
    recordRegression(inv, false) // vermelha
  }
  assert.equal(inv.state, "architecture_review_required", "após 3 falhas, para de tentar consertar o sintoma")
  assert.equal(inv.attempts, MAX_FIX_ATTEMPTS)
  assert.equal(isTerminal(inv), true)
})

test("regressão vermelha antes do limite volta a hypothesis (nova hipótese)", () => {
  const inv = startInvestigation({ bug: "x" })
  reproduce(inv, { reproduced: true })
  hypothesize(inv, "h1")
  applyFix(inv)
  recordRegression(inv, false)
  assert.equal(inv.state, "hypothesis", "1 falha → tenta outra hipótese, não halt")
  assert.equal(inv.attempts, 1)
})

test("CONTROLE NEGATIVO: recordRegression fora de fix_applied lança", () => {
  const inv = startInvestigation({ bug: "x" })
  assert.throws(() => recordRegression(inv, true), /exige fix_applied/)
})

test("CONTROLE NEGATIVO: estado terminal não avança mais", () => {
  const inv = startInvestigation({ bug: "x" })
  reproduce(inv, { reproduced: true }); hypothesize(inv); applyFix(inv); recordRegression(inv, true)
  assert.throws(() => hypothesize(inv), /invalid_transition/)
})
