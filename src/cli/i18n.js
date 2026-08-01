/**
 * PRD48 S48.6 — i18n mínimo e honesto: locale via `GSTACK_LANG` ou `config.local.json`
 * (`policy/layers.js`, já real), fallback PT-BR nesta migração. IDs de mensagem ESTÁVEIS —
 * o catálogo pode mudar o texto livremente, nunca a chave. `--json` NUNCA traduz keys/enums
 * (contrato de máquina imutável); só o texto humano usa este módulo.
 */
import ptBR from "./messages/pt-BR.js"
import en from "./messages/en.js"

export const I18N_SCHEMA = "gstack.i18n.v1"
export const SUPPORTED_LOCALES = Object.freeze(["pt-BR", "en"])
export const DEFAULT_LOCALE = "pt-BR"

/**
 * PRD48 P2.1 — Fase 0 da migração English-first (decisão humana no RC).
 *
 * `en` é o catálogo CANÔNICO da CLI: toda mensagem pública pertencente ao GStack deve
 * existir em inglês. `pt-BR` deixa de ser referência de paridade — pode ficar incompleto
 * e NÃO bloqueia o RC (correção #5 do plano aprovado).
 *
 * `DEFAULT_LOCALE` continua `pt-BR` DE PROPÓSITO: o cutover só acontece na Fase 6, depois
 * que todas as superfícies estiverem migradas e os gates passarem. Virar o default agora
 * produziria uma CLI híbrida — metade inglês, metade português — que é pior para o
 * usuário do que qualquer um dos dois estados puros (correção #2).
 */
export const CANONICAL_CLI_LOCALE = "en"

/**
 * Flag INTERNA de migração. Existe para exercitar superfícies já migradas em `en` sem
 * expor seletor de idioma nem virar o default. Não é contrato público e some no cutover.
 */
export function cliLocaleMigrationEnabled(env = process.env) {
  return env.GSTACK_CLI_LOCALE_MIGRATION === "1"
}

/**
 * Locale da INTERFACE (distinto do idioma de conversa com as LLMs). Sob a flag de
 * migração resolve para o canônico; sem ela, comportamento atual intacto.
 */
export function resolveCliLocale({ env = process.env, configLocal = null } = {}) {
  if (cliLocaleMigrationEnabled(env)) return CANONICAL_CLI_LOCALE
  return resolveLocale({ env, configLocal })
}

const CATALOGS = Object.freeze({ "pt-BR": ptBR, en })

/** Resolve o locale efetivo: env explícito > preferência local > fallback PT-BR. */
export function resolveLocale({ env = process.env, configLocal = null } = {}) {
  if (SUPPORTED_LOCALES.includes(env.GSTACK_LANG)) return env.GSTACK_LANG
  if (SUPPORTED_LOCALES.includes(configLocal?.locale)) return configLocal.locale
  return DEFAULT_LOCALE
}

/**
 * IDs que o catálogo canônico (`en`) precisa conter. Base do gate de messageId ausente
 * (controle #9 do plano): um id usado em código sem entrada em `en` é defeito, mesmo que
 * exista em pt-BR — o inverso não é verdade.
 */
export function missingFromCanonical(messageIds = []) {
  return messageIds.filter((id) => !CATALOGS[CANONICAL_CLI_LOCALE][id])
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
}

/**
 * Traduz um messageId. Desconhecido NUNCA quebra — devolve marcador explícito.
 *
 * PRD48 P2.1 Fase 0 — a cadeia de fallback deixou de terminar em pt-BR. Antes, um id
 * ausente no catálogo pedido caía em `CATALOGS[DEFAULT_LOCALE]`, ou seja: quem pedisse
 * `en` e esbarrasse numa chave faltante recebia PORTUGUÊS sem qualquer sinal. É
 * exatamente o "fallback silencioso para português" que o controle #9 proíbe — e seria
 * indistinguível de uma migração bem-sucedida.
 *
 * Agora: locale pedido → canônico (`en`) → marcador explícito. pt-BR nunca resgata um
 * pedido de `en`; no máximo o inverso, que é honesto enquanto o pt-BR for o incompleto.
 */
export function t(messageId, params = {}, locale = DEFAULT_LOCALE) {
  const catalog = CATALOGS[locale] || CATALOGS[CANONICAL_CLI_LOCALE]
  const template = catalog[messageId] || CATALOGS[CANONICAL_CLI_LOCALE][messageId]
  return template ? interpolate(template, params) : `[missing:${messageId}]`
}
