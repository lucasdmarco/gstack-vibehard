import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"
import {
  PROVAS_DO_P0, ledgerDoP0Runtime, estadoDaProva, evidenciaAusente, ESTADOS_DA_PROVA,
} from "../src/runtime/lifecycle-proof-ledger.js"

const repoRoot = path.resolve(import.meta.dirname, "..")

/**
 * PRD54 S54.2 — o ledger das oito provas do §2.1.
 *
 * O critério do portão nasceu `unproven` por CONSTANTE. Constante não muda
 * quando o produto melhora — só quando alguém lembra de editá-la, e "alguém
 * lembra" é o mecanismo que este repositório passou o PRD52 removendo dos gates.
 *
 * O ledger troca a constante por uma medição, e este arquivo é o que impede a
 * medição de virar decoração: uma prova cuja evidência aponta para teste
 * inexistente, ou para um nome de teste que ninguém escreveu, tem de CAIR.
 */

test("as oito provas do §2.1 estão nomeadas, sem duplicata", () => {
  assert.equal(PROVAS_DO_P0.length, 8, "o §2.1 lista oito — a menos que o PRD tenha mudado")
  const ids = PROVAS_DO_P0.map((p) => p.id)
  assert.equal(new Set(ids).size, 8)
  for (const p of PROVAS_DO_P0) assert.ok(p.titulo && p.titulo.length > 3, `${p.id} sem título legível`)
})

test("toda evidência citada EXISTE e contém o teste que nomeia", () => {
  const quebradas = PROVAS_DO_P0.flatMap((p) =>
    (p.evidence || []).map((ev) => evidenciaAusente(ev, repoRoot)).filter(Boolean))
  assert.deepEqual(quebradas, [], "evidência que aponta para o vazio é pior que evidência nenhuma")
})

/**
 * OS DENTES. Sem estes três controles, `estadoDaProva` poderia devolver `proved`
 * para qualquer coisa e os testes acima continuariam passando.
 */
test("CONTROLE NEGATIVO: arquivo de teste inexistente derruba a prova", () => {
  const falsa = { id: "x", evidence: [{ file: path.join("tests", "nunca_existiu.test.js"), name: "seja o que for" }] }
  const r = estadoDaProva(falsa, repoRoot)
  assert.equal(r.state, "unproved")
  assert.match(r.missing[0], /não existe/)
})

test("CONTROLE NEGATIVO: arquivo existe mas NÃO contém o teste citado", () => {
  const falsa = { id: "x", evidence: [{ file: path.join("tests", "runtime_supervisor.test.js"), name: "teste que ninguém escreveu" }] }
  const r = estadoDaProva(falsa, repoRoot)
  assert.equal(r.state, "unproved")
  assert.match(r.missing[0], /não contém o teste/)
})

test("CONTROLE NEGATIVO: prova SEM evidência nenhuma não passa por vacuidade", () => {
  assert.equal(estadoDaProva({ id: "x", evidence: [] }, repoRoot).state, "unproved",
    "lista vazia é ausência de prova, não prova trivial")
})

/**
 * `external` não é `proved`, e essa recusa é o coração do ledger. A prova 8 pede
 * 20x em Windows normal, shell restrito e CI; só a primeira condição é obtenível
 * nesta máquina. Deixá-la fechar seria inferir duas condições da terceira — a
 * mesma frase que o §26.3 do PRD52 proíbe sobre a matriz OS × Node.
 */
test("condição externa impede a prova de fechar, mesmo com o teste passando", () => {
  const prova8 = PROVAS_DO_P0.find((p) => p.id === "vinte_execucoes_sem_residual")
  assert.ok(prova8.condicoes.some((c) => c.estado === "external"))
  assert.deepEqual(evidenciaAusente(prova8.evidence[0], repoRoot), null, "o teste da condição obtida existe")
  assert.equal(estadoDaProva(prova8, repoRoot).state, "external",
    "evidência presente + condição externa = `external`, nunca `proved`")
})

test("toda condição externa carrega MOTIVO — bloqueio mudo vira permanente", () => {
  for (const p of PROVAS_DO_P0) {
    for (const c of p.condicoes || []) {
      if (c.estado === "external") assert.ok(c.motivo && c.motivo.length > 10, `${p.id}/${c.id} sem motivo`)
    }
  }
})

test("prova sem evidência explica o que falta DESENHAR, não só que falta", () => {
  const crash = PROVAS_DO_P0.find((p) => p.id === "recuperacao_pos_crash_do_manager")
  assert.deepEqual(crash.evidence, [], "apontar para os testes de reconciliação seria confortável e errado")
  assert.match(crash.nota, /desenhado|definido/, "sem experimento definido, a nota tem de dizer isso")
})

// ── O ledger inteiro, contra o repositório real ─────────────────────────────

test("o ledger mede o repositório REAL e não fecha o P0 hoje", () => {
  const l = ledgerDoP0Runtime({ repoRoot })
  assert.equal(l.total, 8)
  assert.equal(l.proved.length + l.unproved.length + l.external.length, 8, "todo estado tem de ser um dos três")
  for (const p of l.proofs) assert.ok(ESTADOS_DA_PROVA.includes(p.state), `estado fora do vocabulário: ${p.state}`)

  assert.equal(l.complete, false, "o P0 do §2.1 não está fechado, e o ledger não pode dizer que está")
  assert.ok(l.proved.length >= 6, `regressão: só ${l.proved.length} provas fechadas`)
  assert.deepEqual(l.unproved, ["recuperacao_pos_crash_do_manager"])
  assert.deepEqual(l.external, ["vinte_execucoes_sem_residual"])
})

/**
 * `complete` é a única coisa que o portão consulta para virar `met`. Se ele
 * pudesse ser verdadeiro com uma prova aberta, todo o resto do arquivo seria
 * teatro.
 */
test("CONTROLE NEGATIVO: `complete` exige as OITO — uma aberta já derruba", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-ledger-"))
  try {
    // Um repositório onde NENHUM teste existe: todas caem, e `complete` é falso.
    mkdirSync(path.join(dir, "tests"), { recursive: true })
    const vazio = ledgerDoP0Runtime({ repoRoot: dir })
    assert.equal(vazio.complete, false)
    assert.equal(vazio.proved.length, 0, "sem os arquivos, nada pode estar provado")

    // E com UM único arquivo de teste plantado, contendo só um dos nomes: a
    // prova daquele nome ainda não fecha sozinha se ela cita dois testes.
    const alvo = PROVAS_DO_P0.find((p) => p.evidence.length > 1)
    writeFileSync(path.join(dir, "tests", path.basename(alvo.evidence[0].file)), alvo.evidence[0].name)
    assert.equal(estadoDaProva(alvo, dir).state, "unproved",
      "meia evidência não é evidência: as duas citadas precisam existir")
  } finally { cleanupTmp(dir) }
})
