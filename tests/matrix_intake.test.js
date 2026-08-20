import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"
import {
  ingerirRelatorios, celulaDoResultado, oraculosDoRecibo,
  divergenciasDeProveniencia, problemasDoRelatorio, RECIBOS_DA_CELULA,
} from "../src/release/matrix-intake.js"
import { problemasDaCelula } from "../src/meta/prd52-schemas.js"

/**
 * PRD52 S52.O — os relatórios do CI viram células do §26.3.
 *
 * O CASO REAL que este arquivo guarda: o `runtime-compat.yml` rodou 12/12 verde
 * no commit 70ceebf e o critério `pacote_cross_os` continuou dizendo "0/12
 * células provadas — o CI nunca rodou". Duas coisas separadas estavam erradas e
 * a frase escondia as duas: o runner não media UNINSTALL (e o §26.3 recusa
 * `pass` sem esse recibo, então nenhuma execução poderia pintar célula), e nada
 * lia os relatórios — `construirMatriz` aceita `receipts` desde o S52.E e
 * ninguém nunca passou nenhum.
 *
 * A ingestão dos 12 relatórios reais daquela run produz `not_run`, não `pass` e
 * não `fail`: o produto passou em tudo o que foi medido, e o que faltou foi
 * MEDIÇÃO. Essa distinção é o que a maior parte deste arquivo protege.
 */

const ORACULOS_DE_RUNTIME = ["doctor", "dream-audit", "create", "context", "verify", "state", "isolamento"]

const check = (nome, ok = true) => ({ nome, ok })

const resultado = ({ node = "v20.20.2", verdict = "runtime_compatible", comUninstall = true, quebrar = null } = {}) => ({
  node,
  verdict,
  checks: [
    check("install"),
    ...ORACULOS_DE_RUNTIME.map((n) => check(n, n !== quebrar)),
    ...(comUninstall ? [check("uninstall")] : []),
  ],
})

const relatorio = ({ os = "linux/x64", commit = "a".repeat(40), tarball = "sha256:cafe", resultados = [resultado()] } = {}) => ({
  schemaVersion: "gstack.runtime-matrix.v1",
  os,
  tarball: { path: "pkg.tgz", sha256: tarball },
  origem: { commit, sujo: false },
  resultados,
})

function comRelatorios(docs) {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-intake-"))
  docs.forEach((d, i) => writeFileSync(path.join(dir, `runtime-matrix-${i}-node.json`), JSON.stringify(d)))
  return dir
}

// ── A célula ────────────────────────────────────────────────────────────────

test("os três recibos e o veredito do runner fecham a célula como `pass`", () => {
  const c = celulaDoResultado(relatorio(), resultado(), "sha256:rel")
  assert.equal(c.verdict, "pass")
  assert.equal(c.os, "ubuntu-latest", "a plataforma vira o rótulo do runner, que é o que a grade usa")
  assert.equal(c.nodeVersion, "20")
  assert.equal(c.packageHash, "sha256:cafe")
  for (const campo of RECIBOS_DA_CELULA) assert.ok(c[campo], `${campo} devia ter referência`)
  assert.deepEqual(problemasDaCelula(c), [], "a célula precisa satisfazer o schema do §26.3")
})

/**
 * O CASO REAL, e o mais importante do arquivo: a run de 2026-08-20 é anterior ao
 * oráculo de uninstall. Sem recibo de uninstall a célula não é verde — e também
 * não é vermelha, porque o produto não reprovou em nada que alguém mediu.
 */
test("sem oráculo de uninstall a célula é `not_run` — nunca `fail`", () => {
  const c = celulaDoResultado(relatorio(), resultado({ comUninstall: false }), "sha256:rel")
  assert.equal(c.verdict, "not_run")
  assert.equal(c.uninstallReceiptRef, null)
  assert.ok(c.installReceiptRef, "o que FOI medido continua com recibo")
  assert.ok(c.runtimeReceiptRef)
  assert.equal(c.packageHash, null, "hash de pacote é afirmação de célula verde")
})

