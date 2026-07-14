import test from "node:test"
import assert from "node:assert/strict"
import { tierSpec, aggregateTier, QUALITY_TIERS } from "../src/project-plan/quality-profile.js"
import { evaluateBudget } from "../src/project-plan/budget-policy.js"
import { buildQaPlan, isKnownTier } from "../src/project-plan/qa-plan.js"

// PRD42 S42.8 — Quality Profiles + tiers + budgets. Teeth: (1) tier release exige engine →
// blocked_missing_engine (nunca skip-verde); (2) not_applicable NUNCA é passed; (3) budget unknown
// nunca é "dentro"; (4) tier desconhecido é fail-closed.

test("tiers: smoke/regression sem engine; release exige engine", () => {
  assert.equal(tierSpec("smoke").requiresEngine, false)
  assert.equal(tierSpec("release").requiresEngine, true)
  assert.deepEqual(QUALITY_TIERS, ["smoke", "regression", "release"])
  assert.throws(() => tierSpec("nope"), /tier desconhecido/)
})

test("CONTROLE NEGATIVO: release sem engine → blocked_missing_engine (não ready)", () => {
  const r = aggregateTier({ tier: "release", engineAvailable: false, checks: [{ name: "lint", status: "passed" }] })
  assert.equal(r.ready, false)
  assert.equal(r.blocked[0].reason, "blocked_missing_engine")
})

test("release COM engine + checks ok → ready", () => {
  const r = aggregateTier({ tier: "release", engineAvailable: true, checks: [{ name: "lint", status: "passed" }, { name: "e2e-backend", status: "passed" }] })
  assert.equal(r.ready, true)
})

test("INVARIANTE: not_applicable NUNCA conta como passed", () => {
  const r = aggregateTier({ tier: "smoke", engineAvailable: false, checks: [{ name: "unit-smoke", status: "not_applicable" }, { name: "lint", status: "passed" }] })
  assert.equal(r.ready, true, "not_applicable não bloqueia")
  assert.equal(r.passedCount, 1, "só o passed conta; not_applicable fora")
})

test("CONTROLE NEGATIVO: check failed derruba o tier", () => {
  const r = aggregateTier({ tier: "regression", engineAvailable: false, checks: [{ name: "unit", status: "failed" }] })
  assert.equal(r.ready, false)
  assert.deepEqual(r.blocked, [{ check: "unit", status: "failed" }])
})

test("budget: within/over medidos; unknown (sem medição) nunca é ok", () => {
  assert.equal(evaluateBudget("smoke", 60).status, "within")
  assert.equal(evaluateBudget("smoke", 60).ok, true)
  const over = evaluateBudget("smoke", 200)
  assert.equal(over.status, "over")
  assert.equal(over.overBy, 80)
  const unknown = evaluateBudget("smoke", null)
  assert.equal(unknown.status, "unknown")
  assert.equal(unknown.ok, false, "unknown nunca é dentro do orçamento")
})

test("qa-plan: superfície de risco eleva o mínimo mesmo em smoke", () => {
  const risky = buildQaPlan({ tier: "smoke", files: ["src/runtime/manifest.js"] })
  assert.ok(risky.checks.includes("typecheck") && risky.checks.includes("unit-smoke"))
  assert.equal(risky.blocking, true)
  assert.equal(isKnownTier("release"), true)
  assert.equal(isKnownTier("nope"), false)
})

// Integração no comando: --tier é aditivo ao --profile; release sem engine bloqueia.
test("verify --tier release sem engine: report.tier = blocked_missing_engine", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises")
  const os = await import("node:os")
  const path = await import("node:path")
  const { pathToFileURL } = await import("node:url")
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const cwd = await mkdtemp(path.join(os.tmpdir(), "gstack-tier-"))
  try {
    const { verifyCommand } = await import(`${pathToFileURL(path.join(repoRoot, "src/commands/verify.js"))}?t=${Date.now()}`)
    const report = await verifyCommand(["--json", "--profile", "scaffold", "--tier", "release"], {
      cwd, home: cwd, runId: "tierrun", exec: () => {},
      engineProbe: () => { throw new Error("no docker") }, // engine ausente
    })
    assert.ok(report.tier, "tier gate anexado ao report")
    assert.equal(report.tier.ready, false)
    assert.equal(report.tier.blocked[0].reason, "blocked_missing_engine")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("verify sem --tier: report.tier ausente (comportamento intacto)", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises")
  const os = await import("node:os")
  const path = await import("node:path")
  const { pathToFileURL } = await import("node:url")
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const cwd = await mkdtemp(path.join(os.tmpdir(), "gstack-notier-"))
  try {
    const { verifyCommand } = await import(`${pathToFileURL(path.join(repoRoot, "src/commands/verify.js"))}?t=${Date.now()}`)
    const report = await verifyCommand(["--json", "--profile", "scaffold"], { cwd, home: cwd, runId: "notier", exec: () => {} })
    assert.equal(report.tier, undefined, "sem --tier, nada muda")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
