/**
 * O estado REAL dos hooks do Codex nesta máquina (PRD52 S52.F).
 *
 * O `codex-hooks-doctor.js` do PRD51 nunca teve consumidor: existia com testes e
 * nenhum caminho de produto o chamava. Ligá-lo à máquina real revelou o que só
 * o uso revela.
 *
 * ACHADO 1 — a chave do ledger de confiança não é o script. O `[hooks.state]` do
 * `config.toml` é indexado por POSIÇÃO DE REGISTRO:
 *   `<caminho do hooks.json>:<evento_wire>:<índice do matcher>:<índice do hook>`
 * O doctor procurava confiança por nome/caminho de script, e por isso nunca
 * acharia nada num `config.toml` de verdade.
 *
 * ACHADO 2 — o `trusted_hash` NÃO é verificável de fora. Foram testadas 16
 * regras plausíveis (conteúdo do script cru/LF/CRLF/UTF-16, string do comando
 * em variações, JSON do hook e da entrada em formatações distintas, comando
 * combinado com o matcher): nenhuma reproduz o hash gravado. O contrato do
 * Codex já estava marcado como `isOfficialDocumentation: false`, e aqui isso
 * cobra o preço — não dá para afirmar que o hash confiado corresponde ao script
 * de hoje.
 *
 * A CONSEQUÊNCIA é o desenho deste módulo: ele relata SÓ o que é observável e
 * usa vocabulário próprio para não emprestar do doctor uma certeza que a
 * máquina não oferece. `trust_entry_present` diz que existe entrada de confiança
 * para aquele slot — e diz exatamente isso, nunca "o script atual está
 * confiado".
 *
 * E o principal: **registrado e confiado não é enforcement observado**. Um hook
 * só está provado quando RODA — quando uma execução real é bloqueada ou
 * registrada por ele. Este módulo devolve `enforcementObserved: false` sempre,
 * porque a leitura de arquivos não pode provar execução, e o P0 do Codex segue
 * aberto até a prova em máquina limpa.
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { GSTACK_CODEX_HOOKS } from "./codex-hooks-json.js"

export const CODEX_HOOKS_STATUS_SCHEMA = "gstack.codex.hooks-status.v1"

/**
 * Os estados OBSERVÁVEIS por leitura de arquivo.
 *
 * Deliberadamente distintos dos do doctor: lá existe `installed_trusted`, que
 * afirma correspondência de hash. Aqui essa afirmação não é possível, e usar a
 * mesma palavra faria o relatório prometer uma verificação que não aconteceu.
 */
export const ESTADOS_OBSERVAVEIS = Object.freeze([
  "not_registered", "missing_script", "duplicate_registration",
  "registered_untrusted", "trust_entry_present",
])

const TRUST_KEY = /\[hooks\.state\.'([^']+)'\]/g

/**
 * O nome do evento como o ledger o escreve: `SessionStart` → `session_start`.
 *
 * DERIVADO, não consultado numa lista. `CODEX_EVENTS_WIRE` do contrato do PRD51
 * é um ARRAY de nomes observados e nem sequer contém `stop` — que o ledger desta
 * máquina usa. Uma lista incompleta consultada como se fosse mapa produzia
 * `undefined` no meio da chave, e o resultado era todo hook aparecendo como não
 * confiado. A derivação não tem esse buraco.
 */
export const eventoWire = (evento) => String(evento)
  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
  .toLowerCase()

/** As chaves de confiança declaradas no `config.toml`, na forma em que o Codex as grava. */
export function chavesDeConfianca(tomlTexto) {
  return new Set([...String(tomlTexto || "").matchAll(TRUST_KEY)].map((m) => m[1]))
}

/** A chave que o Codex usaria para ESTE slot de registro. */
export const chaveDoSlot = (hooksJsonPath, eventoWire, iMatcher, iHook) =>
  `${hooksJsonPath}:${eventoWire}:${iMatcher}:${iHook}`

const normaliza = (s) => String(s || "").replaceAll("\\", "/")

/** Os slots em que ESTE script aparece registrado, com os índices que a chave usa. */
function slotsDoScript(hooksJson, decl) {
  const entradas = hooksJson?.hooks?.[decl.event] || []
  const achados = []
  entradas.forEach((entrada, iMatcher) => {
    ;(entrada?.hooks || []).forEach((h, iHook) => {
      if (normaliza(h?.command).includes(`/${decl.script}`)) achados.push({ iMatcher, iHook })
    })
  })
  return achados
}

/** Problema de REGISTRO, ou `null` quando o registro está são. */
function problemaDeRegistro(slots, caminhoScript) {
  if (slots.length === 0) return { state: "not_registered", detail: "não aparece em hooks.json" }
  if (slots.length > 1) return { state: "duplicate_registration", detail: `${slots.length} registros` }
  if (!existsSync(caminhoScript)) return { state: "missing_script", detail: "registrado, mas o arquivo não existe" }
  return null
}

/** Estado de UM hook declarado, contra os arquivos reais. */
export function estadoObservado(decl, { hooksJson, hooksJsonPath, trustKeys, hooksDir }) {
  const caminhoScript = join(hooksDir, decl.script)
  const base = { event: decl.event, script: decl.script, path: caminhoScript }
  const slots = slotsDoScript(hooksJson, decl)
  const problema = problemaDeRegistro(slots, caminhoScript)
  if (problema) return { ...base, ...problema }

  const wire = eventoWire(decl.event)
  const chave = chaveDoSlot(hooksJsonPath, wire, slots[0].iMatcher, slots[0].iHook)
  return trustKeys.has(chave)
    ? { ...base, state: "trust_entry_present", trustKey: chave }
    : { ...base, state: "registered_untrusted", trustKey: chave, detail: "sem entrada em [hooks.state]" }
}

const lerJson = (p) => {
  try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null }
}
const lerTexto = (p) => {
  try { return readFileSync(p, "utf-8") } catch { return "" }
}

/**
 * O relatório da máquina.
 *
 * `enforcementObserved` é SEMPRE `false` aqui, e o motivo vem junto: ler arquivo
 * prova registro, não execução. Quem prova execução é a certificação em máquina
 * limpa, que ainda não rodou.
 */
export function statusDosHooksDoCodex({ home = homedir() } = {}) {
  const codexHome = join(home, ".codex")
  const hooksJsonPath = join(codexHome, "hooks.json")
  const hooksDir = join(codexHome, "hooks")
  const hooksJson = lerJson(hooksJsonPath)
  const trustKeys = chavesDeConfianca(lerTexto(join(codexHome, "config.toml")))

  const hooks = GSTACK_CODEX_HOOKS.map((d) =>
    estadoObservado(d, { hooksJson, hooksJsonPath, trustKeys, hooksDir }))
  const byState = {}
  for (const h of hooks) byState[h.state] = (byState[h.state] || 0) + 1

  return {
    schemaVersion: CODEX_HOOKS_STATUS_SCHEMA,
    present: Boolean(hooksJson),
    hooksJsonPath,
    hooks,
    byState,
    // Todos registrados COM entrada de confiança é o teto do que a leitura
    // alcança. Não é enforcement, e o campo abaixo impede confundir os dois.
    allRegisteredWithTrustEntry: hooks.length > 0 && hooks.every((h) => h.state === "trust_entry_present"),
    enforcementObserved: false,
    enforcementNote: "ler arquivo prova REGISTRO, nunca EXECUÇÃO; e o `trusted_hash` do Codex não é reproduzível de fora (16 regras testadas). A prova de enforcement é a certificação em máquina limpa, que ainda não rodou.",
  }
}
