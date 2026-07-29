import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.8.1 — ações 5/6/7 do Sprint 51.8.
 *
 * Defeito real corrigido aqui: `prd50Readiness().fullyValidated` era
 * `PENDING_CLAIMS.length === 0`, e essa lista misturava claims que esperam
 * rótulo humano (ALCANÇÁVEIS) com um claim `not_measurable_by_design` (o
 * overhead do EV0 dentro do harness, que o GStack estruturalmente nunca
 * observa). Somados, o segundo tornava `fullyValidated` IMPOSSÍVEL: nenhuma
 * quantidade de trabalho humano zeraria a conta. O PRD chama isso de
 * "pendência impossível" e manda tratar como limitação explícita.
 */

const HUMANO = { claim: "precisão em casos ambíguos é X%", blockedBy: "human_labeling", missing: "rótulo humano cego" }
const HUMANO2 = { claim: "relevância à intenção é X%", blockedBy: "human_labeling", missing: "avaliação humana" }
const NUNCA = { claim: "overhead do EV0 dentro do harness <= 8%", blockedBy: "not_measurable_by_design", missing: "o GStack nunca vê a resposta do harness" }

test("partitionClaims separa o ALCANÇÁVEL do estruturalmente inobservável", async () => {
  const { partitionClaims } = await imp("src/epistemic/validation-taxonomy.js")
  const p = partitionClaims([HUMANO, NUNCA, HUMANO2])
  assert.equal(p.pendingHumanValidation.length, 2)
  assert.equal(p.unobservableByDesign.length, 1)
  assert.equal(p.unclassified.length, 0)
})

// A correção central do sub-sprint.
test("O DEFEITO: claim inobservável NÃO pode travar fullyValidated (pendência impossível)", async () => {
  const { measurableValidationComplete } = await imp("src/epistemic/validation-taxonomy.js")
  // Só o inobservável sobrou: todo o trabalho humano possível já foi feito.
  assert.equal(measurableValidationComplete([NUNCA]), true, "o que ninguém pode fechar não é dívida")
  // Regra antiga (`length === 0`) diria false aqui para sempre.
  assert.notEqual([NUNCA].length, 0, "a lista NÃO está vazia — é a mistura que era o bug")
})

test("claim humano ainda aberto CONTINUA travando (a correção não afrouxa nada)", async () => {
  const { measurableValidationComplete } = await imp("src/epistemic/validation-taxonomy.js")
  assert.equal(measurableValidationComplete([HUMANO, NUNCA]), false)
  assert.equal(measurableValidationComplete([HUMANO]), false)
})

test("FAIL-CLOSED: lista vazia é AUSÊNCIA de evidência, não validação completa", async () => {
  const { measurableValidationComplete } = await imp("src/epistemic/validation-taxonomy.js")
  assert.equal(measurableValidationComplete([]), false, "sem nada declarado, nunca validado")
  assert.equal(measurableValidationComplete(), false)
})

test("CONTROLE NEGATIVO: categoria DESCONHECIDA derruba — nunca é 'mensurável' por omissão", async () => {
  const { measurableValidationComplete, validationTaxonomy } = await imp("src/epistemic/validation-taxonomy.js")
  const novo = { claim: "algo novo", blockedBy: "categoria_que_ninguem_classificou", missing: "?" }
  assert.equal(measurableValidationComplete([NUNCA, novo]), false, "não sabemos se é dívida -> não fecha")
  assert.equal(validationTaxonomy([NUNCA, novo]).counts.unclassified, 1, "e o desconhecido é REPORTADO, não engolido")
})

test("CONTROLE NEGATIVO: sem `blockedBy` nenhum, o claim cai em unclassified (não vira inobservável)", async () => {
  const { validationTaxonomy } = await imp("src/epistemic/validation-taxonomy.js")
  const t = validationTaxonomy([{ claim: "sem categoria" }])
  assert.equal(t.counts.unclassified, 1)
  assert.equal(t.counts.unobservableByDesign, 0, "omitir a categoria não pode virar isenção")
  assert.equal(t.measurableValidationComplete, false)
})

