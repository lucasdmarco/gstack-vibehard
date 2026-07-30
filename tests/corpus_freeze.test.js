import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.8.2 — congelamento de corpus/holdout ANTES dos rótulos
 * (§51.8, ações 1 e 4).
 *
 * O que isto fecha é metodológico: enquanto o corpus puder ser editado depois
 * de ver os rótulos, qualquer número medido sobre ele é negociável — dá pra
 * apagar o caso que deu errado, reescrever o enunciado ambíguo, mover um caso
 * do holdout pro conjunto de rotulagem. Sem congelamento verificável, nada
 * disso deixa rastro.
 */

const CASOS = [
  { id: "c1", claim: "a reduz b", groundTruth: "true" },
  { id: "c2", claim: "x elimina y", groundTruth: "false" },
  { id: "c3", claim: "talvez z", groundTruth: "ambiguous", requiresHumanLabel: true },
  { id: "c4", claim: "sem dados", groundTruth: "insufficient" },
  { id: "c5", claim: "outro caso", groundTruth: "true" },
  { id: "c6", claim: "mais um", groundTruth: "false" },
]
const SEED = "prd51-s51.8.2"

test("freeze é DETERMINÍSTICO: mesma semente e mesmos casos -> mesmo hash e mesma partição", async () => {
  const { freezeCorpus } = await imp("src/epistemic/corpus-freeze.js")
  const a = freezeCorpus({ cases: CASOS, seed: SEED, frozenAt: "2026-07-29T00:00:00.000Z" })
  const b = freezeCorpus({ cases: CASOS, seed: SEED, frozenAt: "2026-07-29T00:00:00.000Z" })
  assert.equal(a.corpusHash, b.corpusHash)
  assert.deepEqual(a.entries, b.entries)
})

test("reordenar o corpus NÃO muda a partição (o bucket vem do id, não da posição)", async () => {
  const { freezeCorpus } = await imp("src/epistemic/corpus-freeze.js")
  const a = freezeCorpus({ cases: CASOS, seed: SEED })
  const b = freezeCorpus({ cases: [...CASOS].reverse(), seed: SEED })
  assert.equal(a.corpusHash, b.corpusHash, "a ordem do array não pode escolher o holdout")
})

// Este controle negativo achou uma fraqueza REAL na primeira versão: o hash
// cobria só a partição, então duas sementes que por acaso produzissem a MESMA
// divisão davam hashes iguais — impossível provar depois qual semente foi
// declarada antes dos rótulos. A metodologia (seed + ratio) passou a entrar
// no hash.
test("a METODOLOGIA entra no hash: sementes diferentes nunca colidem, mesmo com a mesma partição", async () => {
  const { freezeCorpus, holdoutIds } = await imp("src/epistemic/corpus-freeze.js")
  const a = freezeCorpus({ cases: CASOS, seed: "semente-a" })
  const b = freezeCorpus({ cases: CASOS, seed: "semente-b" })
  assert.notEqual(a.corpusHash, b.corpusHash, "o hash amarra a semente declarada")
  // O caso que expôs a fraqueza: partição idêntica, sementes distintas.
  if (JSON.stringify(holdoutIds(a)) === JSON.stringify(holdoutIds(b))) {
    assert.notEqual(a.corpusHash, b.corpusHash, "mesma partição + semente diferente ainda tem que divergir")
  }
})

test("a razão de holdout também entra no hash (mudar o ratio é mudar a metodologia)", async () => {
  const { freezeCorpus } = await imp("src/epistemic/corpus-freeze.js")
  const a = freezeCorpus({ cases: CASOS, seed: SEED, holdoutRatio: 0.3 })
  const b = freezeCorpus({ cases: CASOS, seed: SEED, holdoutRatio: 0.5 })
  assert.notEqual(a.corpusHash, b.corpusHash)
})

test("freeze sem semente FALHA — partição irreprodutível não é congelamento", async () => {
  const { freezeCorpus } = await imp("src/epistemic/corpus-freeze.js")
  assert.throws(() => freezeCorpus({ cases: CASOS }), /seed/)
})

test("ids duplicados FALHAM — um congelamento não-endereçável não prova nada", async () => {
  const { freezeCorpus } = await imp("src/epistemic/corpus-freeze.js")
  assert.throws(() => freezeCorpus({ cases: [...CASOS, { id: "c1", claim: "clone" }], seed: SEED }), /duplicad/)
})

test("holdout e conjunto de rotulagem são disjuntos e somam o corpus inteiro", async () => {
  const { freezeCorpus, labelableIds, holdoutIds } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const lab = labelableIds(f)
  const hold = holdoutIds(f)
  assert.equal(lab.length + hold.length, CASOS.length)
  assert.equal(lab.filter((id) => hold.includes(id)).length, 0, "nenhum caso nos dois lados")
})

// A garantia central: edição pós-congelamento é detectada.
test("CASO EDITADO depois do freeze é DETECTADO (não se ajusta o alvo depois de mirar)", async () => {
  const { freezeCorpus, verifyFrozenCorpus } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const mexido = CASOS.map((c) => (c.id === "c2" ? { ...c, groundTruth: "true" } : c))
  const v = verifyFrozenCorpus(f, mexido)
  assert.equal(v.intact, false)
  assert.deepEqual(v.modified, ["c2"])
})