test("`fail` é reservado ao produto medido que reprovou", () => {
  const c = celulaDoResultado(relatorio(), resultado({ verdict: "runtime_incompatible" }), "sha256:rel")
  assert.equal(c.verdict, "fail")
})

test("veredito de AMBIENTE é `not_run` — não acusa o produto", () => {
  const c = celulaDoResultado(relatorio(), resultado({ verdict: "test_environment_invalid" }), "sha256:rel")
  assert.equal(c.verdict, "not_run")
})

/**
 * O recibo de runtime é DERIVADO dos oráculos medidos, não uma lista literal. A
 * primeira versão do módulo escreveu `contexto` onde o oráculo se chama
 * `context`: com lista, o recibo sairia sustentado com um oráculo a menos e
 * ninguém veria.
 */
test("o recibo de runtime cobre TODO oráculo que não é install nem uninstall", () => {
  const r = resultado()
  assert.deepEqual(oraculosDoRecibo("runtimeReceiptRef", r).sort(), [...ORACULOS_DE_RUNTIME].sort())
  assert.deepEqual(oraculosDoRecibo("installReceiptRef", r), ["install"])
  assert.deepEqual(oraculosDoRecibo("uninstallReceiptRef", r), ["uninstall"])
})

test("UM oráculo de runtime reprovado derruba o recibo inteiro", () => {
  const c = celulaDoResultado(relatorio(), resultado({ quebrar: "verify" }), "sha256:rel")
  assert.equal(c.runtimeReceiptRef, null)
  assert.equal(c.verdict, "not_run")
})

/**
 * CONTROLE NEGATIVO do caso vazio: `[].every(...)` é `true`. Sem a exigência de
 * ao menos um oráculo, um resultado SEM checks sustentaria os três recibos por
 * vacuidade — verde perfeito sobre medição nenhuma.
 */
test("resultado sem oráculo nenhum não sustenta recibo por vacuidade", () => {
  const c = celulaDoResultado(relatorio(), { node: "v22.0.0", verdict: "runtime_compatible", checks: [] }, "sha256:rel")
  assert.equal(c.verdict, "not_run")
  for (const campo of RECIBOS_DA_CELULA) assert.equal(c[campo], null)
})

// ── Procedência ─────────────────────────────────────────────────────────────

test("relatórios de TARBALLS diferentes não formam matriz", () => {
  const p = divergenciasDeProveniencia([relatorio({ tarball: "sha256:um" }), relatorio({ tarball: "sha256:outro" })])
  assert.equal(p.length, 1)
  assert.match(p[0], /TARBALLS diferentes/)
})

test("relatórios de COMMITS diferentes não formam matriz", () => {
  const p = divergenciasDeProveniencia([relatorio({ commit: "a".repeat(40) }), relatorio({ commit: "b".repeat(40) })])
  assert.match(p[0], /COMMITS diferentes/)
})

test("evidência de OUTRO commit é recusada quando a auditoria nomeia o seu", () => {
  const p = divergenciasDeProveniencia([relatorio({ commit: "a".repeat(40) })], { commit: "b".repeat(40) })
  assert.equal(p.length, 1)
  assert.match(p[0], /a auditoria pergunta pelo/)
})

test("procedência divergente ZERA os recibos — não ingere o subconjunto bom", () => {
  const dir = comRelatorios([relatorio({ tarball: "sha256:um" }), relatorio({ tarball: "sha256:outro" })])
  try {
    const e = ingerirRelatorios({ dir })
    assert.equal(e.read, 2)
    assert.equal(e.accepted, 0)
    assert.deepEqual(e.receipts, {}, "meia matriz apresentada como matriz é pior que matriz nenhuma")
  } finally { cleanupTmp(dir) }
})

// ── O que é recusado, e com que razão ───────────────────────────────────────

