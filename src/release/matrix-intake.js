/**
 * Os relatorios do CI viram CELULAS da matriz §26.3 (PRD52 S52.O).
 *
 * O ACHADO QUE ESTE MODULO FECHA: o `runtime-compat.yml` rodou verde, 12/12, no
 * commit 70ceebf -- e o criterio `pacote_cross_os` continuou dizendo "0/12
 * celulas provadas -- o CI de runtime-compat nunca rodou". Duas coisas
 * separadas estavam erradas, e a prosa do runbook escondia as duas atras de
 * "esperando o CI":
 *
 *   1. o runner nunca mediu UNINSTALL, e o §26.3 recusa `pass` sem
 *      `uninstallReceiptRef` -- nenhuma execucao, por mais verde que fosse,
 *      poderia pintar uma celula (fechado no mesmo sprint, em
 *      `scripts/test-runtime-matrix.mjs`);
 *   2. nada LIA os relatorios. `construirMatriz` aceita `receipts` desde o
 *      S52.E e ninguem nunca passou nenhum.
 *
 * O padrao e o mesmo que o PRD52 encontrou tres vezes: capacidade construida,
 * testada e sem consumidor. A diferenca aqui e que a ausencia de consumidor
 * produzia uma AFIRMACAO FALSA sobre por que o criterio estava aberto.
 *
 * O QUE ESTE MODULO NAO FAZ: baixar artefato, chamar `gh`, falar com a rede.
 * Ele le arquivos de relatorio que ja estao em disco e os valida. Quem traz os
 * artefatos e o operador (`gh run download`), e isso e deliberado -- um modulo
 * que buscasse sozinho poderia ingerir a run de outro commit sem ninguem ver.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chaveDaCelula } from "./support-matrix.js"
import { problemasDaCelula } from "../meta/prd52-schemas.js"

export const MATRIX_INTAKE_SCHEMA = "gstack.matrix-intake.v1"

/** Onde o operador deposita os relatorios baixados do CI. */
export const RELATORIOS_DIR = join(".gstack", "evidence", "runtime-matrix")

/**
 * Plataforma do Node -> rotulo do runner do GitHub.
 *
 * FECHADO. A grade da matriz vem do workflow e fala em `ubuntu-latest`; o
 * relatorio fala em `linux`. Sem tabela, alguem normalizaria por heuristica e
 * uma plataforma nova entraria como se fosse conhecida.
 */
export const RUNNER_POR_PLATAFORMA = Object.freeze({
  linux: "ubuntu-latest",
  win32: "windows-latest",
  darwin: "macos-latest",
})

/**
 * Os tres recibos da celula, e o que cada um exige dos oraculos.
 *
 * `runtime` e DERIVADO -- "todo oraculo que nao e install nem uninstall" -- e
 * nao uma lista. Uma lista literal ja teria errado: a primeira versao deste
 * modulo escreveu `contexto`, e o oraculo se chama `context`, entao o recibo
 * seria dado por sustentado com um oraculo a menos sem ninguem notar. Pior, um
 * oraculo NOVO ficaria fora do recibo em silencio, que e como uma regua para de
 * medir sem parar de responder.
 */
export const RECIBOS_DA_CELULA = Object.freeze(["installReceiptRef", "runtimeReceiptRef", "uninstallReceiptRef"])

const ORACULO_DE_CICLO = Object.freeze({ installReceiptRef: "install", uninstallReceiptRef: "uninstall" })

/** Os oraculos que sustentam um recibo, dado o conjunto medido no resultado. */
export function oraculosDoRecibo(campo, resultado) {
  const nomes = (resultado.checks || []).map((c) => c.nome)
  if (ORACULO_DE_CICLO[campo]) return nomes.filter((n) => n === ORACULO_DE_CICLO[campo])
  return nomes.filter((n) => !Object.values(ORACULO_DE_CICLO).includes(n))
}

const sha256 = (texto) => `sha256:${createHash("sha256").update(texto).digest("hex")}`

/** O major do Node, do jeito que a grade do workflow o escreve. */
export const majorDoNode = (versao) => String(versao || "").replace(/^v/, "").split(".")[0]

/** O oraculo passou neste resultado? */
const oraculoOk = (resultado, nome) => (resultado.checks || []).some((c) => c.nome === nome && c.ok === true)

/**
 * O recibo se sustenta? Exige ao menos UM oraculo e que todos tenham passado.
 *
 * O "ao menos um" e o que impede o caso vazio de virar verde: `[].every(...)`
 * e `true`, entao um resultado sem oraculo de uninstall teria sustentado o
 * recibo de uninstall por vacuidade -- exatamente o buraco que este sprint
 * existe para fechar.
 */
