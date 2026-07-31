import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD47 S47.10 — checklist de Release Candidate: mapeia CADA achado do PRD47 (P0.1–P0.4,
// P1.1–P1.10) ao sprint/versão + o artefato de prova. `prd47Readiness()` só declara
// `ready:true` com TODOS os P0 `delivered`. Sem enfeite: um item cujo teste de prova não
// existe reprova este próprio teste.

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "dream", "rc-checklist-prd47.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

// PRD51 S51.10.1 — o cutover do Sprint 51.2 + o flip do default (S51.10.0) fecharam os P0
// que estavam `partial` desde S47.10. A distinção que os mantinha parciais era exatamente
// "a lógica existe" vs "a lógica governa o caminho padrão"; só a segunda fecha.
test("prd47Readiness: 3 P0 delivered + P0.2 non-goal explícito -> ready:true", async () => {
  const { prd47Readiness, PRD47_RC_ITEMS } = await imp()
  const p0 = PRD47_RC_ITEMS.filter((i) => i.tier === "P0")
  assert.equal(p0.length, 4, "PRD47 tem 4 P0 (P0.1–P0.4)")
  const r = prd47Readiness()
  assert.equal(r.ready, true)
  assert.equal(r.counts.p0Delivered, 3)
  assert.equal(r.counts.p0NonGoal, 1)
  assert.equal(r.p0Pending.length, 0)
})

test("P0.2 é non-goal COM razão registrada — e a razão é exposta, nunca só o número", async () => {
  const { prd47Readiness, PRD47_RC_ITEMS } = await imp()
  const p02 = PRD47_RC_ITEMS.find((i) => i.id === "P0.2")
  assert.equal(p02.nonGoal, true)
  assert.ok(p02.nonGoalReason && p02.nonGoalReason.length > 40, "razão registrada, não um flag solto")
  const r = prd47Readiness()
  assert.ok(r.p0NonGoal.some((i) => i.id === "P0.2" && i.reason), "ready:true não pode esconder 'decidimos não fazer'")
})

test("CONTROLE NEGATIVO: non-goal SEM razão não fecha item — a porta dos fundos está trancada", async () => {
  const { prd47Readiness, PRD47_RC_ITEMS } = await imp()
  const semRazao = PRD47_RC_ITEMS.map((i) => (i.id === "P0.2" ? { ...i, nonGoalReason: undefined } : i))
  const r = prd47Readiness(semRazao)
  assert.equal(r.ready, false, "nonGoal:true sem razão nunca pode zerar um P0")
  assert.deepEqual(r.p0Pending, ["P0.2"])
})

test("CONTROLE NEGATIVO: um P0 que regredir para partial derruba ready", async () => {
  const { prd47Readiness, PRD47_RC_ITEMS } = await imp()
  const regredido = PRD47_RC_ITEMS.map((i) => (i.id === "P0.1" ? { ...i, status: "partial" } : i))
  const r = prd47Readiness(regredido)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["P0.1"])
})

test("cada item aponta um teste/script de prova que EXISTE (sem enfeite)", async () => {
  const { PRD47_RC_ITEMS } = await imp()
  for (const item of PRD47_RC_ITEMS.filter((i) => i.proof && (i.proof.startsWith("tests/") || i.proof.startsWith("scripts/")))) {
    assert.ok(existsSync(path.join(repoRoot, item.proof)), `prova de ${item.id} existe: ${item.proof}`)
  }
})

test("cobre os 14 achados do PRD47 (4 P0 + 10 P1); P1.8 (vertical) é o parcial honesto documentado", async () => {
  const { PRD47_RC_ITEMS, prd47Readiness } = await imp()
  const ids = new Set(PRD47_RC_ITEMS.map((i) => i.id))
  for (let n = 1; n <= 4; n++) assert.ok(ids.has(`P0.${n}`), `tem P0.${n}`)
  for (let n = 1; n <= 10; n++) assert.ok(ids.has(`P1.${n}`), `tem P1.${n}`)
  const p18 = PRD47_RC_ITEMS.find((i) => i.id === "P1.8")
  assert.equal(p18.status, "partial", "P1.8 (vertical saas-auth-stripe) é partial — 7/14 evidências")
  const r = prd47Readiness()
  assert.ok(r.p1Open.some((i) => i.id === "P1.8"), "P1.8 aparece como P1 aberto (transparente)")
})

test("cada item mapeia sprint + versão (rastreabilidade achado→sprint→release)", async () => {
  const { PRD47_RC_ITEMS } = await imp()
  for (const i of PRD47_RC_ITEMS) {
    assert.match(i.sprint, /^S47\.\d/, `${i.id} tem sprint`)
    assert.match(i.version, /^5\.\d+\.\d+$/, `${i.id} tem versão`)
    assert.ok(i.title && i.title.length > 3, `${i.id} tem título`)
  }
})
