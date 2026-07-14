import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"

// PRD42 S42.0B — o modo comportamental do Dream Audit é o DEFAULT do CLI. Presença de
// arquivo deixa de valer como REAL (vira NOT_PROVED) sem contrato comportamental. O modo
// legado (por arquivo) só existe sob opt-in explícito `--files-only`.

const repoRoot = path.resolve(import.meta.dirname, "..")

test("dream audit --json é COMPORTAMENTAL por padrão (behavioral:true)", async () => {
  const { dreamCommand } = await import("../src/commands/dream.js")
  const r = await dreamCommand(["audit", "--json"], { root: repoRoot })
  assert.equal(r.behavioral, true, "CLI default é behavioral")
  assert.ok((r.summary.NOT_PROVED || 0) > 0, "aparecem claims NOT_PROVED (arquivo não basta)")
})

test("dream audit --files-only volta ao modo legado (behavioral:false) sob opt-in", async () => {
  const { dreamCommand } = await import("../src/commands/dream.js")
  const legacy = await dreamCommand(["audit", "--json", "--files-only"], { root: repoRoot })
  assert.equal(legacy.behavioral, false, "--files-only desliga o behavioral")
  const behavioral = await dreamCommand(["audit", "--json"], { root: repoRoot })
  assert.ok((behavioral.summary.REAL || 0) < (legacy.summary.REAL || 0), "behavioral rebaixa REAL sem contrato")
})

test("dream status usa o mesmo default comportamental", async () => {
  const { dreamCommand } = await import("../src/commands/dream.js")
  const r = await dreamCommand(["status", "--json"], { root: repoRoot })
  // status expõe o summary do audit; NOT_PROVED presente prova o modo comportamental.
  assert.ok((r.audit.NOT_PROVED || 0) > 0, "status reflete o audit comportamental")
})

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
  const p = buildProof({ cwd: repoRoot, profile: "full", deps })
  assert.equal(seen && seen.behavioral, true, "proof chama o dream em modo behavioral")
  assert.equal(p.ready, true, "RISK/PLACEBO=0 → ready:true mesmo com NOT_PROVED presente")
})
