import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.6 — i18n: locale via GSTACK_LANG ou config.local.json, fallback PT-BR. JSON
// nunca traduz keys/enums; exit codes não mudam; mensagem de erro tem messageId estável.

test("resolveLocale: GSTACK_LANG explícito vence", async () => {
  const { resolveLocale } = await imp("src/cli/i18n.js")
  assert.equal(resolveLocale({ env: { GSTACK_LANG: "en" }, configLocal: { locale: "pt-BR" } }), "en")
})

test("resolveLocale: sem env, usa config.local.json", async () => {
  const { resolveLocale } = await imp("src/cli/i18n.js")
  assert.equal(resolveLocale({ env: {}, configLocal: { locale: "en" } }), "en")
})

test("resolveLocale: sem nada -> fallback PT-BR (DoD desta migração)", async () => {
  const { resolveLocale, DEFAULT_LOCALE } = await imp("src/cli/i18n.js")
  assert.equal(resolveLocale({ env: {}, configLocal: null }), "pt-BR")
  assert.equal(DEFAULT_LOCALE, "pt-BR")
})

test("resolveLocale: locale não suportado (env ou config) é ignorado -> fallback, nunca quebra", async () => {
  const { resolveLocale } = await imp("src/cli/i18n.js")
  assert.equal(resolveLocale({ env: { GSTACK_LANG: "klingon" }, configLocal: null }), "pt-BR")
})

test("t: traduz o mesmo messageId em PT-BR e EN — semântica igual, texto diferente", async () => {
  const { t } = await imp("src/cli/i18n.js")
  const pt = t("task.session_not_found", { sessionId: "s1" }, "pt-BR")
  const en = t("task.session_not_found", { sessionId: "s1" }, "en")
  assert.match(pt, /s1/)
  assert.match(en, /s1/)
  assert.notEqual(pt, en, "traduções diferentes para o mesmo id")
})

test("t: messageId desconhecido NUNCA quebra — devolve marcador explícito, nunca esconde o erro", async () => {
  const { t } = await imp("src/cli/i18n.js")
  assert.equal(t("id.que.nao.existe", {}, "pt-BR"), "[missing:id.que.nao.existe]")
})

test("t: locale desconhecido cai pro catálogo default sem lançar", async () => {
  const { t } = await imp("src/cli/i18n.js")
  const r = t("task.session_not_found", { sessionId: "x" }, "fr")
  assert.match(r, /x/)
})

test("catálogos PT-BR e EN têm exatamente o MESMO conjunto de messageIds (nenhum órfão)", async () => {
  const pt = (await imp("src/cli/messages/pt-BR.js")).default
  const en = (await imp("src/cli/messages/en.js")).default
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort())
})

test("taskCommand inspect <inexistente> --json: JSON traz messageId estável, texto NUNCA vaza pro campo error (contrato de máquina)", async () => {
  const { taskCommand } = await imp("src/commands/task.js")
  const { mkdtempSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-i18n-task-"))
  try {
    const chunks = []
    const orig = process.stdout.write
    process.stdout.write = (s) => { chunks.push(s); return true }
    try { await taskCommand(["inspect", "id-inexistente", "--json"], { cwd }) } finally { process.stdout.write = orig }
    const out = JSON.parse(chunks.join(""))
    assert.equal(out.error, "session_not_found", "enum da máquina não muda com locale")
    assert.equal(out.messageId, "task.session_not_found")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
