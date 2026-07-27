import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.3.3 — PRD46 nunca teve checklist canônico (achado da própria auditoria
 * do PRD51). Espelha `tests/rc_checklist_prd45/47/48/49/50.test.js`.
 */

test("prd46Readiness: ready quando todos os P0 estão delivered", async () => {
  const { prd46Readiness, PRD46_RC_ITEMS } = await imp("src/dream/rc-checklist-prd46.js")
  const r = prd46Readiness()
  assert.equal(r.ready, true)
  assert.equal(r.counts.p0Delivered, r.counts.p0)
  assert.equal(r.p0Pending.length, 0)
  assert.ok(PRD46_RC_ITEMS.length >= 10, "checklist cobre o programa inteiro (7 sprints), não um resumo raso")
})

test("prd46Readiness: P0 pendente derruba ready (controle negativo)", async () => {
  const { prd46Readiness } = await imp("src/dream/rc-checklist-prd46.js")
  const items = [
    { id: "P0.1", tier: "P0", status: "pending", title: "x" },
    { id: "P1.1", tier: "P1", status: "delivered", title: "y" },
  ]
  const r = prd46Readiness(items)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["P0.1"])
})

test("cada item do PRD46_RC_ITEMS com proof aponta um arquivo que EXISTE (sem enfeite)", async () => {
  const { PRD46_RC_ITEMS } = await imp("src/dream/rc-checklist-prd46.js")
  for (const item of PRD46_RC_ITEMS) {
    assert.ok(item.proof, `${item.id} precisa de proof`)
    assert.ok(existsSync(path.join(repoRoot, item.proof)), `prova de ${item.id} existe: ${item.proof}`)
  }
})

test("projectPrdLedger consome PRD46_RC_ITEMS sem violação (todo delivered tem prova real em disco)", async () => {
  const { PRD46_RC_ITEMS } = await imp("src/dream/rc-checklist-prd46.js")
  const { projectPrdLedger } = await imp("src/dream/prd-ledger.js")
  const r = projectPrdLedger({ prdId: "PRD46", repoRoot, items: PRD46_RC_ITEMS })
  assert.equal(r.violations.length, 0)
  assert.equal(r.programComplete, true, "todos os itens fecharam honestamente, sem violação de prova")
})
