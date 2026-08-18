/**
 * CONTRATO DE HOOKS DO CODEX — extraído do binário, não suposto.
 *
 * O `P0.CODEX-HOOKS` registrava "chaves TOML fora do contrato oficial". A
 * confrontação com o binário instalado mostrou algo MAIOR: a integração de hooks
 * do Codex do GStack nunca teve como executar. São três defeitos independentes, e
 * qualquer um sozinho já bastaria:
 *
 *   1. NOMES INEXISTENTES — `on_session_start` e `on_stop` aparecem ZERO vezes no
 *      binário do Codex. Não são "nomes antigos": não existem.
 *   2. FORMA ERRADA — o Codex descreve um handler como objeto
 *      (`type`/`command`/`timeout`/…) agrupado por `matcher`, e o GStack escrevia
 *      um array de strings.
 *   3. SEM CONFIANÇA — o Codex exige `trusted_hash` e diz, na própria interface,
 *      "Continue without trusting (hooks won't run)". Hook não confiado NÃO RODA.
 *
 * POR QUE ISTO EXISTE COMO ARQUIVO: sem um registro versionado, a próxima pessoa
 * repete a suposição. O contrato aqui é DERIVADO de evidência reproduzível, e o
 * teste confere as chaves que o produto escreve contra ele — não contra memória.
 *
 * COMO FOI OBTIDO (reproduzível): leitura das strings do executável
 * `codex.exe` v0.145.0 distribuído em
 * `@openai/codex/node_modules/@openai/codex-win32-x64/vendor/…/bin/codex.exe`.
 * O enum serde aparece literal, duas vezes, em blocos contíguos.
 *
 * O QUE ISTO NÃO É: documentação oficial. É o que o binário instalado contém.
 * Escrever uma integração NOVA a partir daqui exigiria também o modelo de
 * confiança (como o `trusted_hash` é calculado), que a extração não revela — e
 * inventá-lo seria o mesmo erro, com outro nome.
 */

export const CODEX_HOOK_CONTRACT_SCHEMA = "gstack.codex.hook-contract.v1"

export const CODEX_CONTRACT_PROVENANCE = Object.freeze({
  codexVersion: "0.145.0",
  extractedOn: "2026-08-17",
  method: "strings do executável distribuído (codex.exe), enum serde `HookEventName` literal",
  binary: "@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
  isOfficialDocumentation: false,
})

/** Nomes de evento na forma do PAYLOAD (`hook_event_name`), em snake_case. */
export const CODEX_EVENTS_WIRE = Object.freeze([
  "pre_tool_use", "permission_request", "post_tool_use",
  "pre_compact", "post_compact",
  "session_start", "session_end",
  "user_prompt_submit",
  "subagent_start", "subagent_stop",
])

/** Nomes de evento na forma da CONFIGURAÇÃO, em PascalCase. */
export const CODEX_EVENTS_CONFIG = Object.freeze([
  "PreToolUse", "PermissionRequest", "PostToolUse",
  "PreCompact", "PostCompact",
  "SessionStart", "SessionEnd",
  "UserPromptSubmit",
  "SubagentStart", "SubagentStop", "Stop",
])

/** Campos que o Codex espera num handler — não um array de strings. */
export const CODEX_HANDLER_FIELDS = Object.freeze([
  "type", "command", "commandWindows", "timeout", "async",
  "statusMessage", "additionalContextLimit", "prompt", "agent",
])

/** O estado por hook: sem `trusted_hash`, o Codex não executa. */
export const CODEX_HOOK_STATE_FIELDS = Object.freeze(["enabled", "trusted_hash"])

/**
 * As quatro chaves que o GStack ESCREVIA em `[hooks]` do `config.toml`.
 *
 * Preservadas para LIMPEZA: o instalador e o desinstalador precisam saber o que
 * remover da máquina de quem já instalou. Nenhuma delas volta a ser escrita.
 */
export const CHAVES_INERTES_ESCRITAS = Object.freeze([
  Object.freeze({ key: "on_session_start", problem: "não existe no binário do Codex (0 ocorrências)" }),
  Object.freeze({ key: "on_stop", problem: "não existe no binário do Codex (0 ocorrências); o evento equivalente é `session_end`" }),
  Object.freeze({ key: "pre_tool_use", problem: "nome de PAYLOAD, não de configuração; e o valor era array de strings, não handler" }),
  Object.freeze({ key: "post_tool_use", problem: "nome de PAYLOAD, não de configuração; e apontava para `stop.py`, que é o hook de OUTRO evento" }),
])

/** A chave é um nome de evento reconhecido pelo Codex, em qualquer das formas? */
export const ehEventoDoCodex = (chave) =>
  CODEX_EVENTS_WIRE.includes(chave) || CODEX_EVENTS_CONFIG.includes(chave)
