import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD51 S51.10.1 — checklist canônico do próprio PRD51. Até aqui, o programa de
 * FECHAMENTO era o único sem checklist: `prd status` agregava PRD45-PRD50 e deixava de
 * fora justamente quem audita os outros.
 *
 * O que este arquivo protege não é a contagem — é a honestidade da contagem: prova que
 * existe em disco, DoD que não se satisfaz por omissão, e `ready` que nunca implica
 * `programComplete`.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "dream", "rc-checklist-prd51.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("cada item aponta uma prova que EXISTE em disco (a regra que o S51.3 aprendeu quebrando)", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  for (const i of PRD51_RC_ITEMS) {
    assert.ok(i.proof, `${i.id} declara prova`)
    assert.ok(existsSync(path.join(repoRoot, i.proof)), `prova de ${i.id} existe: ${i.proof}`)
  }
})

test("cada item mapeia sprint + versão + tier válido (rastreabilidade achado→sprint→release)", async () => {
  const { PRD51_RC_ITEMS } = await imp()
  const tiers = new Set(["P0", "P1", "P2"])
  for (const i of PRD51_RC_ITEMS) {
    assert.match(i.sprint, /^S51\./, `${i.id} tem sprint do PRD51`)
    assert.match(i.version, /^5\.\d+\.\d+$/, `${i.id} tem versão`)
    assert.ok(tiers.has(i.tier), `${i.id} tem tier válido`)
    assert.ok(i.title && i.title.length > 10, `${i.id} tem título descritivo`)
  }
})

test("o DoD cobre as 24 caixas do §9 do prd51.md, cada uma com kind declarado", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  assert.equal(PRD51_DOD_ITEMS.length, 24, "§9 tem 24 caixas")
  const kinds = new Set(["static", "runtime", "derived"])
  for (const d of PRD51_DOD_ITEMS) {
    assert.ok(kinds.has(d.kind), `${d.id} declara kind`)
    assert.ok(d.requirement && d.requirement.length > 10, `${d.id} tem requisito`)
  }
})

test("INVARIANTE: toda caixa não-satisfeita diz O QUE falta — nada pendente em silêncio", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  for (const d of PRD51_DOD_ITEMS.filter((x) => x.status !== "satisfied")) {
    assert.ok(d.missing && d.missing.length > 20, `${d.id} explica a ausência em vez de só marcar pendente`)
  }
})

test("INVARIANTE: toda caixa satisfeita aponta evidência — nunca 'satisfied' por decreto", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  for (const d of PRD51_DOD_ITEMS.filter((x) => x.status === "satisfied")) {
    assert.ok(d.evidence, `${d.id} aponta evidência`)
  }
})

test("evidência estática do DoD existe em disco (uma caixa não pode citar teste inexistente)", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  for (const d of PRD51_DOD_ITEMS.filter((x) => x.evidence && x.evidence.startsWith("tests/"))) {
    assert.ok(existsSync(path.join(repoRoot, d.evidence)), `evidência de ${d.id} existe: ${d.evidence}`)
  }
})

test("nenhuma caixa `runtime` é dada como satisfeita — execução não se presume por existir código", async () => {
  const { PRD51_DOD_ITEMS } = await imp()
  const runtimeSatisfeitas = PRD51_DOD_ITEMS.filter((d) => d.kind === "runtime" && d.status === "satisfied")
  assert.deepEqual(runtimeSatisfeitas, [], "suíte fria, proof no HEAD e matriz cross-OS só fecham executando")
})

test("prd51Readiness: sprints fecharam (ready:true) mas o DoD NÃO (programComplete:false) — a separação é o ponto", async () => {
  const { prd51Readiness } = await imp()
  const r = prd51Readiness()
  assert.equal(r.ready, true, "todo P0 dos sprints está fechado")
  assert.equal(r.programComplete, false, "o §9 ainda tem caixas abertas — ready nunca autoriza 'concluído'")
  assert.ok(r.counts.dodOpen > 0)
  assert.equal(r.counts.dodSatisfied + r.counts.dodOpen, r.counts.dod)
})

test("openDoD expõe cada pendência com o que falta (o RC precisa saber, não descobrir)", async () => {
  const { prd51Readiness } = await imp()
  const r = prd51Readiness()
  assert.ok(r.openDoD.length > 0)
  for (const d of r.openDoD) assert.ok(d.missing, `${d.id} carrega o que falta`)
  assert.ok(r.openDoD.some((d) => d.id === "DOD.22"), "manual em v5.19 é uma pendência declarada, não esquecida")
})

test("CONTROLE NEGATIVO: um P0 que regredir derruba ready E programComplete", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const regredido = PRD51_RC_ITEMS.map((i) => (i.id === "S51.2.7" ? { ...i, status: "partial" } : i))
  const r = prd51Readiness(regredido, PRD51_DOD_ITEMS)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["S51.2.7"])
  assert.equal(r.programComplete, false)
})

test("CONTROLE POSITIVO: com todo o DoD satisfeito E os P0 fechados, programComplete vira true", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const tudoOk = PRD51_DOD_ITEMS.map((d) => ({ ...d, status: "satisfied", evidence: d.evidence || "sintético" }))
  const r = prd51Readiness(PRD51_RC_ITEMS, tudoOk)
  assert.equal(r.programComplete, true, "o caminho para 'concluído' existe — não é inalcançável por construção")
  assert.equal(r.counts.dodOpen, 0)
})

test("CONTROLE NEGATIVO: uma única caixa `partial` do DoD já impede programComplete", async () => {
  const { prd51Readiness, PRD51_RC_ITEMS, PRD51_DOD_ITEMS } = await imp()
  const umaAberta = PRD51_DOD_ITEMS.map((d, idx) => (idx === 0 ? { ...d, status: "partial", missing: "recorte declarado só para este controle negativo" } : { ...d, status: "satisfied", evidence: "sintético" }))
  const r = prd51Readiness(PRD51_RC_ITEMS, umaAberta)
  assert.equal(r.programComplete, false, "`partial` não é `satisfied` — meia prova não fecha caixa")
})