function reciboSustentado(resultado, campo) {
  const nomes = oraculosDoRecibo(campo, resultado)
  return nomes.length > 0 && nomes.every((n) => oraculoOk(resultado, n))
}

/**
 * A referencia de um recibo. Endereca CONTEUDO, nao caminho: o hash e do
 * relatorio inteiro, entao mover ou renomear o arquivo nao muda a referencia, e
 * editar o relatorio muda -- que e exatamente a propriedade que um recibo
 * precisa ter.
 */
const refDoRecibo = (hashRelatorio, node, campo) => `${hashRelatorio}#node${node}:${campo}`

/**
 * As regras que um relatorio precisa satisfazer para ser ingerido.
 *
 * Nenhuma delas opina sobre o produto -- todas perguntam se o ARTEFATO diz de
 * onde veio. Um relatorio sem commit ou sem hash de tarball nao e evidencia
 * ruim: e evidencia de coisa nenhuma, porque nao diz o que mediu.
 */
export const REGRAS_DO_RELATORIO = Object.freeze([
  { when: (r) => r.schemaVersion !== "gstack.runtime-matrix.v1", problem: (r) => `schema inesperado: ${r.schemaVersion}` },
  { when: (r) => !r.tarball || !r.tarball.sha256, problem: () => "sem `tarball.sha256` — nao diz QUE pacote mediu" },
  { when: (r) => !r.origem || !r.origem.commit, problem: () => "sem `origem.commit` — nao diz de QUANDO e a medicao" },
  { when: (r) => !Array.isArray(r.resultados) || r.resultados.length === 0, problem: () => "sem resultados" },
  { when: (r) => !RUNNER_POR_PLATAFORMA[plataformaDe(r)], problem: (r) => `plataforma fora da tabela: ${r.os}` },
])

/** `linux/x64` -> `linux`. */
const plataformaDe = (relatorio) => String(relatorio.os || "").split("/")[0]

/** A arquitetura declarada pelo relatorio, ou `x64` quando ele nao diz. */
const arquiteturaDe = (relatorio) => String(relatorio.os || "").split("/")[1] || "x64"

export function problemasDoRelatorio(relatorio) {
  if (!relatorio || typeof relatorio !== "object") return ["relatorio nao e objeto"]
  return REGRAS_DO_RELATORIO.filter((r) => r.when(relatorio)).map((r) => r.problem(relatorio))
}

/**
 * Uma celula, a partir de UM resultado de UM relatorio.
 *
 * `verdict` so e `pass` quando o veredito do runner E os tres recibos se
 * sustentam. Um resultado `runtime_compatible` cujo oraculo de uninstall falhou
 * nao e verde -- e meio verde, que na matriz nao existe.
 */
export function celulaDoResultado(relatorio, resultado, hashRelatorio) {
  const os = RUNNER_POR_PLATAFORMA[plataformaDe(relatorio)]
  const node = majorDoNode(resultado.node)
  const sustentados = RECIBOS_DA_CELULA.filter((campo) => reciboSustentado(resultado, campo))
  const completo = sustentados.length === RECIBOS_DA_CELULA.length
  const aprovado = completo && resultado.verdict === "runtime_compatible"

  const refs = Object.fromEntries(RECIBOS_DA_CELULA
    .map((campo) => [campo, sustentados.includes(campo) ? refDoRecibo(hashRelatorio, node, campo) : null]))

  return {
    os,
    arch: arquiteturaDe(relatorio),
    nodeVersion: node,
    packageHash: aprovado ? relatorio.tarball.sha256 : null,
    ...refs,
    verdict: aprovado ? "pass" : verdictReprovado(resultado),
    sourceCommit: relatorio.origem.commit,
  }
}

/**
 * Um resultado que nao virou `pass`: `fail` SO quando o produto foi medido e
 * reprovou. Todo o resto e `not_run`.
 *
 * A distincao e a do §26.3 e nao e cosmetica: `fail` acusa o PRODUTO, `not_run`
 * acusa a ausencia de MEDICAO. O caso que forcou a regra e concreto -- os
 * relatorios da run de 2026-08-20 sao anteriores ao oraculo de uninstall, entao
 * a celula nao fecha os quatro recibos apesar de o produto ter passado em tudo
 * o que foi medido. Chamar isso de `fail` acusaria o produto de uma falha que
 * ninguem observou; o que faltou foi um oraculo que nao existia.
 */
const verdictReprovado = (resultado) => (resultado.verdict === "runtime_incompatible" ? "fail" : "not_run")

