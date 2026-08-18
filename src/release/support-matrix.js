/**
 * §26.3 — evidência de suporte é uma MATRIZ, não uma frase (S52.E).
 *
 * "Funciona no Windows, Linux e macOS, do Node 18 ao 24" é uma afirmação sobre
 * doze combinações. Enquanto ela vive como frase, uma única execução local em
 * uma delas parece sustentar as doze. A matriz desfaz isso por construção: cada
 * célula existe separadamente e nasce `not_run`.
 *
 * `not_run` NÃO é falha. É ausência de execução, e é o estado honesto de quase
 * toda célula deste repositório hoje — `runtime-compat.yml` existe e nunca rodou
 * no GitHub. Pintar essas células de verde por analogia com a que rodou local
 * seria a mentira exata que o §26.3 descreve; pintá-las de vermelho seria outra,
 * porque ninguém mediu.
 *
 * A GRADE é derivada do workflow, não digitada aqui: se alguém acrescentar uma
 * versão de Node ao CI, a matriz cresce junto e a célula nova nasce `not_run`.
 * Uma grade copiada à mão envelheceria em silêncio — o defeito de sempre.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { celulaNaoExecutada, problemasDaCelula, matrizPublica, SUPPORT_VERDICTS } from "../meta/prd52-schemas.js"

export const SUPPORT_MATRIX_SCHEMA = "gstack.support-matrix.v1"

/** O workflow que EXECUTA o pacote em cada combinação — a fonte da grade. */
export const WORKFLOW_DA_MATRIZ = join(".github", "workflows", "runtime-compat.yml")

const LISTA_OS = /^\s*os:\s*\[([^\]]+)\]/gm
const LISTA_NODE = /^\s*node:\s*\[([^\]]+)\]/gm

const itensDe = (texto, rx) => [
  ...new Set([...String(texto).matchAll(rx)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean))),
]

/**
 * A grade DECLARADA pelo CI. Sem workflow legível, devolve grade vazia — nunca
 * uma grade default, que faria a matriz inventar combinações que ninguém pediu.
 */
export function gradeDeclarada(cwd = process.cwd()) {
  const p = join(cwd, WORKFLOW_DA_MATRIZ)
  if (!existsSync(p)) return { os: [], node: [], source: null }
  const texto = readFileSync(p, "utf-8")
  return { os: itensDe(texto, LISTA_OS), node: itensDe(texto, LISTA_NODE), source: WORKFLOW_DA_MATRIZ }
}

/** A chave de uma célula. Estável e legível — é ela que um recibo referencia. */
export const chaveDaCelula = (os, nodeVersion) => `${os}::node${nodeVersion}`

/**
 * A matriz completa.
 *
 * `receipts` mapeia chave de célula → célula preenchida (com os quatro recibos).
 * Uma célula sem recibo permanece `not_run`; uma célula COM recibo ainda precisa
 * passar em `problemasDaCelula`, porque `pass` sem os quatro recibos é recusado
 * pelo schema do S52.A — um verde alegado não vira verde por ser alegado.
 */
export function construirMatriz({ cwd = process.cwd(), receipts = {}, arch = "x64" } = {}) {
  const grade = gradeDeclarada(cwd)
  const cells = []
  for (const os of grade.os) {
    for (const nodeVersion of grade.node) {
      const chave = chaveDaCelula(os, nodeVersion)
      const informada = receipts[chave]
      const celula = informada || celulaNaoExecutada({ os, arch, nodeVersion })
      cells.push({ key: chave, ...celula, problems: problemasDaCelula(celula) })
    }
  }
  return {
    schemaVersion: SUPPORT_MATRIX_SCHEMA,
    grid: grade,
    cells,
    counts: contar(cells),
    // A matriz PÚBLICA só tem célula provada — é o que pode virar frase.
    proven: matrizPublica(cells).map((c) => c.key),
    invalidCells: cells.filter((c) => c.problems.length > 0).map((c) => ({ key: c.key, problems: c.problems })),
  }
}

function contar(cells) {
  const c = Object.fromEntries(SUPPORT_VERDICTS.map((v) => [v, 0]))
  for (const cell of cells) c[cell.verdict] = (c[cell.verdict] || 0) + 1
  return c
}

/**
 * O que a matriz AUTORIZA declarar.
 *
 * Uma declaração de suporte que cita combinação não provada é recusada com o
 * nome da combinação. Reduzir a faixa declarada é decisão humana legítima; o que
 * não existe é ampliá-la sem célula verde por baixo.
 */
export function problemasDaDeclaracao(declaradas, matriz) {
  const provadas = new Set(matriz.proven)
  const falhas = new Set(matriz.cells.filter((c) => c.verdict === "fail").map((c) => c.key))
  return (declaradas || []).flatMap((chave) => {
    if (provadas.has(chave)) return []
    const motivo = falhas.has(chave) ? "célula FALHOU" : "célula não executada (`not_run`)"
    return [`declara suporte a ${chave} sem prova: ${motivo}`]
  })
}
