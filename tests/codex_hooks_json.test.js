import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * `~/.codex/hooks.json` — a ÚNICA autoridade de hooks do Codex.
 *
 * O `P0.CODEX-HOOKS` teve DUAS leituras erradas antes desta. A primeira dizia
 * "chaves TOML fora do contrato oficial"; a segunda, minha, concluiu que a
 * integração não era construível porque o modelo de confiança não estava
 * documentado. As duas erravam o mesmo alvo: o contrato canônico é
 * `hooks.json`, e `config.toml [hooks.state]` é LEDGER DE CONFIANÇA — do Codex e
 * do usuário —, nunca configuração declarativa.
 *
 * O que fica desta história, e o que estes testes guardam: o produto declara
 * hooks num lugar só, é dono apenas do que escreveu, e NÃO fabrica confiança.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const OPTS = { hooksDir: "/home/u/.codex/hooks", pythonCmd: "python3" }

const sandbox = (t) => {
  const raiz = mkdtempSync(path.join(tmpdir(), "gstack-hooksjson-"))
  t.after(() => cleanupTmp(raiz))
  const home = path.join(raiz, "home", ".codex")
  mkdirSync(path.join(home, "hooks"), { recursive: true })
  return { raiz, codexDir: home, hooksDir: path.join(home, "hooks").replaceAll("\\", "/") }
}

const HOOK_DO_USUARIO = {
  hooks: {
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "meu-proprio.sh" }] }],
    PreToolUse: [{ matcher: "^Read$", hooks: [{ type: "command", command: "/opt/meu/guard.sh" }] }],
  },
}

// ── O schema oficial, por evento ───────────────────────────────────────────

test("cada hook declarado usa um EventName do contrato canônico", async () => {
  const { GSTACK_CODEX_HOOKS } = await imp("src/harness/codex-hooks-json.js")
  const oficiais = new Set([
    "SessionStart", "PreToolUse", "PostToolUse",
    "PermissionRequest", "Stop", "UserPromptSubmit",
  ])
  assert.ok(GSTACK_CODEX_HOOKS.length >= 6)
  for (const h of GSTACK_CODEX_HOOKS) {
    assert.ok(oficiais.has(h.event), `${h.event} fora do contrato`)
    assert.ok(h.matcher, `${h.event} sem matcher`)
    assert.ok(h.script.endsWith(".py"))
  }
})

/**
 * O DEFEITO SEMÂNTICO do achado original: `PostToolUse` executava `stop.py`,
 * aditivamente e em silêncio, enquanto `post_tool_use_review.py` existia e nunca
 * era registrado.
 */
test("PostToolUse aponta para `post_tool_use_review.py`, NUNCA para `stop.py`", async () => {
  const { GSTACK_CODEX_HOOKS } = await imp("src/harness/codex-hooks-json.js")
  const post = GSTACK_CODEX_HOOKS.find((h) => h.event === "PostToolUse")
  assert.equal(post.script, "post_tool_use_review.py")
  const stop = GSTACK_CODEX_HOOKS.find((h) => h.event === "Stop")
  assert.equal(stop.script, "stop.py", "e `stop.py` fica onde é dele")
})

test("a entrada emitida tem a forma do contrato: matcher + hooks[{type,command}]", async () => {
  const { mergeGstackHooks } = await imp("src/harness/codex-hooks-json.js")
  const doc = mergeGstackHooks({}, OPTS)
  for (const [evento, entradas] of Object.entries(doc.hooks)) {
    for (const e of entradas) {
      assert.ok(typeof e.matcher === "string", `${evento} sem matcher`)
      assert.ok(Array.isArray(e.hooks))
      for (const h of e.hooks) {
        assert.equal(h.type, "command")
        assert.ok(h.command.includes("python3"))
        assert.ok(h.command.includes(".py"))
      }
    }
  }
})

// ── Merge não destrutivo ───────────────────────────────────────────────────

test("hooks.json AUSENTE: o arquivo nasce só com o que o GStack declara", async () => {
  const { mergeGstackHooks, GSTACK_CODEX_HOOKS } = await imp("src/harness/codex-hooks-json.js")
  const doc = mergeGstackHooks({}, OPTS)
  assert.equal(Object.keys(doc.hooks).length, new Set(GSTACK_CODEX_HOOKS.map((h) => h.event)).size)
})

test("hooks.json COM hooks do usuário: os dele ficam, e em primeiro", async () => {
  const { mergeGstackHooks } = await imp("src/harness/codex-hooks-json.js")
  const doc = mergeGstackHooks(structuredClone(HOOK_DO_USUARIO), OPTS)

  assert.equal(doc.hooks.SessionStart.length, 2)
  assert.deepEqual(doc.hooks.SessionStart[0], HOOK_DO_USUARIO.hooks.SessionStart[0],
    "a entrada do usuário precisa sobreviver byte a byte")
  assert.deepEqual(doc.hooks.PreToolUse[0], HOOK_DO_USUARIO.hooks.PreToolUse[0])
})

/**
 * REINSTALL/UPGRADE. A versão ingênua (append) criaria uma entrada por
 * instalação, e o hook rodaria N vezes — o defeito mais fácil de não perceber,
 * porque tudo continua "funcionando".
 */
test("REINSTALL é idempotente: mergear duas vezes dá o MESMO documento", async () => {
  const { mergeGstackHooks } = await imp("src/harness/codex-hooks-json.js")
  const um = mergeGstackHooks(structuredClone(HOOK_DO_USUARIO), OPTS)
  const dois = mergeGstackHooks(structuredClone(um), OPTS)
  assert.deepEqual(dois, um)
})

