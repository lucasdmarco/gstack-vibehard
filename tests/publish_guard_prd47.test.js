import test from "node:test"
import assert from "node:assert/strict"
import { publishGuard } from "../src/project-plan/publish-guard.js"
import { EVIDENCE_IDS, CORE_EVIDENCE_IDS } from "../src/project-plan/golden-workflow-vertical.js"

// PRD47 S47.10 — "publish guard exige Golden Workflow ... verde". Só as evidências CORE
// (offline, sem credencial de terceiro) podem travar publish; Stripe/Supabase/painel-browser
// ficam blocked/not_executed em QUALQUER máquina sem credencial real e NUNCA devem travar.

const baseOpts = (extra) => ({ cwd: process.cwd(), exec: () => "", checkCi: false, ...extra })
const findCheck = (r, id) => r.checks.find((c) => c.id === id)

const reportWith = (overrides = {}) => ({
  items: EVIDENCE_IDS.map((id) => ({ id, status: overrides[id] || (CORE_EVIDENCE_IDS.includes(id) ? "proved" : "blocked") })),
})

test("golden-workflow: sem relatório => not_applicable com ação (nunca 'passed' por omissão)", () => {
  const r = publishGuard(baseOpts({ goldenWorkflow: () => null }))
  const c = findCheck(r, "golden-workflow")
  assert.equal(c.status, "not_applicable")
  assert.match(c.detail, /test:vertical/)
  assert.ok(!r.failed.includes("golden-workflow"))
})

test("golden-workflow: todas as evidências CORE proved (credencial/browser blocked, honesto) => passed", () => {
  const r = publishGuard(baseOpts({ goldenWorkflow: () => reportWith() }))
  assert.equal(findCheck(r, "golden-workflow").status, "passed")
  assert.ok(!r.failed.includes("golden-workflow"))
})

test("golden-workflow: UMA evidência CORE não provada => failed HARD (bloqueia publish)", () => {
  const r = publishGuard(baseOpts({ goldenWorkflow: () => reportWith({ repair_loop_proved: "blocked" }) }))
  const c = findCheck(r, "golden-workflow")
  assert.equal(c.status, "failed")
  assert.match(c.detail, /repair_loop_proved/)
  assert.ok(r.failed.includes("golden-workflow"), "é HARD")
})

test("golden-workflow: Stripe/Supabase/painel-browser blocked/not_executed NUNCA bloqueiam publish (não são core)", () => {
  const r = publishGuard(baseOpts({
    goldenWorkflow: () => reportWith({ stripe_test_mode: "blocked", panel_observed_browser: "not_executed", login_exercised: "blocked" }),
  }))
  assert.equal(findCheck(r, "golden-workflow").status, "passed")
})

test("golden-workflow: evidência CORE ausente do relatório (não só status ruim) também reprova", () => {
  const incomplete = { items: EVIDENCE_IDS.filter((id) => id !== "rollback_to_green").map((id) => ({ id, status: CORE_EVIDENCE_IDS.includes(id) ? "proved" : "blocked" })) }
  const r = publishGuard(baseOpts({ goldenWorkflow: () => incomplete }))
  assert.equal(findCheck(r, "golden-workflow").status, "failed")
})
