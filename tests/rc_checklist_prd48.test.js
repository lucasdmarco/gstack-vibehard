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

// CERTIFICAÇÃO RC (2026-08-02): PRD48 ganhou um P0 BLOQUEANTE real (P0.CODEX-HOOKS),
// provado em HOME descartável. `ready` caiu para false — isso é o gate funcionando, não
// regressão. O teste passa a fixar a INVARIANTE (todo P0 fechado <=> ready) em vez do
// valor, que muda a cada bloqueante legítimo encontrado.
test("prd48Readiness: ready reflete exatamente o fechamento dos P0", async () => {
  const { prd48Readiness, PRD48_RC_ITEMS } = await imp()
  const p0 = PRD48_RC_ITEMS.filter((i) => i.tier === "P0")
  assert.ok(p0.length >= 1)
  const abertos = p0.filter((i) => i.status !== "delivered")
  const r = prd48Readiness()
  assert.equal(r.ready, abertos.length === 0)
  assert.ok(abertos.some((i) => i.id === "P0.CODEX-HOOKS"), "o bloqueante da certificação está registrado")
})

test("CONTROLE NEGATIVO: P0 pendente derruba ready", async () => {
  const { prd48Readiness, PRD48_RC_ITEMS } = await imp()
  const tampered = PRD48_RC_ITEMS.map((i) => (i.id === "P0.1" ? { ...i, status: "pending" } : i))
  const r = prd48Readiness(tampered)
  assert.equal(r.ready, false)
  assert.ok(r.p0Pending.includes("P0.1"))
})

test("cada item com proof aponta um teste que EXISTE (sem enfeite)", async () => {
  const { PRD48_RC_ITEMS } = await imp()
  for (const item of PRD48_RC_ITEMS.filter((i) => i.proof)) {
    assert.ok(existsSync(path.join(repoRoot, item.proof)), `prova de ${item.id} existe: ${item.proof}`)
  }
})

// PRD51 S51.7.3 fechou o P2.2 (era o único item que nenhum sprint tinha
// endereçado). A invariante que este teste protege continua a MESMA e é a
// que importa: um item só sai de `pending` com uma prova REAL que existe —
// nunca um `proof` forjado. Verificada agora de forma genérica, pra não
// ficar stale a cada item fechado.
test("nenhum item declara status 'delivered'/'partial' sem proof real (sem proof forjado)", async () => {
  const { PRD48_RC_ITEMS } = await imp()
  for (const item of PRD48_RC_ITEMS) {
    if (item.status === "pending") { assert.equal(item.proof, null, `${item.id} pendente não tem proof`); continue }
    assert.ok(item.proof, `${item.id} está '${item.status}' ⇒ precisa de proof declarado`)
    assert.ok(existsSync(path.join(repoRoot, item.proof)), `proof de ${item.id} existe de verdade: ${item.proof}`)
  }
})

test("S51.7.3: P2.2 (próxima ação segura ao falhar) graduou delivered com prova real", async () => {
  const { PRD48_RC_ITEMS } = await imp()
  const p22 = PRD48_RC_ITEMS.find((i) => i.id === "P2.2")
  assert.equal(p22.status, "delivered")
  assert.equal(p22.proof, "tests/safe_next_action.test.js")
})

test("cobre as 8 lacunas do PRD48 §3.2 (P1.1-P1.6, P2.1-P2.2) + o baseline P0.1", async () => {
  const { PRD48_RC_ITEMS } = await imp()
  const ids = new Set(PRD48_RC_ITEMS.map((i) => i.id))
  assert.ok(ids.has("P0.1"))
  for (let n = 1; n <= 6; n++) assert.ok(ids.has(`P1.${n}`), `tem P1.${n}`)
  assert.ok(ids.has("P2.1"))
  assert.ok(ids.has("P2.2"))
})
