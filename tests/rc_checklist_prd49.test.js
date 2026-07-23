import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD49 S49.10 — checklist de Release Candidate: mapeia os 10 sprints de produto
// (S49.0-S49.9) a P0/P1 com prova real, e os 15 cenários obrigatórios do plano a
// evidência real ou `not_executed` honesto. Espelha o padrão de
// rc-checklist-prd47.js/rc-checklist-prd48.js.

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "dream", "rc-checklist-prd49.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("prd49Readiness: todos os 3 P0 são delivered -> ready:true", async () => {
  const { prd49Readiness, PRD49_RC_ITEMS } = await imp()
  const p0 = PRD49_RC_ITEMS.filter((i) => i.tier === "P0")
  assert.equal(p0.length, 3)
  for (const item of p0) assert.equal(item.status, "delivered", `${item.id} deveria ser delivered`)
  const r = prd49Readiness()
  assert.equal(r.ready, true)
})

test("CONTROLE NEGATIVO: qualquer P0 pendente derruba ready", async () => {
  const { prd49Readiness, PRD49_RC_ITEMS } = await imp()
  const tampered = PRD49_RC_ITEMS.map((i) => (i.id === "P0.1" ? { ...i, status: "pending" } : i))
  const r = prd49Readiness(tampered)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["P0.1"])
})

test("cada item com proof aponta um arquivo que EXISTE de verdade (sem enfeite)", async () => {
  const { PRD49_RC_ITEMS } = await imp()
  for (const item of PRD49_RC_ITEMS.filter((i) => i.proof)) {
    assert.ok(existsSync(path.join(repoRoot, item.proof)), `prova de ${item.id} existe: ${item.proof}`)
  }
})

test("cobre os 10 sprints de produto do PRD49 (S49.0-S49.9)", async () => {
  const { PRD49_RC_ITEMS } = await imp()
  const sprints = new Set(PRD49_RC_ITEMS.map((i) => i.sprint))
  for (const s of ["S49.0", "S49.1", "S49.2A", "S49.2B", "S49.3", "S49.4", "S49.5", "S49.6", "S49.7", "S49.8", "S49.9"]) {
    assert.ok(sprints.has(s), `checklist cobre ${s}`)
  }
})

test("itens partial (S49.5/S49.6/S49.7/S49.9) permanecem honestamente partial, nunca inflados a delivered", async () => {
  const { PRD49_RC_ITEMS } = await imp()
  const partials = PRD49_RC_ITEMS.filter((i) => ["S49.5", "S49.6", "S49.7", "S49.9"].includes(i.sprint))
  assert.ok(partials.length >= 4)
  for (const i of partials) assert.equal(i.status, "partial", `${i.id} (${i.sprint}) deveria ser partial`)
})

test("PRD49_SCENARIO_COVERAGE: cobre os 15 cenários obrigatórios do plano, cada um com status real|partial|not_executed", async () => {
  const { PRD49_SCENARIO_COVERAGE } = await imp()
  assert.equal(PRD49_SCENARIO_COVERAGE.length, 15)
  for (const s of PRD49_SCENARIO_COVERAGE) {
    assert.ok(["real", "partial", "not_executed"].includes(s.status), `cenário ${s.id}: status válido`)
    if (s.status !== "not_executed") assert.ok(s.proof, `cenário ${s.id} (${s.status}) precisa citar prova`)
    if (s.status === "not_executed") assert.ok(s.reason, `cenário ${s.id} not_executed precisa de motivo real`)
  }
})

test("todo proof citado em PRD49_SCENARIO_COVERAGE existe de verdade no disco", async () => {
  const { PRD49_SCENARIO_COVERAGE } = await imp()
  for (const s of PRD49_SCENARIO_COVERAGE.filter((x) => x.proof)) {
    assert.ok(existsSync(path.join(repoRoot, s.proof)), `prova do cenário ${s.id} existe: ${s.proof}`)
  }
})

test("CONTROLE NEGATIVO: nenhum cenário not_executed tem proof forjado", async () => {
  const { PRD49_SCENARIO_COVERAGE } = await imp()
  for (const s of PRD49_SCENARIO_COVERAGE.filter((x) => x.status === "not_executed")) {
    assert.equal(s.proof, null, `cenário ${s.id} not_executed não pode ter proof`)
  }
})
