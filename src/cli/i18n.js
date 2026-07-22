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

const CATALOGS = Object.freeze({ "pt-BR": ptBR, en })

/** Resolve o locale efetivo: env explícito > preferência local > fallback PT-BR. */
export function resolveLocale({ env = process.env, configLocal = null } = {}) {
  if (SUPPORTED_LOCALES.includes(env.GSTACK_LANG)) return env.GSTACK_LANG
  if (SUPPORTED_LOCALES.includes(configLocal?.locale)) return configLocal.locale
  return DEFAULT_LOCALE
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
}

/** Traduz um messageId. Desconhecido NUNCA quebra — devolve marcador explícito, nunca esconde o erro. */
export function t(messageId, params = {}, locale = DEFAULT_LOCALE) {
  const catalog = CATALOGS[locale] || CATALOGS[DEFAULT_LOCALE]
  const template = catalog[messageId] || CATALOGS[DEFAULT_LOCALE][messageId]
  return template ? interpolate(template, params) : `[missing:${messageId}]`
}
