/**
 * PRD54 Sprint 54.0 — o portão de entrada do último programa da fila.
 *
 * Aqui o risco não é o portão ser frouxo; é ele ser DECORATIVO. O PRD54 depende
 * de dois programas que não fecharam, e um gate que apenas repetisse "bloqueado"
 * sem dizer o que falta seria indistinguível de desistência. O que estes testes
 * cobram é que cada bloqueio carregue o roteiro do que medir.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const G = () => imp("src/dream/prd54-entry-gate.js")

test("o portão BLOQUEIA e nomeia cada critério do §2", async () => {
  const { prd54EntryGate } = await G()
  const g = prd54EntryGate({ repoRoot, commit: "abc1234" })
  assert.equal(g.entered, false, "o PRD54 é o último da fila e depende de PRD52 e PRD53 fechados")
  assert.equal(g.status, "blocked")
  assert.equal(g.criteria.length, 5)
  for (const c of g.missing) {
    assert.ok(c.detail.length > 40, `'${c.id}' bloqueia sem dizer o que falta`)
    assert.ok(c.source, `'${c.id}' bloqueia sem dizer de onde veio a medição`)
  }
})

test("a CADEIA aparece: o PRD54 sabe que o PRD53 nem entrou, e por quê", async () => {
  const { prd54EntryGate } = await G()
  const g = prd54EntryGate({ repoRoot, commit: "abc1234" })
  const p53 = g.criteria.find((c) => c.id === "prd53_concluido")
  assert.equal(p53.state, "unproven")
  assert.match(p53.detail, /nem ENTROU/)
  // O detalhe cita os critérios do PRD53 que faltam — sem isso, fechar o PRD54
  // pareceria um problema do PRD54.
  assert.match(p53.detail, /clean_machine_certificado|pacote_cross_os|zero_p0_aberto/)
})

test("o P0 do §2.1 carrega as OITO provas — bloqueio sem roteiro vira desânimo", async () => {
  const { prd54EntryGate, PROVAS_DO_P0_RUNTIME } = await G()
  assert.equal(PROVAS_DO_P0_RUNTIME.length, 8)
  const g = prd54EntryGate({ repoRoot, commit: "abc1234" })
  assert.deepEqual(g.p0Checklist, PROVAS_DO_P0_RUNTIME)
  const p0 = g.criteria.find((c) => c.id === "p0_runtime_windows_lifecycle")
  assert.equal(p0.state, "unproven")
  assert.match(p0.detail, /taskkill .T .F. isolado NÃO satisfaz/,
    "o §2.1 exclui a solução óbvia por escrito, e o critério precisa repetir isso")
})

/**
 * S54.2 — a lista do portão é DERIVADA do ledger, e não uma segunda cópia.
 *
 * Enquanto eram duas listas, a decorativa continuaria parecendo certa depois que
 * a outra mudasse. É o modo de falha mais silencioso que existe num gate.
 */
test("o roteiro do P0 é o MESMO do ledger — uma fonte, não duas", async () => {
  const { PROVAS_DO_P0_RUNTIME } = await G()
  const { PROVAS_DO_P0 } = await import(
    pathToFileURL(path.join(repoRoot, "src", "runtime", "lifecycle-proof-ledger.js")).href
  )
  assert.deepEqual(PROVAS_DO_P0_RUNTIME, PROVAS_DO_P0.map((p) => p.titulo))
})

/**
 * O QUE MUDOU NO S54.2, e por que este teste foi reescrito.
 *
 * A versão anterior afirmava que o veredito "não pode depender de estado do
 * repositório, porque nenhuma das oito provas está no repositório". Isso era
 * verdade quando nenhuma existia e deixou de ser: seis fecharam com teste
 * executável, e o critério passou a ser DERIVADO da evidência em disco.
 *
 * O invariante que sobrevive — e que é o que realmente importa — é outro: o P0
 * não fecha enquanto houver prova aberta OU externa. `external` não é `proved`,
 * e é essa recusa que impede o P0 de fechar por conveniência quando o que falta
 * é uma máquina que ninguém tem.
 */
test("o P0 só fecha com as OITO provadas — aberta ou externa bloqueia", async () => {
  const { prd54EntryGate } = await G()
  const { ledgerDoP0Runtime } = await import(
    pathToFileURL(path.join(repoRoot, "src", "runtime", "lifecycle-proof-ledger.js")).href
  )
  const l = ledgerDoP0Runtime({ repoRoot })
  const p0 = prd54EntryGate({ repoRoot, commit: "abc1234" }).criteria.find((c) => c.id === "p0_runtime_windows_lifecycle")

  assert.equal(l.complete, false, "hoje o ledger não fecha")
  assert.equal(p0.state, "unproven", "e o critério acompanha o ledger, em vez de afirmar por conta própria")
  assert.ok(l.proved.length > 0, "o critério agora REFLETE provas reais — não é mais constante")
  assert.match(p0.detail, new RegExp(`${l.proved.length}/${l.total} provas fechadas`),
    "o detalhe precisa dizer quanto já fechou, senão o bloqueio não informa progresso")
  for (const aberta of [...l.unproved, ...l.external]) {
    assert.ok(p0.detail.includes(aberta), `o critério não nomeia a prova aberta '${aberta}'`)
  }
})

test("o P1 do §2.2 declara honestamente que ainda não há o que medir", async () => {
  const { prd54EntryGate } = await G()
  const p1 = prd54EntryGate({ repoRoot, commit: "abc1234" }).criteria.find((c) => c.id === "p1_workspace_imutavel_durante_run")
  assert.equal(p1.state, "unproven")
  assert.match(p1.detail, /workspaceSnapshotHash/)
  assert.match(p1.detail, /não há o que medir ainda/,
    "sem missão no produto, dizer `failed` acusaria um defeito que não existe")
})

test("nenhum estado sai do vocabulário e nada nasce `met` por omissão", async () => {
  const { prd54EntryGate, ESTADOS_DO_CRITERIO } = await G()
  const g = prd54EntryGate({ repoRoot, commit: "abc1234" })
  for (const c of g.criteria) assert.ok(ESTADOS_DO_CRITERIO.includes(c.state))
  assert.equal(g.criteria.filter((c) => c.state === "met").length, 0,
    "hoje NENHUM critério do §2 está provado — e o portão diz isso sem rodeio")
})

test("o portão é READ-ONLY: contra raiz vazia não cria o pack que exige", async () => {
  const { prd54EntryGate, EVIDENCE_PACK_PRD53 } = await G()
  const { existsSync } = await import("node:fs")
  const { mkdtemp } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { cleanupTmp } = await imp("tests/helpers/tmp.js")
  const vazio = await mkdtemp(path.join(tmpdir(), "gstack-g54-"))
  try {
    assert.equal(prd54EntryGate({ repoRoot: vazio, commit: "abc1234" }).entered, false)
    assert.equal(existsSync(path.join(vazio, EVIDENCE_PACK_PRD53)), false,
      "medir não pode fabricar a evidência que se está medindo")
  } finally { cleanupTmp(vazio) }
})
