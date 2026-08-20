/**
 * As pendências que só fecham FORA desta máquina — persistidas para serem
 * rodadas depois (PRD52 S52.K).
 *
 * Três coisas seguem abertas e nenhuma se resolve escrevendo código: os P0 de
 * enforcement do Codex, as 12 células OS × Node e a certificação em máquina
 * limpa. Elas estavam nomeadas em memória de sessão e em prosa de checklist, que
 * é onde pendência vai para morrer: quem for executar em outro dia, em outra
 * máquina, não tem a sessão.
 *
 * Este módulo as transforma em RUNBOOK persistido — passos exatos, o recibo que
 * cada passo produz, e o comando que fecha cada critério quando o recibo
 * existir. Derivado a cada geração e ancorado no commit: um runbook que
 * envelhece calado é pior que nenhum, porque manda alguém rodar o passo errado
 * com confiança.
 *
 * O QUE ELE NÃO FAZ: executar. Nada aqui roda; o ponto é justamente que a
 * execução acontece em outro lugar.
 */

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { PASSOS, planoDeCertificacao, VESTIGIOS } from "./clean-machine-e2e.js"
import { construirMatriz, chaveDaCelula } from "./support-matrix.js"
import { ingerirRelatorios } from "./matrix-intake.js"
import { statusDosHooksDoCodex } from "../harness/codex-hooks-status.js"

export const EXTERNAL_PENDING_SCHEMA = "gstack.external-pending.v1"

/** Onde o runbook vive. Versionado: é para ser levado para outra máquina. */
export const EXTERNAL_PENDING_PATH = join(".gstack", "evidence", "external-pending.json")

/**
 * Como cada pendência FECHA.
 *
 * `closes` é o critério do portão do PRD53 que a pendência destrava, e `verify`
 * é o comando que confere depois. Sem esses dois campos, o runbook diria o que
 * fazer e não como saber que deu certo — que é metade de um runbook.
 */
const PENDENCIAS = Object.freeze([
  {
    id: "clean_machine_certification",
    closes: "clean_machine_certificado",
    blockedBy: "external_clean_machine",
    requires: "máquina ou imagem SEM GStack instalado (ver `preconditions`)",
    verify: "node src/index.js prd gate --json",
  },
  {
    id: "codex_enforcement",
    closes: "zero_p0_aberto",
    blockedBy: "external_clean_machine",
    requires: "sessão REAL do Codex na máquina limpa, com um comando que o PreToolUse deve negar",
    verify: "node src/index.js agents doctor --json  # codexHooks.enforcementObserved",
  },
  {
    id: "os_node_matrix",
    closes: "pacote_cross_os",
    blockedBy: "external_ci_execution",
    // CORRIGIDO NO S52.O. Esta linha dizia "nunca rodou", e virou falsa quando o
    // workflow rodou 12/12 verde em 2026-08-20 sem que o critério mudasse. A
    // pendência real nunca foi a execução: era que o runner não media uninstall
    // (o §26.3 recusa `pass` sem esse recibo) e que ninguém LIA os relatórios.
    // Uma pendência que nomeia a causa errada manda a pessoa consertar o que não
    // está quebrado — e essa é a única coisa pior que não ter runbook.
    requires: "run do `runtime-compat.yml` no commit auditado, com o oráculo de uninstall (S52.O), e os relatórios TRAZIDOS para `.gstack/evidence/runtime-matrix/`",
    steps: [
      "gh workflow run runtime-compat.yml --ref master",
      "gh run download <runId> -D .gstack/evidence/runtime-matrix",
      "achatar: os artefatos vêm em subdiretório, e a ingestão lê `runtime-matrix-*.json` na raiz do diretório",
    ],
    verify: "node src/index.js prd gate --json  # criterio pacote_cross_os",
  },
])

/**
 * As pré-condições da máquina limpa, com o caminho a conferir.
 *
 * Sai a lista COMPLETA de vestígios, e não só os que existem aqui: quem prepara
 * a imagem precisa saber o que remover, e um item ausente nesta máquina pode
 * estar presente na outra.
 */