test("relatório sem commit, sem tarball ou de schema estranho é recusado NOMEANDO a falta", () => {
  const semCommit = { ...relatorio(), origem: { commit: null } }
  const semTarball = { ...relatorio(), tarball: { path: "x.tgz" } }
  const outroSchema = { ...relatorio(), schemaVersion: "outra.coisa.v9" }
  const outraPlataforma = relatorio({ os: "sunos/sparc" })

  assert.match(problemasDoRelatorio(semCommit)[0], /origem\.commit/)
  assert.match(problemasDoRelatorio(semTarball)[0], /tarball\.sha256/)
  assert.match(problemasDoRelatorio(outroSchema)[0], /schema inesperado/)
  assert.match(problemasDoRelatorio(outraPlataforma)[0], /plataforma fora da tabela/)
  assert.deepEqual(problemasDoRelatorio(relatorio()), [])
})

test("JSON inválido é recusado com razão, nunca ignorado em silêncio", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-intake-"))
  try {
    writeFileSync(path.join(dir, "runtime-matrix-x-node.json"), "{ isto nao e json")
    const e = ingerirRelatorios({ dir })
    assert.equal(e.read, 1)
    assert.equal(e.accepted, 0)
    assert.deepEqual(e.rejected.map((r) => r.problems[0]), ["JSON invalido"])
  } finally { cleanupTmp(dir) }
})

test("diretório ausente não é erro — é ausência de evidência", () => {
  const e = ingerirRelatorios({ dir: path.join(tmpdir(), "gstack-nao-existe-" + Date.now()) })
  assert.equal(e.read, 0)
  assert.deepEqual(e.receipts, {})
})

test("a ingestão chaveia por célula e as referências endereçam CONTEÚDO", () => {
  const dir = comRelatorios([relatorio({ resultados: [resultado({ node: "v22.1.0" })] })])
  try {
    const e = ingerirRelatorios({ dir })
    assert.deepEqual(Object.keys(e.receipts), ["ubuntu-latest::node22"])
    const c = e.receipts["ubuntu-latest::node22"]
    assert.match(c.installReceiptRef, /^sha256:[0-9a-f]{64}#node22:installReceiptRef$/)
    assert.deepEqual(e.invalidCells, [])
  } finally { cleanupTmp(dir) }
})

/**
 * `gh run download` entrega um subdiretório por artefato. Exigir que o operador
 * achate a árvore à mão seria transformar detalhe de ferramenta em passo de
 * runbook — e passo de runbook é onde a evidência se perde.
 */
test("lê o relatório dentro do subdiretório que o `gh run download` cria", async () => {
  const { mkdirSync } = await import("node:fs")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-intake-"))
  try {
    const sub = path.join(dir, "runtime-matrix-ubuntu-latest-node22")
    mkdirSync(sub)
    writeFileSync(path.join(sub, "runtime-matrix-ubuntu-latest-node22.json"),
      JSON.stringify(relatorio({ resultados: [resultado({ node: "v22.1.0" })] })))
    const e = ingerirRelatorios({ dir })
    assert.equal(e.read, 1)
    assert.deepEqual(Object.keys(e.receipts), ["ubuntu-latest::node22"])
  } finally { cleanupTmp(dir) }
})

test("o mesmo relatório solto E no subdiretório conta UMA vez", async () => {
  const { mkdirSync } = await import("node:fs")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-intake-"))
  try {
    const nome = "runtime-matrix-ubuntu-latest-node24.json"
    const doc = JSON.stringify(relatorio({ resultados: [resultado({ node: "v24.0.0" })] }))
    writeFileSync(path.join(dir, nome), doc)
    mkdirSync(path.join(dir, "artefato"))
    writeFileSync(path.join(dir, "artefato", nome), doc)
    const e = ingerirRelatorios({ dir })
    assert.equal(e.read, 1, "contagem inflada faria o operador achar que trouxe mais evidência do que trouxe")
  } finally { cleanupTmp(dir) }
})

/** Varredura funda ingeriria o que encontrasse — `.gstack/evidence` guarda outras coisas. */
test("não desce mais de um nível", async () => {
  const { mkdirSync } = await import("node:fs")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-intake-"))
  try {
    const fundo = path.join(dir, "a", "b")
    mkdirSync(fundo, { recursive: true })
    writeFileSync(path.join(fundo, "runtime-matrix-x-node.json"), JSON.stringify(relatorio()))
    assert.equal(ingerirRelatorios({ dir }).read, 0)
  } finally { cleanupTmp(dir) }
})
