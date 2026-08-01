import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD48 P2.1 — Fase 0 da migração English-first (decisão humana na certificação do RC).
 *
 * Esta fase NÃO migra mensagem nenhuma. Ela estabelece a infraestrutura e, principalmente,
 * os controles que impedem a migração de dar errado em silêncio:
 *
 *  - `en` é o catálogo CANÔNICO; `pt-BR` pode ficar incompleto e não bloqueia (correção #5);
 *  - `DEFAULT_LOCALE` continua `pt-BR` até o cutover da Fase 6 — virar agora produziria
 *    uma CLI híbrida, pior que qualquer dos dois estados puros (correção #2);
 *  - NUNCA há fallback silencioso para português (controle #9);
 *  - `conversationLanguage` é eixo INDEPENDENTE do idioma da interface (correção #8).
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const impI18n = () => import(`${pathToFileURL(path.join(repoRoot, "src", "cli", "i18n.js"))}?t=${Date.now()}`)
const impConv = () => import(`${pathToFileURL(path.join(repoRoot, "src", "cli", "conversation-language.js"))}?t=${Date.now()}`)

test("Fase 0 NÃO faz cutover: DEFAULT_LOCALE continua pt-BR (evita CLI híbrida)", async () => {
  const { DEFAULT_LOCALE, CANONICAL_CLI_LOCALE } = await impI18n()
  assert.equal(DEFAULT_LOCALE, "pt-BR", "o cutover é da Fase 6, não desta")
  assert.equal(CANONICAL_CLI_LOCALE, "en", "mas o canônico já está declarado")
})

test("flag interna de migração resolve a interface para `en` sem virar o default", async () => {
  const { resolveCliLocale, resolveLocale } = await impI18n()
  const env = { GSTACK_CLI_LOCALE_MIGRATION: "1" }
  assert.equal(resolveCliLocale({ env }), "en", "superfície migrada pode ser exercitada em inglês")
  assert.equal(resolveLocale({ env }), "pt-BR", "o default de quem não usa a flag NÃO muda")
})

test("sem a flag, a resolução da interface é idêntica ao comportamento atual (zero regressão)", async () => {
  const { resolveCliLocale } = await impI18n()
  assert.equal(resolveCliLocale({ env: {} }), "pt-BR")
  assert.equal(resolveCliLocale({ env: { GSTACK_LANG: "en" } }), "en", "escolha explícita continua valendo")
})

test("CONTROLE #9 — pedir `en` com chave ausente NUNCA devolve português silenciosamente", async () => {
  const { t } = await impI18n()
  const r = t("id.que.nao.existe.em.lugar.nenhum", {}, "en")
  assert.match(r, /^\[missing:/, "some com marcador explícito, não com texto pt-BR")
})

test("`en` é canônico: id ausente NELE é defeito, mesmo existindo em pt-BR", async () => {
  const { missingFromCanonical } = await impI18n()
  assert.deepEqual(missingFromCanonical(["task.session_not_found"]), [], "id real existe no canônico")
  assert.deepEqual(missingFromCanonical(["nao.existe"]), ["nao.existe"])
})

test("correção #5: paridade com pt-BR NÃO é exigida — o canônico é que manda", async () => {
  const { t } = await impI18n()
  // Um id presente só no canônico deve resolver em pt-BR via fallback canônico, sem erro.
  const r = t("task.session_not_found", { id: "x" }, "pt-BR")
  assert.ok(!r.startsWith("[missing:"), "pt-BR incompleto não pode quebrar a CLI")
})

test("conversationLanguage é INDEPENDENTE do catálogo da CLI (idioma não suportado é aceito)", async () => {
  const { resolveConversationLanguage } = await impConv()
  assert.equal(resolveConversationLanguage({ env: { GSTACK_CONVERSATION_LANG: "ja" } }), "ja",
    "o usuário pode conversar num idioma que a CLI não fala")
})

test("conversationLanguage: env > persistido > default, e valor inválido é IGNORADO", async () => {
  const { resolveConversationLanguage, DEFAULT_CONVERSATION_LANGUAGE } = await impConv()
  assert.equal(resolveConversationLanguage({ env: {}, configLocal: { conversationLanguage: "es-AR" } }), "es-AR")
  assert.equal(resolveConversationLanguage({ env: { GSTACK_CONVERSATION_LANG: "en" }, configLocal: { conversationLanguage: "es-AR" } }), "en")
  assert.equal(resolveConversationLanguage({ env: { GSTACK_CONVERSATION_LANG: "../../etc/passwd" } }), DEFAULT_CONVERSATION_LANGUAGE,
    "valor absurdo cai no default, nunca propaga nem lança")
})

test("preferência inválida NUNCA é persistida", async () => {
  const { conversationLanguageUpdate } = await impConv()
  assert.deepEqual(conversationLanguageUpdate("pt-BR"), { conversationLanguage: "pt-BR" })
  assert.equal(conversationLanguageUpdate("<script>"), null)
  assert.equal(conversationLanguageUpdate(""), null)
})

test("o contrato que atravessa handoff/resume carrega cliLocale FIXO — nunca inferido da conversa", async () => {
  const { conversationContext } = await impConv()
  const c = conversationContext({ conversationLanguage: "pt-BR" })
  assert.equal(c.cliLocale, "en", "a interface não herda o idioma da conversa")
  assert.equal(c.conversationLanguage, "pt-BR")
  assert.equal(c.schemaVersion, "gstack.conversation-language.v1")
})

test("contrato com conversa inválida cai no default, sem quebrar a fronteira", async () => {
  const { conversationContext, DEFAULT_CONVERSATION_LANGUAGE } = await impConv()
  assert.equal(conversationContext({ conversationLanguage: 42 }).conversationLanguage, DEFAULT_CONVERSATION_LANGUAGE)
})
