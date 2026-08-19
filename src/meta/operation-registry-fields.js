/**
 * Os quatro campos que o §14 pedia e o registry não tinha — ADR-006 (S52.H).
 *
 * O §14 do PRD52 mandava criar `command-registry.js` como fonte única de
 * handler, alias, help e flags. A comparação formal exigida antes de criar o
 * arquivo mostrou que `operation-registry.js` já descreve a MESMA entidade —
 * mesma identidade, mesmo ownership, mesmo lifecycle — e o ADR-006 decidiu
 * ESTENDER. Dois registries sobre os mesmos comandos produziriam duas verdades,
 * e a segunda envelheceria calada.
 *
 * A disciplina que separa extensão de inchaço está aqui: os campos são
 * OPCIONAIS e a ausência NÃO é inferida. Um comando sem `handler` declarado não
 * vira "handler pelo nome" — ele fica sem handler declarado, que é uma coisa que
 * se pode ver e corrigir. Inferir pelo nome funcionaria em 47 dos 49 comandos e
 * mentiria nos dois que importam.
 *
 * E cada campo é VERIFICÁVEL contra a CLI real: `handler` tem de existir no
 * DISPATCH, `help` na tabela de ajuda, `alias` no DISPATCH, e cada flag
 * declarada tem de estar documentada no `usage` do comando. A última é a que
 * mais rende: uma flag que o código lê e o help não menciona existe só para
 * quem leu a fonte.
 */

import { COMMANDS } from "../cli/index.js"

export const OPERATION_FIELDS_SCHEMA = "gstack.operation-registry.fields.v1"

/** Os campos que o ADR-006 acrescentou. Todos OPCIONAIS, nenhum inferido. */
export const CAMPOS_OPCIONAIS = Object.freeze(["handler", "alias", "help", "flags"])

const usageDe = (nome) => (COMMANDS.find((c) => c.name === nome) || {}).usage || ""
const nomesDeHelp = () => new Set(COMMANDS.map((c) => c.name))

/**
 * As chaves do DISPATCH, lidas da CLI real.
 *
 * O DISPATCH não é exportado (é detalhe interno do módulo), então a leitura é do
 * FONTE. Preferível a exportá-lo só para satisfazer este check: exportar
 * ampliaria a superfície pública do CLI por causa de uma verificação, e a
 * verificação passaria a moldar o desenho em vez de observá-lo.
 */
export function chavesDoDispatch(fonteDoCli) {
  const i = fonteDoCli.indexOf("const DISPATCH = {")
  if (i < 0) return new Set()
  const bloco = fonteDoCli.slice(i, fonteDoCli.indexOf("\n}", i))
  return new Set([...bloco.matchAll(/^\s{2}"?([a-z][\w-]*)"?:\s/gm)].map((m) => m[1]))
}

const declarado = (entry, campo) => entry[campo] !== undefined && entry[campo] !== null

/** Handler declarado que não existe no DISPATCH — declaração sem destino. */
export function handlersInexistentes(registry, dispatchKeys) {
  return registry
    .filter((e) => declarado(e, "handler") && !dispatchKeys.has(e.handler))
    .map((e) => ({ command: e.command, subcommand: e.subcommand, handler: e.handler }))
}

/** Alias declarado que não existe no DISPATCH — o usuário digitaria e não aconteceria nada. */
export function aliasesInexistentes(registry, dispatchKeys) {
  return registry
    .filter((e) => declarado(e, "alias") && !dispatchKeys.has(e.alias))
    .map((e) => ({ command: e.command, alias: e.alias }))
}

/** Entrada de help declarada que não existe na tabela de ajuda. */
export function helpsInexistentes(registry, nomes = nomesDeHelp()) {
  return registry
    .filter((e) => declarado(e, "help") && !nomes.has(e.help))
    .map((e) => ({ command: e.command, help: e.help }))
}

/**
 * Flags que a operação LÊ e o help NÃO documenta.
 *
 * Não é preciosismo: uma flag invisível no `--help` só é usável por quem leu o
 * código-fonte, e o produto passa a ter duas superfícies — a documentada e a
 * real. O registry declara a real; esta função mostra a distância entre as duas.
 */
export function flagsNaoDocumentadas(registry) {
  return registry
    .filter((e) => Array.isArray(e.flags) && e.flags.length > 0)
    .flatMap((e) => {
      const usage = usageDe(e.help || e.command)
      const faltando = e.flags.filter((f) => !usage.includes(f))
      return faltando.length ? [{ command: e.command, subcommand: e.subcommand, undocumented: faltando }] : []
    })
}

/**
 * Tudo junto — o que está ERRADO na declaração dos campos novos.
 *
 * `flagsNaoDocumentadas` sai SEPARADA das outras três: as três primeiras são
 * declaração quebrada (aponta para o que não existe), e esta é uma lacuna de
 * documentação do produto. Misturá-las faria um problema do help parecer erro do
 * registry, e o registry seria "consertado" apagando a declaração verdadeira.
 */
export function problemasDosCamposNovos(registry, dispatchKeys) {
  return {
    schemaVersion: OPERATION_FIELDS_SCHEMA,
    brokenDeclarations: [
      ...handlersInexistentes(registry, dispatchKeys).map((x) => ({ kind: "handler", ...x })),
      ...aliasesInexistentes(registry, dispatchKeys).map((x) => ({ kind: "alias", ...x })),
      ...helpsInexistentes(registry).map((x) => ({ kind: "help", ...x })),
    ],
    undocumentedFlags: flagsNaoDocumentadas(registry),
  }
}
