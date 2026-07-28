import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"

// PRD42 S42.0B — o modo comportamental do Dream Audit é o DEFAULT do CLI. Presença de
// arquivo deixa de valer como REAL (vira NOT_PROVED) sem contrato comportamental. O modo
// legado (por arquivo) só existe sob opt-in explícito `--files-only`.

const repoRoot = path.resolve(import.meta.dirname, "..")

// PRD51 S51.6.4→S51.6.8 fecharam contrato pras 20 claims que eram NOT_PROVED
// no repo real — hoje o placar ao vivo tem 0 NOT_PROVED (100% dos claims
// file-REAL têm contrato comportamental). Os 3 testes abaixo dependiam de
// "aparece NOT_PROVED"/"REAL cai" como prova indireta de que o modo
// behavioral está ativo — isso ficou stale (e vai continuar ficando, a cada
// contrato novo). O mecanismo em si já é provado sinteticamente em
// `dream_behavioral.test.js` (`gradeClaimStatus`); aqui a prova direta e
// não-frágil é o campo `behavioral` no payload + o schema do summary.
test("dream audit --json é COMPORTAMENTAL por padrão (behavioral:true)", async () => {
  const { dreamCommand } = await import("../src/commands/dream.js")
  const r = await dreamCommand(["audit", "--json"], { root: repoRoot })
  assert.equal(r.behavioral, true, "CLI default é behavioral")
})

test("dream audit --files-only volta ao modo legado (behavioral:false) sob opt-in", async () => {
  const { dreamCommand } = await import("../src/commands/dream.js")
  const legacy = await dreamCommand(["audit", "--json", "--files-only"], { root: repoRoot })
  assert.equal(legacy.behavioral, false, "--files-only desliga o behavioral")
  const behavioral = await dreamCommand(["audit", "--json"], { root: repoRoot })
  assert.equal(behavioral.behavioral, true)
  assert.ok((behavioral.summary.REAL || 0) <= (legacy.summary.REAL || 0), "behavioral NUNCA infla REAL além do modo arquivo")
})

test("dream status usa o mesmo default comportamental", async () => {
  const { dreamCommand } = await import("../src/commands/dream.js")
  const auditMod = await import("../src/dream/auditor.js")
  const r = await dreamCommand(["status", "--json"], { root: repoRoot })
  const direct = auditMod.audit({ root: repoRoot, behavioral: true })
  assert.deepEqual(r.audit, direct.summary, "status usa o MESMO summary que audit({behavioral:true}) produziria, não um modo diferente")
})

// PRD51 S51.5.5: perfil "release" aqui de propósito — o teste é sobre
// dream/behavioral, não sobre a regra de routing do Headroom em `full`
// (que agora bloqueia sem proxy provado; ver `headroom_policy.test.js`).
test("proof consome o dream COMPORTAMENTAL (RISK/PLACEBO inalterados → ready não afetado)", async () => {
  const { buildProof } = await import("../src/commands/proof.js")
  let seen = null
  const deps = {
    dream: (opts) => { seen = opts; return { summary: { RISK: 0, PLACEBO: 0, REAL: 1, NOT_PROVED: 3 }, scope: { target: "gstack_package" } } },
    verify: () => ({ status: "ready", failed: [] }),
    readiness: () => ({ tools: { headroom: { status: "callable_not_routed" }, graphify: { status: "ok", freshness: { state: "fresh" } } } }),
    git: () => "",
    skillGateRelease: () => ({ ok: true }),
    env: {},
  }
  const p = buildProof({ cwd: repoRoot, profile: "release", deps })
  assert.equal(seen && seen.behavioral, true, "proof chama o dream em modo behavioral")
  assert.equal(p.ready, true, "RISK/PLACEBO=0 → ready:true mesmo com NOT_PROVED presente")
})