test("validationTaxonomy explica a diferença no próprio payload (não só em comentário)", async () => {
  const { validationTaxonomy } = await imp("src/epistemic/validation-taxonomy.js")
  const t = validationTaxonomy([HUMANO, NUNCA])
  assert.equal(t.schemaVersion, "gstack.validation-taxonomy.v1")
  assert.match(t.note, /NÃO dívida/)
  assert.equal(t.unobservableByDesign[0].reason, NUNCA.missing, "o inobservável carrega o PORQUÊ")
  assert.equal(t.pendingHumanValidation[0].missing, HUMANO.missing, "o pendente carrega o QUE FALTA")
})

// Wiring real no checklist do PRD50.
test("WIRING REAL: prd50Readiness passa a distinguir as duas categorias", async () => {
  const { prd50Readiness } = await imp("src/dream/rc-checklist-prd50.js")
  const r = prd50Readiness()
  assert.equal(r.ready, true, "os 3 P0 seguem delivered")
  assert.equal(r.counts.unobservableByDesign, 1, "o overhead do harness é limitação declarada")
  assert.ok(r.counts.pendingClaims >= 1, "e ainda há rotulagem humana real pendente")
  assert.equal(r.fullyValidated, false, "false pela razão CERTA (rótulo humano), não pela impossível")
})

test("prova de que a razão MUDOU: fechada a rotulagem humana, fullyValidated finalmente pode virar true", async () => {
  const { prd50Readiness, PRD50_RC_ITEMS } = await imp("src/dream/rc-checklist-prd50.js")
  // Mesmo cenário do repo, mas com a fatia humana concluída — só o inobservável resta.
  const r = prd50Readiness(PRD50_RC_ITEMS, [{ claim: "overhead no harness", blockedBy: "not_measurable_by_design", missing: "estrutural" }])
  assert.equal(r.fullyValidated, true, "antes desta correção seria false PARA SEMPRE")
})

// O relatório do benchmark tinha o mesmo problema em forma de constante.
test("buildBenchmarkReport: fullyValidated deixou de ser `false` hardcoded e virou derivado", async () => {
  const { buildBenchmarkReport } = await imp("src/epistemic/benchmark.js")
  const verdes = { falseSupported: { falseSupported: 0 }, toolReceipts: { ok: true }, provedFromLlm: { ok: true }, citationLeak: { ok: true }, classification: { accuracy: 1 } }
  assert.equal(buildBenchmarkReport(verdes).fullyValidated, false, "sem registro de rotulagem, segue fail-closed")
  const comRotulos = { ...verdes, pendingHuman: { count: 0, labelingPerformed: true } }
  assert.equal(buildBenchmarkReport(comRotulos).fullyValidated, true, "com rotulagem cega registrada e zerada, fecha")
})

test("CONTROLE NEGATIVO: rotulagem registrada mas com caso aberto, ou gate objetivo vermelho, NÃO fecha", async () => {
  const { buildBenchmarkReport } = await imp("src/epistemic/benchmark.js")
  const base = { falseSupported: { falseSupported: 0 }, toolReceipts: { ok: true }, provedFromLlm: { ok: true }, citationLeak: { ok: true }, classification: { accuracy: 1 } }
  assert.equal(buildBenchmarkReport({ ...base, pendingHuman: { count: 3, labelingPerformed: true } }).fullyValidated, false)
  assert.equal(buildBenchmarkReport({ ...base, falseSupported: { falseSupported: 1 }, pendingHuman: { count: 0, labelingPerformed: true } }).fullyValidated, false)
})

test("CONTROLE NEGATIVO: `count:0` sem labelingPerformed (corpus vazio) nunca vale por validação", async () => {
  const { buildBenchmarkReport, pendingHumanLabeling } = await imp("src/epistemic/benchmark.js")
  const base = { falseSupported: { falseSupported: 0 }, toolReceipts: { ok: true }, provedFromLlm: { ok: true }, citationLeak: { ok: true }, classification: { accuracy: 1 } }
  assert.equal(buildBenchmarkReport({ ...base, pendingHuman: { count: 0 } }).fullyValidated, false)
  assert.equal(pendingHumanLabeling([]).labelingPerformed, false, "o default declara que ninguém rotulou")
})
