import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("todo gate do registry tem contrato COMPLETO (id/severity/evidência/negative-control)", async () => {
  const { PROOF_GATES, validateGateContract, buildGateRegistry } = await imp("src/skills/gate-registry.js")
  for (const g of PROOF_GATES) {
    const v = validateGateContract(g)
    assert.ok(v.ok, `gate ${g.id} incompleto: ${JSON.stringify(v)}`)
  }
  assert.equal(buildGateRegistry().contractOk, true)
})

test("severity governa: hard bloqueia; advisory só avisa (nunca reprova)", async () => {
  const { resolveGateOutcomes } = await imp("src/skills/gate-registry.js")
  const checks = {
    verify: { blocker: "verify falhou" },        // hard → blocker
    headroomRouting: { blocker: "não roteado" },  // advisory → só warning
    graphifyFreshness: { warning: "grafo 1 commit atrás" },
  }
  const out = resolveGateOutcomes({ profile: "full", checks })
  assert.ok(out.blockers.includes("verify falhou"), "gate hard bloqueia")
  assert.ok(!out.blockers.includes("não roteado"), "gate advisory NUNCA bloqueia")
  assert.ok(out.warnings.includes("não roteado"), "advisory vira warning")
  assert.ok(out.warnings.includes("grafo 1 commit atrás"))
})

test("aplicabilidade por profile: dream-audit não se aplica a 'quick'", async () => {
  const { PROOF_GATES, gateApplies, resolveGateOutcomes } = await imp("src/skills/gate-registry.js")
  const dream = PROOF_GATES.find((g) => g.id === "dream-audit")
  assert.equal(gateApplies(dream, "quick"), false)
  assert.equal(gateApplies(dream, "release"), true)
  // em quick, um blocker de dream é ignorado (gate fora de escopo)
  const out = resolveGateOutcomes({ profile: "quick", checks: { dreamAudit: { blocker: "dream x" } } })
  assert.equal(out.blockers.length, 0)
})

test("contrato inválido é detectado (severity fora de hard|advisory, campo faltando)", async () => {
  const { validateGateContract } = await imp("src/skills/gate-registry.js")
  assert.equal(validateGateContract({ id: "x" }).ok, false)
  const bad = validateGateContract({ id: "x", version: 1, severity: "meh", appliesTo: "all", evidenceKey: "x", toolMissing: "warn", negativeControl: "n" })
  assert.equal(bad.ok, false)
  assert.equal(bad.badSeverity, true)
})

test("PARIDADE: proof consome o registry e os hard gates seguem sendo os blockers", async () => {
  const { buildProof } = await imp("src/commands/proof.js")
  // deps injetados: verify falha (hard) → deve bloquear; headroom não-roteado (advisory) → warning
  const deps = {
    verify: () => ({ status: "failed", failed: ["suite"], timedOut: [] }),
    dream: () => ({ summary: { RISK: 0, PLACEBO: 0 }, scope: {} }),
    readiness: () => ({ tools: { headroom: { status: "callable_not_routed" }, graphify: { status: "ok", freshness: { state: "fresh" } } } }),
    git: () => "",
    skillGateRelease: () => ({ ok: true, blocker: null, pendingGates: [] }),
  }
  const p = buildProof({ cwd: repoRoot, profile: "full", deps })
  assert.equal(p.ready, false, "verify hard falho reprova")
  assert.ok(p.blockers.length > 0 && p.checks.verify.ok === false, "verify hard bloqueia")
  assert.ok(p.warnings.some((w) => /headroom/.test(w)), "headroom advisory é warning, não blocker")
  assert.ok(!p.blockers.some((w) => /headroom/.test(w)), "headroom NUNCA é blocker")
  assert.equal(p.gateRegistry, "gstack.gate-registry.v1")
})
