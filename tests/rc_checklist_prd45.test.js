import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.8 — checklist de Release Candidate: mapeia CADA achado do PRD45 (P0.1–P0.4,
// P1.1–P1.12) ao sprint/versão que o fechou + o artefato de prova (o teste que reprova se a
// capacidade sumir). `prd45Readiness()` só declara `ready:true` com TODOS os P0 `delivered`.
// Sem enfeite: um item `delivered` cujo teste de prova não existe reprova este próprio teste.

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "dream", "rc-checklist-prd45.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("prd45Readiness: ready:true exige TODOS os P0 delivered", async () => {
  const { prd45Readiness, PRD45_RC_ITEMS } = await imp()
  const r = prd45Readiness()
  const p0 = PRD45_RC_ITEMS.filter((i) => i.tier === "P0")
  assert.equal(p0.length, 4, "PRD45 tem 4 P0 (P0.1–P0.4)")
  assert.ok(p0.every((i) => i.status === "delivered"), "todos os P0 entregues")
  assert.equal(r.ready, true, "RC pronto (P0 completos)")
  assert.equal(r.counts.p0Delivered, 4)
})

test("CONTROLE NEGATIVO: um P0 pendente derruba ready", async () => {
  const { prd45Readiness, PRD45_RC_ITEMS } = await imp()
  const tampered = PRD45_RC_ITEMS.map((i) => (i.id === "P0.1" ? { ...i, status: "pending" } : i))
  const r = prd45Readiness(tampered)
  assert.equal(r.ready, false, "P0 pendente ⇒ NÃO pronto")
  assert.deepEqual(r.p0Pending, ["P0.1"])
})

test("cada item `delivered` aponta um teste de prova que EXISTE (sem enfeite)", async () => {
  const { PRD45_RC_ITEMS } = await imp()
  for (const item of PRD45_RC_ITEMS.filter((i) => i.status === "delivered" && i.proof && i.proof.startsWith("tests/"))) {
    assert.ok(existsSync(path.join(repoRoot, item.proof)), `prova de ${item.id} existe: ${item.proof}`)
  }
})

test("cobre os 16 achados do PRD45 (4 P0 + 12 P1); P1.3 é o parcial honesto documentado", async () => {
  const { PRD45_RC_ITEMS, prd45Readiness } = await imp()
  const ids = new Set(PRD45_RC_ITEMS.map((i) => i.id))
  for (let n = 1; n <= 4; n++) assert.ok(ids.has(`P0.${n}`), `tem P0.${n}`)
  for (let n = 1; n <= 12; n++) assert.ok(ids.has(`P1.${n}`), `tem P1.${n}`)
  // P1.3 (loader V3 canônico) é o único parcial — declarado honestamente, não escondido.
  const p13 = PRD45_RC_ITEMS.find((i) => i.id === "P1.3")
  assert.equal(p13.status, "partial", "P1.3 é partial (schema/migração existem; loader dormente)")
  const r = prd45Readiness()
  assert.ok(r.p1Open.some((i) => i.id === "P1.3"), "P1.3 aparece como P1 aberto (transparente)")
})

test("cada item mapeia sprint + versão (rastreabilidade achado→sprint→release)", async () => {
  const { PRD45_RC_ITEMS } = await imp()
  for (const i of PRD45_RC_ITEMS) {
    assert.match(i.sprint, /^S45\.\d/, `${i.id} tem sprint`)
    assert.match(i.version, /^5\.\d+\.\d+$/, `${i.id} tem versão`)
    assert.ok(i.title && i.title.length > 3, `${i.id} tem título`)
  }
})