test("UPGRADE substitui a entrada antiga do GStack em vez de acrescentar", async () => {
  const { mergeGstackHooks } = await imp("src/harness/codex-hooks-json.js")
  const antigo = mergeGstackHooks({}, { ...OPTS, pythonCmd: "python" })
  const novo = mergeGstackHooks(antigo, { ...OPTS, pythonCmd: "python3" })

  assert.equal(novo.hooks.Stop.length, 1, "duas entradas fariam o Stop rodar duas vezes")
  assert.ok(novo.hooks.Stop[0].hooks[0].command.startsWith("python3"))
})

test("ENTRADA DUPLICADA pré-existente é colapsada numa só", async () => {
  const { mergeGstackHooks } = await imp("src/harness/codex-hooks-json.js")
  const dup = mergeGstackHooks({}, OPTS)
  dup.hooks.Stop = [...dup.hooks.Stop, ...dup.hooks.Stop]
  assert.equal(dup.hooks.Stop.length, 2)

  const limpo = mergeGstackHooks(dup, OPTS)
  assert.equal(limpo.hooks.Stop.length, 1)
})

// ── Uninstall seletivo ─────────────────────────────────────────────────────

test("UNINSTALL remove SÓ o do GStack; o do usuário fica intacto", async () => {
  const { mergeGstackHooks, stripGstackHooks } = await imp("src/harness/codex-hooks-json.js")
  const cheio = mergeGstackHooks(structuredClone(HOOK_DO_USUARIO), OPTS)
  const limpo = stripGstackHooks(cheio, OPTS)

  assert.deepEqual(limpo.hooks.SessionStart, HOOK_DO_USUARIO.hooks.SessionStart)
  assert.deepEqual(limpo.hooks.PreToolUse, HOOK_DO_USUARIO.hooks.PreToolUse)
  assert.equal("Stop" in limpo.hooks, false, "evento que só tinha o nosso desaparece")
})

test("UNINSTALL num documento só do GStack deixa `hooks` fora do arquivo", async () => {
  const { mergeGstackHooks, stripGstackHooks } = await imp("src/harness/codex-hooks-json.js")
  const limpo = stripGstackHooks(mergeGstackHooks({}, OPTS), OPTS)
  assert.equal("hooks" in limpo, false)
})

// ── Instalação em HOME descartável ─────────────────────────────────────────

test("INSTALAÇÃO em HOME descartável escreve o arquivo e devolve ownership", async (t) => {
  const s = sandbox(t)
  const { writeCodexHooksJson } = await imp("src/harness/codex.js")
  const alvo = path.join(s.codexDir, "hooks.json")

  const r = writeCodexHooksJson(alvo, {
    hooksDir: s.hooksDir, pythonCmd: "python3",
    readImpl: readFileSync, writeImpl: (f, c) => writeFileSync(f, c),
  })
  assert.equal(r.ok, true)
  assert.ok(existsSync(alvo))

  const doc = JSON.parse(readFileSync(alvo, "utf-8"))
  assert.ok(doc.hooks.SessionStart)

  // OWNERSHIP: cada entrada precisa dizer arquivo, evento, matcher e comando.
  assert.ok(r.items.length >= 6)
  for (const it of r.items) {
    assert.equal(it.kind, "codex-hook-entry")
    assert.equal(it.path, alvo)
    assert.ok(it.event && it.matcher && it.command)
    assert.equal(it.removeOnUninstall, true)
  }
})

/**
 * `hooks.json` ILEGÍVEL do usuário NÃO é sobrescrito às cegas. É a mesma decisão
 * já tomada para o `config.toml`: escrever por cima resolveria o nosso problema
 * destruindo o dele.
 */
test("hooks.json ilegível é PRESERVADO, e o motivo é reportado", async (t) => {
  const s = sandbox(t)
  const { writeCodexHooksJson } = await imp("src/harness/codex.js")
  const alvo = path.join(s.codexDir, "hooks.json")
  writeFileSync(alvo, "{ isto nao e json")

  let escreveu = false
  const r = writeCodexHooksJson(alvo, {
    hooksDir: s.hooksDir, pythonCmd: "python3",
    readImpl: readFileSync, writeImpl: () => { escreveu = true },
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, "hooks_json_ilegivel")
  assert.equal(escreveu, false, "nada pode ser escrito por cima")
  assert.equal(readFileSync(alvo, "utf-8"), "{ isto nao e json")
})

// ── O GStack nunca escreve nos dois lugares ────────────────────────────────

/**
 * Duas fontes de verdade sobre o mesmo hook: a segunda envelhece calada. É por
 * isso que o wiring legado de `config.toml` saiu e não volta.
 */
test("o produto NÃO escreve a mesma integração em config.toml e hooks.json", async () => {
  const codex = readFileSync(path.join(repoRoot, "src/harness/codex.js"), "utf-8")
  assert.equal(/^\s*hooks:\s*\{/m.test(codex), false,
    "`buildGstackConfig` não pode voltar a emitir bloco de hooks")
  assert.match(codex, /writeCodexHooksJson/, "a autoridade é `hooks.json`")

  const { CHAVES_INERTES_ESCRITAS } = await imp("src/harness/codex-hook-contract.js")
  const legadas = CHAVES_INERTES_ESCRITAS.map((c) => c.key)
  assert.deepEqual(legadas, ["on_session_start", "on_stop", "pre_tool_use", "post_tool_use"],
    "as chaves legadas seguem declaradas — para LIMPEZA, nunca para escrita")
})