test("caso REMOVIDO e caso ADICIONADO depois do freeze são detectados separadamente", async () => {
  const { freezeCorpus, verifyFrozenCorpus } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const v = verifyFrozenCorpus(f, [...CASOS.filter((c) => c.id !== "c4"), { id: "c99", claim: "novo" }])
  assert.deepEqual(v.removed, ["c4"])
  assert.deepEqual(v.added, ["c99"])
  assert.equal(v.intact, false)
})

test("corpus INTACTO verifica limpo", async () => {
  const { freezeCorpus, verifyFrozenCorpus } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  assert.equal(verifyFrozenCorpus(f, CASOS).intact, true)
})

// Congelamos a PERGUNTA, não a resposta.
test("adicionar o RÓTULO a um caso NÃO invalida o freeze (senão rotular quebraria o congelamento)", async () => {
  const { freezeCorpus, verifyFrozenCorpus } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const rotulados = CASOS.map((c) => ({ ...c, humanLabel: "supports", adjudication: null }))
  assert.equal(verifyFrozenCorpus(f, rotulados).intact, true)
})

// Ação 4: versionar rótulos e metodologia, nunca os dados.
test("AÇÃO 4: o artefato de freeze NÃO carrega conteúdo do caso — só id, hash e partição", async () => {
  const { freezeCorpus, assertNoRawContent } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const r = assertNoRawContent(f)
  assert.equal(r.ok, true, `vazou: ${r.leaked.join(", ")}`)
  assert.ok(!JSON.stringify(f).includes("a reduz b"), "nenhum enunciado no artefato")
  assert.ok(!JSON.stringify(f).includes("ambiguous"), "nenhum gabarito no artefato")
})

test("CONTROLE NEGATIVO: se o artefato passasse a carregar o conteúdo, assertNoRawContent ACUSA", async () => {
  const { freezeCorpus, assertNoRawContent } = await imp("src/epistemic/corpus-freeze.js")
  const vazado = { ...freezeCorpus({ cases: CASOS, seed: SEED }), cases: CASOS }
  const r = assertNoRawContent(vazado)
  assert.equal(r.ok, false)
  assert.ok(r.leaked.includes("claim"), "aponta QUAL chave vazou, não só que vazou")
})

// Aceitação de rótulos.
test("rótulos sobre corpus MODIFICADO são REJEITADOS", async () => {
  const { freezeCorpus, acceptLabels, labelableIds } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const labels = labelableIds(f).map((id) => ({ caseId: id, value: "supports" }))
  const mexido = CASOS.map((c) => (c.id === labelableIds(f)[0] ? { ...c, claim: "reescrito" } : c))
  const r = acceptLabels({ frozen: f, cases: mexido, labels })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, "corpus_modified_after_freeze")
})

test("CONTROLE NEGATIVO: rótulo em caso do HOLDOUT é rejeitado (contaminaria a fatia reservada)", async () => {
  const { freezeCorpus, acceptLabels, holdoutIds } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const held = holdoutIds(f)
  assert.ok(held.length > 0, "a partição desta semente reserva pelo menos um caso")
  const r = acceptLabels({ frozen: f, cases: CASOS, labels: [{ caseId: held[0], value: "supports" }] })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, "labels_on_holdout")
})

test("CONTROLE NEGATIVO: rótulo de caso FORA do corpus congelado é rejeitado", async () => {
  const { freezeCorpus, acceptLabels } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const r = acceptLabels({ frozen: f, cases: CASOS, labels: [{ caseId: "inventado", value: "supports" }] })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, "labels_outside_corpus")
})

test("rótulos válidos sobre corpus íntegro são aceitos e carimbados com o corpusHash", async () => {
  const { freezeCorpus, acceptLabels, labelableIds } = await imp("src/epistemic/corpus-freeze.js")
  const f = freezeCorpus({ cases: CASOS, seed: SEED })
  const labels = labelableIds(f).map((id) => ({ caseId: id, value: "supports" }))
  const r = acceptLabels({ frozen: f, cases: CASOS, labels })
  assert.equal(r.accepted, true)
  assert.equal(r.corpusHash, f.corpusHash, "o lote de rótulos fica amarrado ao congelamento que o autorizou")
})

// Corpus REAL do repo, não só fixture sintética.
test("funciona sobre o corpus REAL do PRD50 (tests/fixtures/epistemic/corpus.json)", async () => {
  const { freezeCorpus, verifyFrozenCorpus, assertNoRawContent } = await imp("src/epistemic/corpus-freeze.js")
  const raw = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "epistemic", "corpus.json"), "utf-8"))
  const cases = raw.cases || raw.corpus || []
  assert.ok(cases.length > 0, "o corpus real tem casos")
  const f = freezeCorpus({ cases, seed: "prd50-corpus" })
  assert.equal(f.counts.total, cases.length)
  assert.equal(verifyFrozenCorpus(f, cases).intact, true)
  assert.equal(assertNoRawContent(f).ok, true, "nem sobre o corpus real o artefato vaza conteúdo")
})