const preCondicoes = () => VESTIGIOS.map((v) => ({
  id: v.id,
  mustNotExist: v.caminho("<HOME>"),
  reason: v.motivo,
}))

/** As células que a execução do CI preencheria, com a chave que o recibo usa. */
function celulasPendentes(cwd) {
  // Com os recibos ja ingeridos: sem isto o runbook listaria as 12 celulas como
  // pendentes mesmo depois de o operador ter trazido os relatorios, e mandaria
  // repetir trabalho ja feito.
  const m = construirMatriz({ cwd, receipts: ingerirRelatorios({ cwd }).receipts })
  return m.cells
    .filter((c) => c.verdict === "not_run")
    .map((c) => ({ key: chaveDaCelula(c.os, c.nodeVersion), os: c.os, nodeVersion: c.nodeVersion, verdict: c.verdict }))
}

/**
 * O runbook. `sourceCommit` entra de fora — sem ele o documento não diz de QUAL
 * árvore ele fala, e um passo que valia num commit pode não valer em outro.
 */
export function construirPendenciasExternas({ cwd = process.cwd(), commit = null } = {}) {
  const plano = planoDeCertificacao()
  const hooks = statusDosHooksDoCodex()
  return {
    schemaVersion: EXTERNAL_PENDING_SCHEMA,
    sourceCommit: commit,
    generatedAt: new Date().toISOString(),
    pending: PENDENCIAS,
    cleanMachine: {
      // O estado DESTA máquina fica registrado para que ninguém confunda o
      // runbook com um relatório de sucesso: aqui ele não roda, e o motivo está
      // escrito.
      runnableHere: plano.runnable,
      blockersHere: plano.blockers,
      preconditions: preCondicoes(),
      steps: PASSOS,
      receiptsExpected: ["packageHash", "installReceiptRef", "runtimeReceiptRef", "uninstallReceiptRef"],
    },
    codexHooks: {
      byState: hooks.byState,
      enforcementObserved: hooks.enforcementObserved,
      // O passo `enforcement` do plano é o único que fecha o P0: ler arquivo
      // prova registro, nunca execução.
      closesWith: PASSOS.find((p) => p.id === "enforcement").comando,
    },
    supportMatrix: { pendingCells: celulasPendentes(cwd) },
    doesNotAuthorize: [
      "não declara nada certificado — é o que FALTA, não o que foi feito",
      "não substitui a execução: célula sem recibo continua `not_run`",
    ],
  }
}

const listaVazia = (v) => !Array.isArray(v) || v.length === 0

const REGRAS = Object.freeze([
  { quando: (d) => !d.sourceCommit, problema: () => "sourceCommit ausente — runbook sem commit não diz de qual árvore fala" },
  { quando: (d) => listaVazia(d.pending), problema: () => "nenhuma pendência listada" },
  { quando: (d) => d.pending.some((p) => !p.closes || !p.verify), problema: () => "pendência sem `closes`/`verify` — diz o que fazer e não como conferir" },
  { quando: (d) => listaVazia(d.cleanMachine.preconditions), problema: () => "sem pré-condições: quem prepara a imagem não sabe o que remover" },
])

export function problemasDasPendencias(doc) {
  if (!doc || typeof doc !== "object") return ["documento não é objeto"]
  return REGRAS.filter((r) => r.quando(doc)).map((r) => r.problema(doc))
}

/** Grava o runbook e devolve caminho + hash do que foi escrito. */
export function gravarPendencias(doc, { cwd = process.cwd() } = {}) {
  const destino = join(cwd, EXTERNAL_PENDING_PATH)
  mkdirSync(dirname(destino), { recursive: true })
  const texto = `${JSON.stringify(doc, null, 2)}\n`
  writeFileSync(destino, texto)
  return { path: EXTERNAL_PENDING_PATH, sha256: `sha256:${createHash("sha256").update(texto).digest("hex")}` }
}
