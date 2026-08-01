/**
 * Idioma de CONVERSA com as LLMs (PRD48 P2.1, Fase 0 da migração English-first).
 *
 * Decisão de produto do RC: são DOIS eixos independentes, e confundi-los foi o que
 * produziu a CLI meio-português-meio-inglês que este trabalho corrige.
 *
 *   cliLocale            — idioma da interface determinística do GStack. Canônico `en`.
 *                          Sem seletor exposto neste RC (`cli/i18n.js`).
 *   conversationLanguage — idioma em que o usuário quer CONVERSAR e receber as respostas
 *                          do modelo. Preferência do usuário, livre, default `pt-BR`.
 *
 * Por que independentes: a interface precisa ser previsível e diffável (mensagem de erro
 * é contrato de suporte, entra em issue e em log); a conversa precisa ser confortável.
 * Uma não deve arrastar a outra — e nada aqui toca JSON, schemas, enums, IDs, flags ou
 * exit codes, que permanecem invariantes em inglês.
 *
 * Este módulo NÃO valida contra `SUPPORTED_LOCALES` do catálogo da CLI: o usuário pode
 * querer conversar num idioma que a CLI não fala. Amarrar os dois recriaria o acoplamento
 * que o RC decidiu quebrar.
 */
export const CONVERSATION_LANGUAGE_SCHEMA = "gstack.conversation-language.v1"

export const DEFAULT_CONVERSATION_LANGUAGE = "pt-BR"

// Tag de idioma BCP-47 simplificada: `pt`, `pt-BR`, `en`, `zh-Hant`. Rejeita lixo sem
// tentar ser um validador completo — o objetivo é impedir injeção/valor absurdo, não
// arbitrar o registro IANA.
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z]{2,8}){0,2}$/

export function isValidConversationLanguage(value) {
  return typeof value === "string" && LANGUAGE_TAG.test(value)
}

/**
 * Resolve o idioma de conversa: env explícito > preferência persistida > default.
 *
 * Valor inválido é IGNORADO (cai no próximo nível), nunca propagado nem lançado — o
 * mesmo contrato de `resolveLocale`: preferência corrompida jamais quebra a CLI.
 */
export function resolveConversationLanguage({ env = process.env, configLocal = null } = {}) {
  if (isValidConversationLanguage(env.GSTACK_CONVERSATION_LANG)) return env.GSTACK_CONVERSATION_LANG
  if (isValidConversationLanguage(configLocal?.conversationLanguage)) return configLocal.conversationLanguage
  return DEFAULT_CONVERSATION_LANGUAGE
}

/**
 * Bloco de preferência a persistir em `config.local.json` (via
 * `policy/layers.js#writeLocalProfileUpdate`, que faz merge raso e nunca reescreve o
 * arquivo inteiro). Devolve `null` para valor inválido — não persiste lixo.
 */
export function conversationLanguageUpdate(value) {
  return isValidConversationLanguage(value) ? { conversationLanguage: value } : null
}

/**
 * Contrato que atravessa as fronteiras onde a preferência precisa SOBREVIVER
 * (`start`, `workflow`, `delegate`, `handoff`, `resume`, troca de harness).
 *
 * `cliLocale` viaja junto e explicitamente FIXO no canônico: quem receber este contrato
 * do outro lado não deve inferir o idioma da interface a partir do idioma de conversa —
 * foi essa inferência que produziu a mistura original.
 */
export function conversationContext({ conversationLanguage, cliLocale = "en" } = {}) {
  return {
    schemaVersion: CONVERSATION_LANGUAGE_SCHEMA,
    cliLocale,
    conversationLanguage: isValidConversationLanguage(conversationLanguage)
      ? conversationLanguage
      : DEFAULT_CONVERSATION_LANGUAGE,
  }
}
