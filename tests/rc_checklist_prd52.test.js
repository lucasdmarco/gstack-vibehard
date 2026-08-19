/**
 * PRD52 S52.H — o checklist de RC do próprio PRD52.
 *
 * O programa que endureceu as réguas dos outros seria o pior lugar do repositório
 * para um checklist frouxo. Estes testes cobram dele três coisas que ele passou o
 * PRD inteiro cobrando dos outros: contagem MEDIDA em vez de digitada, pendência
 * externa NOMEADA em vez de omitida, e prova em disco por trás de cada item
 * `delivered`.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const C = () => imp("src/dream/rc-checklist-prd52.js")

/** Medições sintéticas: o teste não depende do estado do repo no dia em que roda. */
const MEDICOES_SAS = Object.freeze({
  scoreboard: { REAL: 23, NOT_PROVED: 1 },
  reconciliation: { consistent: 23 },
  reconciliationInvalid: 0,
  supportMatrix: { total: 12, proven: 0, counts: { pass: 0, fail: 0, not_run: 12 } },
  codexHooks: { byState: { trust_entry_present: 6 }, enforcementObserved: false },
  boundaryEnforced: true,
})

test("todo item `delivered` tem prova EM DISCO — a regra que o ledger cobra", async () => {
  const { PRD52_RC_ITEMS } = await C()
  for (const i of PRD52_RC_ITEMS.filter((x) => x.status === "delivered")) {
    assert.ok(i.proof, `'${i.id}' delivered sem prova declarada`)
    assert.ok(existsSync(path.join(repoRoot, i.proof)), `'${i.id}': prova declarada não existe — ${i.proof}`)
  }
})

test("os sete sprints do programa estão no checklist, cada um com o seu commit", async () => {
  const { PRD52_RC_ITEMS } = await C()
  const sprints = PRD52_RC_ITEMS.filter((i) => i.tier === "P0").map((i) => i.sprint)
  assert.deepEqual(sprints, ["S52.A", "S52.B", "S52.C", "S52.D", "S52.E", "S52.F", "S52.G"])
  for (const i of PRD52_RC_ITEMS.filter((x) => x.tier === "P0")) {
    assert.match(i.commit, /^[0-9a-f]{7,40}$/, `'${i.id}' sem commit real`)
  }
})

test("as contagens são MEDIDAS, não digitadas — o checklist não congela número", async () => {
  const { prd52Readiness } = await C()
  const r = prd52Readiness(undefined, { medicoes: MEDICOES_SAS })
  assert.deepEqual(r.measurements, MEDICOES_SAS,
    "as medições vêm de fora e passam intactas: nenhum número do placar mora no checklist")
})

test("`ready` fala do que o PROGRAMA controla — não do placar", async () => {
  const { prd52Readiness } = await C()
  const r = prd52Readiness(undefined, { medicoes: MEDICOES_SAS })
  assert.equal(r.ready, true, "P0 entregues, reconciliação válida e fronteira conferida")
  // O placar tem 1 NOT_PROVED e a matriz tem 0/12 provadas; nenhum dos dois
  // derruba `ready`, porque condicioná-lo ao placar faria o gate punir o próprio
  // trabalho de ter endurecido a régua que derrubou a claim.
  assert.equal(r.measurements.scoreboard.NOT_PROVED, 1)
  assert.equal(r.measurements.supportMatrix.proven, 0)
})

test("CONTROLE NEGATIVO: reconciliação inválida derruba `ready`", async () => {
  const { prd52Readiness } = await C()
  const r = prd52Readiness(undefined, { medicoes: { ...MEDICOES_SAS, reconciliationInvalid: 3 } })
  assert.equal(r.ready, false, "registro que não passa na própria validação não sustenta RC")
})

test("CONTROLE NEGATIVO: fronteira PRD53/54 violada derruba `ready`", async () => {
  const { prd52Readiness } = await C()
  const r = prd52Readiness(undefined, { medicoes: { ...MEDICOES_SAS, boundaryEnforced: false } })
  assert.equal(r.ready, false, "motor do PRD54 dentro do PRD52 invalida o programa, não só o sprint")
})

test("CONTROLE NEGATIVO: P0 não entregue derruba `ready` mesmo com tudo medido verde", async () => {
  const { prd52Readiness, PRD52_RC_ITEMS } = await C()
  const quebrado = PRD52_RC_ITEMS.map((i) => (i.id === "P0.4" ? { ...i, status: "partial" } : i))
  const r = prd52Readiness(quebrado, { medicoes: MEDICOES_SAS })
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["P0.4"])
})