/**
 * Os relatorios que estao no diretorio, lidos e parseados.
 *
 * Olha UM nivel abaixo tambem, porque `gh run download` cria um subdiretorio por
 * artefato -- exigir que o operador achate a arvore a mao seria transformar um
 * detalhe da ferramenta em passo de runbook, e passo de runbook e onde a
 * evidencia se perde. Um nivel, e nao varredura recursiva: `.gstack/evidence`
 * guarda outras coisas, e uma varredura funda acabaria ingerindo o que
 * encontrasse.
 */
export function lerRelatorios(dir) {
  if (!existsSync(dir)) return []
  return caminhosDeRelatorio(dir)
    .map((p) => ({ file: p.file, texto: lerTexto(p.path) }))
    .filter((r) => r.texto !== null)
    .map((r) => ({ ...r, doc: parse(r.texto) }))
}

const ehRelatorio = (f) => f.startsWith("runtime-matrix-") && f.endsWith(".json")

function caminhosDeRelatorio(dir) {
  const achados = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const cheio = join(dir, entrada.name)
    if (entrada.isFile() && ehRelatorio(entrada.name)) achados.push({ file: entrada.name, path: cheio })
    if (entrada.isDirectory()) achados.push(...filhosDe(cheio))
  }
  // Ordem estavel e sem duplicata por NOME: o mesmo relatorio pode chegar solto
  // e dentro do subdiretorio do artefato, e ingerir duas vezes nao muda a
  // celula, mas infla a contagem que o operador le.
  const porNome = new Map(achados.sort((a, b) => a.file.localeCompare(b.file)).map((a) => [a.file, a]))
  return [...porNome.values()]
}

const filhosDe = (dir) => readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isFile() && ehRelatorio(e.name))
  .map((e) => ({ file: e.name, path: join(dir, e.name) }))

const lerTexto = (p) => { try { return readFileSync(p, "utf-8") } catch { return null } }
const parse = (texto) => { try { return JSON.parse(texto) } catch { return null } }

/**
 * As divergencias de PROVENIENCIA entre relatorios.
 *
 * Doze relatorios que mediram tarballs diferentes nao formam uma matriz -- sao
 * doze medicoes de coisas diferentes apresentadas como se fossem a mesma. O
 * workflow ja aborta por hash divergente no job, mas essa verificacao vive no
 * shell e nao acompanha o artefato ate aqui.
 */
export function divergenciasDeProveniencia(docs, { commit = null } = {}) {
  const tarballs = new Set(docs.map((d) => d.tarball.sha256))
  const commits = new Set(docs.map((d) => d.origem.commit))
  const problemas = []
  if (tarballs.size > 1) problemas.push(`relatorios de TARBALLS diferentes: ${[...tarballs].join(", ")}`)
  if (commits.size > 1) problemas.push(`relatorios de COMMITS diferentes: ${[...commits].join(", ")}`)
  if (commit && commits.size === 1 && !commits.has(commit)) {
    problemas.push(`evidencia e do commit ${[...commits][0]}, e a auditoria pergunta pelo ${commit}`)
  }
  return problemas
}

/**
 * Ingere um diretorio de relatorios e devolve os recibos por chave de celula.
 *
 * Devolve tambem o que RECUSOU e por que. Ingestao silenciosa seria a pior
 * versao disto: a matriz ficaria com menos celulas do que o operador acha que
 * entregou, e nada diria qual arquivo caiu.
 */
export function ingerirRelatorios({ cwd = process.cwd(), dir = null, commit = null } = {}) {
  const alvo = dir || join(cwd, RELATORIOS_DIR)
  const lidos = lerRelatorios(alvo)
  const invalidos = lidos
    .map((r) => ({ file: r.file, problems: r.doc ? problemasDoRelatorio(r.doc) : ["JSON invalido"] }))
    .filter((r) => r.problems.length > 0)
  const validos = lidos.filter((r) => r.doc && problemasDoRelatorio(r.doc).length === 0)
  const proveniencia = divergenciasDeProveniencia(validos.map((r) => r.doc), { commit })

  const receipts = {}
  for (const { texto, doc } of proveniencia.length === 0 ? validos : []) {
    const hash = sha256(texto)
    for (const resultado of doc.resultados) {
      const celula = celulaDoResultado(doc, resultado, hash)
      receipts[chaveDaCelula(celula.os, celula.nodeVersion)] = celula
    }
  }

  return {
    schemaVersion: MATRIX_INTAKE_SCHEMA,
    dir: alvo,
    read: lidos.length,
    accepted: proveniencia.length === 0 ? validos.length : 0,
    rejected: invalidos,
    provenanceProblems: proveniencia,
    receipts,
    invalidCells: Object.entries(receipts)
      .map(([key, c]) => ({ key, problems: problemasDaCelula(c) }))
      .filter((c) => c.problems.length > 0),
  }
}
