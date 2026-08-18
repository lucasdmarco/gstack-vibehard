/**
 * Diagnóstico de hooks do Codex — SEIS estados, e nenhum deles é "ok".
 *
 * O ponto do diagnóstico é distinguir coisas que se pareciam: um hook
 * registrado, confiado e com script no lugar é diferente de um registrado e não
 * confiado, e os dois são diferentes de um registrado apontando para script que
 * não existe. Antes, tudo isso era "instalado".
 *
 *   installed_trusted       registrado, script presente, hash confiado bate
 *   installed_untrusted     registrado e presente, mas o Codex ainda não
 *                           confiou — HOOK NÃO RODA, e o usuário precisa saber
 *   stale_hash              o script MUDOU depois da aprovação: a confiança caiu
 *                           por construção, e o Codex vai perguntar de novo
 *   missing_script          registro aponta para arquivo que não existe
 *   duplicate_registration  o mesmo script registrado mais de uma vez no evento
 *                           — rodaria N vezes
 *   legacy_registration     wiring antigo em `config.toml`, que o Codex ignora
 *
 * A CONFIANÇA É LIDA, NUNCA ESCRITA. `[hooks.state]` do `config.toml` pertence
 * ao Codex e ao usuário: este módulo compara hashes para RELATAR, e um
 * `trusted_hash` ausente vira `installed_untrusted` — jamais um hash inventado.
 */

import { createHash } from "crypto"

export const CODEX_HOOKS_DOCTOR_SCHEMA = "gstack.codex.hooks-doctor.v1"

export const ESTADOS = Object.freeze([
  "installed_trusted", "installed_untrusted", "stale_hash",
  "missing_script", "duplicate_registration", "legacy_registration",
])

/** SHA-256 do conteúdo — a mesma pergunta que o Codex faz ao script. */
export const hashDoScript = (conteudo) =>
  createHash("sha256").update(String(conteudo ?? ""), "utf8").digest("hex")

const entradasDe = (hooksJson, evento) => (hooksJson?.hooks?.[evento] || [])

const comandosDe = (entradas) =>
  entradas.flatMap((e) => (e?.hooks || []).map((h) => String(h?.command || "")))

/** Registros NOSSOS daquele evento, ou lista vazia. */
function registrosDe(hooksJson, decl) {
  return comandosDe(entradasDe(hooksJson, decl.event))
    .filter((c) => c.replaceAll("\\", "/").includes(`/${decl.script}`))
}

/** Problema de REGISTRO, ou `null` quando o registro está são. */
function problemaDeRegistro(registros, caminho, io) {
  if (registros.length === 0) return { state: "missing_script", detail: "não registrado em hooks.json" }
  if (registros.length > 1) return { state: "duplicate_registration", detail: `${registros.length} registros` }
  if (!io.existe(caminho)) return { state: "missing_script", detail: "registrado, mas o arquivo não existe" }
  return null
}

/** Estado de CONFIANÇA, dado que o registro está são. */
function estadoDeConfianca(atual, confiado) {
  if (!confiado) return { state: "installed_untrusted", hash: atual }
  if (confiado !== atual) return { state: "stale_hash", hash: atual, trusted: confiado }
  return { state: "installed_trusted", hash: atual }
}

/**
 * Estado de UM hook declarado.
 *
 * `io` é injetado (`existe`, `ler`) para que o diagnóstico seja testável sem
 * tocar disco — e para que nenhum teste precise de instalação real.
 */
export function estadoDoHook(decl, ctx) {
  const { hooksJson, legacyConfig, trustState = {}, io, hooksDir } = ctx
  const caminho = `${hooksDir}/${decl.script}`.replaceAll("\\", "/")
  const base = { event: decl.event, script: decl.script, path: caminho }

  // Legado ANTES de tudo: enquanto ele existir, há duas fontes de verdade sobre
  // o mesmo hook, e relatar só a nova esconderia a antiga.
  if (temLegado(legacyConfig)) return { ...base, state: "legacy_registration" }

  const problema = problemaDeRegistro(registrosDe(hooksJson, decl), caminho, io)
  if (problema) return { ...base, ...problema }

  const atual = hashDoScript(io.ler(caminho))
  return { ...base, ...estadoDeConfianca(atual, trustState[decl.script] || trustState[caminho] || null) }
}

/** O `config.toml` ainda carrega wiring legado de hooks? */
export function temLegado(legacyConfig) {
  const h = legacyConfig?.hooks
  if (!h || typeof h !== "object") return false
  // `state` é o ledger de CONFIANÇA e pertence ao Codex — a presença dele não é
  // wiring legado. Qualquer OUTRA chave sob `[hooks]` é.
  return Object.keys(h).some((k) => k !== "state")
}

/** Relatório completo. `ok` exige que TODOS estejam `installed_trusted`. */
export function diagnosticarHooksDoCodex(declaracoes, ctx) {
  const hooks = declaracoes.map((d) => estadoDoHook(d, ctx))
  const porEstado = {}
  for (const h of hooks) porEstado[h.state] = (porEstado[h.state] || 0) + 1
  return {
    schemaVersion: CODEX_HOOKS_DOCTOR_SCHEMA,
    // `ok` NUNCA é verdadeiro com hook não confiado: ele não roda, e chamar isso
    // de instalado é a diferença entre integração e aparência de integração.
    ok: hooks.every((h) => h.state === "installed_trusted"),
    byState: porEstado,
    hooks,
  }
}
