/**
 * A certificação em MÁQUINA LIMPA — preparada, não executada (PRD52 S52.F).
 *
 * O residual `external_clean_machine_e2e` está aberto desde o PRD51 com a razão
 * exata: `test:pack` prova o tarball NESTA máquina e o job `e2e` roda o
 * lifecycle no CI, mas nenhum dos dois é máquina limpa — ambos herdam ambiente
 * já preparado. A prova exige hardware ou imagem sem GStack instalado.
 *
 * Este módulo entrega o que dá para entregar sem essa máquina: o CONTRATO da
 * execução (o que precisa ser verdade antes, quais passos contam, que recibo
 * sai) e a RECUSA de rodar num ambiente que não é limpo. Ele não executa nada
 * aqui, e não porque falte código — porque rodar numa máquina suja produziria um
 * recibo que diz "clean machine" sobre uma máquina que não era.
 *
 * O recibo sai no formato de CÉLULA do §26.3 (S52.E): quando alguém rodar isto
 * numa imagem limpa, a célula correspondente sai de `not_run` com os quatro
 * recibos. É assim que a matriz fica verde — por execução, nunca por edição.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { celulaNaoExecutada } from "../meta/prd52-schemas.js"

export const CLEAN_MACHINE_E2E_SCHEMA = "gstack.clean-machine-e2e.v1"

/**
 * O que precisa estar AUSENTE para a máquina ser limpa.
 *
 * A lista é de VESTÍGIOS de instalação anterior, não de dependências: Node e
 * npm precisam existir; o que não pode existir é GStack já instalado, porque
 * então o teste mede um upgrade e chama de instalação do zero.
 */
export const VESTIGIOS = Object.freeze([
  { id: "gstack_home", caminho: (home) => join(home, ".gstack"), motivo: "estado de instalação anterior" },
  { id: "codex_hooks", caminho: (home) => join(home, ".codex", "hooks.json"), motivo: "hooks do GStack já registrados" },
  { id: "codex_hooks_dir", caminho: (home) => join(home, ".codex", "hooks"), motivo: "scripts de hook já distribuídos" },
  { id: "claude_agents", caminho: (home) => join(home, ".claude", "agents", "generated"), motivo: "adapters já gerados" },
])

/**
 * A máquina está limpa?
 *
 * Devolve a lista de vestígios ENCONTRADOS. Vazia = limpa. Nunca devolve só um
 * booleano: quem for preparar a imagem precisa saber o que remover, e um `false`
 * sozinho manda a pessoa procurar.
 */
export function vestigiosEncontrados({ home = homedir() } = {}) {
  return VESTIGIOS
    .filter((v) => existsSync(v.caminho(home)))
    .map((v) => ({ id: v.id, path: v.caminho(home), reason: v.motivo }))
}

/**
 * Os passos da certificação, em ordem, e o recibo que cada um deixa.
 *
 * `uninstall` está aqui de propósito: uma instalação que não sabe se desfazer
 * deixa a máquina pior do que a encontrou, e o §26.3 exige recibo de uninstall
 * para uma célula ser `pass` justamente por isso.
 */
export const PASSOS = Object.freeze([
  { id: "install", comando: "npm i -g <tarball>", recibo: "installReceiptRef" },
  { id: "runtime", comando: "gstack_vibehard doctor && gstack_vibehard verify --json", recibo: "runtimeReceiptRef" },
  { id: "enforcement", comando: "provar que um hook REALMENTE bloqueia (comando negado pelo PreToolUse)", recibo: "runtimeReceiptRef" },
  { id: "uninstall", comando: "gstack_vibehard uninstall --yes && npm rm -g @gstack-vibehard/installer", recibo: "uninstallReceiptRef" },
])

/**
 * O plano de execução. Não roda nada.
 *
 * `runnable` é `false` enquanto houver vestígio — e o motivo vem junto, com os
 * caminhos. A célula devolvida é `not_run`, que é o estado honesto até a
 * execução existir.
 */
export function planoDeCertificacao({ home = homedir(), os: sistema = process.platform, nodeVersion = process.version } = {}) {
  const vestigios = vestigiosEncontrados({ home })
  const versao = String(nodeVersion).replace(/^v/, "").split(".")[0]
  return {
    schemaVersion: CLEAN_MACHINE_E2E_SCHEMA,
    runnable: vestigios.length === 0,
    blockers: vestigios,
    steps: PASSOS,
    // O que a execução PRODUZIRIA — hoje `not_run`, e assim permanece até rodar.
    cell: celulaNaoExecutada({ os: sistema, arch: process.arch, nodeVersion: versao }),
    note: vestigios.length === 0
      ? "máquina sem vestígios: a certificação pode rodar aqui"
      : "máquina NÃO limpa — rodar aqui mediria um upgrade e chamaria de instalação do zero",
  }
}