test("`fullyValidated` é FALSO enquanto houver evidência que só existe fora", async () => {
  const { prd52Readiness, PRD52_EXTERNAL_PENDING } = await C()
  const r = prd52Readiness(undefined, { medicoes: MEDICOES_SAS })
  assert.equal(r.fullyValidated, false)
  assert.equal(r.counts.externalPending, PRD52_EXTERNAL_PENDING.length)
  const semPendencia = prd52Readiness(undefined, { medicoes: MEDICOES_SAS, externalPending: [] })
  assert.equal(semPendencia.fullyValidated, true, "a negativa é MEDIDA pelas pendências, não fixa no código")
})

test("cada pendência externa diz o que falta E quem pode fechá-la", async () => {
  const { PRD52_EXTERNAL_PENDING } = await C()
  assert.ok(PRD52_EXTERNAL_PENDING.length >= 2)
  for (const e of PRD52_EXTERNAL_PENDING) {
    assert.ok(e.id && e.blockedBy && e.owner, `pendência '${e.id}' sem dono ou sem bloqueador`)
    assert.ok(e.missing.length > 80, `'${e.id}': o que falta precisa ser acionável, não um rótulo`)
  }
  const bloqueadores = PRD52_EXTERNAL_PENDING.map((e) => e.blockedBy)
  assert.ok(bloqueadores.includes("external_ci_execution"), "as células OS×Node exigem o CI rodando")
  assert.ok(bloqueadores.includes("external_clean_machine"), "enforcement do Codex exige máquina limpa")
  // O `action_kernel_claim_conflict` SAIU daqui no S52.I -- foi fechado escrevendo
  // o E2E, e uma pendencia fechada por trabalho nao pode continuar listada como
  // se dependesse de decisao humana.
  assert.ok(!PRD52_EXTERNAL_PENDING.some((e) => e.id === "action_kernel_claim_conflict"),
    "pendência fechada por trabalho sai da lista; o registro de como foi fechada vive no teeth-baseline")
})

test("NENHUMA pendência externa é declarada fechada por trabalho neste repositório", async () => {
  const { PRD52_EXTERNAL_PENDING } = await C()
  const fechaveisAqui = PRD52_EXTERNAL_PENDING.filter((e) => e.blockedBy === "delivered" || e.blockedBy === "none")
  assert.deepEqual(fechaveisAqui, [], "se desse para fechar aqui, seria item de sprint — não pendência")
})

// ── A medição contra o repositório REAL ────────────────────────────────────

test("as medições ao vivo leem o repo real e produzem reconciliação VÁLIDA com commit", async () => {
  const { medicoesAoVivo } = await C()
  const m = medicoesAoVivo({ repoRoot, commit: "abc1234" })
  assert.equal(m.reconciliationInvalid, 0,
    "medir COM commit é o que torna o registro válido — sem ele o §26.1 recusa todos")
  assert.equal(m.boundaryEnforced, true)
  assert.equal(m.supportMatrix.total, 12)
})

test("CONTROLE NEGATIVO: medir SEM commit invalida TODA a reconciliação", async () => {
  const { medicoesAoVivo } = await C()
  const m = medicoesAoVivo({ repoRoot, commit: null })
  assert.ok(m.reconciliationInvalid > 0,
    "recibo sem proveniência não é evidência — foi o defeito real da primeira fiação do `prd status`")
})

test("`prd status` agrega o PRD52 e publica as pendências externas", async () => {
  const { buildPrdStatusReport } = await imp("src/commands/prd.js")
  const ids = buildPrdStatusReport(repoRoot).map((p) => p.prdId)
  assert.ok(ids.includes("PRD52"), "o programa que audita os outros não pode ficar fora do ledger")
  assert.deepEqual(ids, ["PRD45", "PRD46", "PRD47", "PRD48", "PRD49", "PRD50", "PRD51", "PRD52"])
})

test("o ledger não encontra violação no PRD52 (nenhum `delivered` sem prova)", async () => {
  const { buildPrdStatusReport } = await imp("src/commands/prd.js")
  const p52 = buildPrdStatusReport(repoRoot).find((p) => p.prdId === "PRD52")
  assert.deepEqual(p52.violations, [])
  assert.equal(p52.programComplete, true, "os nove itens estão fechados; o que falta é externo")
  for (const e of p52.evidence) assert.ok(e.hash, `evidência sem hash real: ${e.proof}`)
})
