import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD48 S48.7 — checklist de Release Candidate: mapeia as 8 lacunas do PRD48 §3.2
// (P1.1-P1.6, P2.1-P2.2) + o baseline (P0.1) ao sprint/versão + prova real.
// `prd48Readiness()` só declara `ready:true` com o P0 delivered.

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "dream", "rc-checklist-prd48.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("prd48Readiness: o P0 (baseline S48.0) é delivered -> ready:true", async () => {
  const { prd48Readiness, PRD48_RC_ITEMS } = await imp()
  const p0 = PRD48_RC_ITEMS.filter((i) => i.tier === "P0")
  assert.equal(p0.length, 1)
  assert.equal(p0[0].status, "delivered")
  const r = prd48Readiness()
  assert.equal(r.ready, true)
})

test("CONTROLE NEGATIVO: P0 pendente derruba ready", async () => {
  const { prd48Readiness, PRD48_RC_ITEMS } = await imp()
  const tampered = PRD48_RC_ITEMS.map((i) => (i.id === "P0.1" ? { ...i, status: "pending" } : i))
  const r = prd48Readiness(tampered)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["P0.1"])
})

test("cada item com proof aponta um teste que EXISTE (sem enfeite)", async () => {
  const { PRD48_RC_ITEMS } = await imp()
  for (const item of PRD48_RC_ITEMS.filter((i) => i.proof)) {
    assert.ok(existsSync(path.join(repoRoot, item.proof)), `prova de ${item.id} existe: ${item.proof}`)
  }
})

test("P2.2 (ajuda contextual geral) é honestamente 'pending' — nenhum sprint endereçou, sem proof forjado", async () => {
  const { PRD48_RC_ITEMS, prd48Readiness } = await imp()
  const p22 = PRD48_RC_ITEMS.find((i) => i.id === "P2.2")
  assert.equal(p22.status, "pending")
  assert.equal(p22.proof, null)
  const r = prd48Readiness()
  assert.ok(r.p1Open.some((i) => i.id === "P2.2"))
})

test("cobre as 8 lacunas do PRD48 §3.2 (P1.1-P1.6, P2.1-P2.2) + o baseline P0.1", async () => {
  const { PRD48_RC_ITEMS } = await imp()
  const ids = new Set(PRD48_RC_ITEMS.map((i) => i.id))
  assert.ok(ids.has("P0.1"))
  for (let n = 1; n <= 6; n++) assert.ok(ids.has(`P1.${n}`), `tem P1.${n}`)
  assert.ok(ids.has("P2.1"))
  assert.ok(ids.has("P2.2"))
})
