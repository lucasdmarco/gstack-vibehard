import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

/**
 * Os SEIS estados de um hook do Codex, e nenhum deles é "ok".
 *
 * O diagnóstico existe para separar coisas que se pareciam: registrado e
 * confiado é diferente de registrado e NÃO confiado — o segundo NÃO RODA —, e os
 * dois são diferentes de registrado apontando para arquivo que não existe. Antes
 * disso, tudo era "instalado".
 *
 * A CONFIANÇA É LIDA, NUNCA ESCRITA. `[hooks.state]` pertence ao Codex e ao
 * usuário; forjar um `trusted_hash` transformaria uma aprovação que ninguém deu
 * em autorização silenciosa.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const HOOKS_DIR = "/home/u/.codex/hooks"
const DECL = { event: "Stop", script: "stop.py", matcher: ".*" }

const CONTEUDO = "print('stop')\n"

/** IO injetado: o diagnóstico é testável sem tocar disco nem exigir instalação. */
const io = (arquivos) => ({
  existe: (p) => p in arquivos,
  ler: (p) => arquivos[p],
})

const registrado = (cmd = `python3 "${HOOKS_DIR}/stop.py"`) => ({
  hooks: { Stop: [{ matcher: ".*", hooks: [{ type: "command", command: cmd }] }] },
})

async function estado(ctx) {
  const { estadoDoHook } = await imp("src/harness/codex-hooks-doctor.js")
  return estadoDoHook(DECL, { hooksDir: HOOKS_DIR, pythonCmd: "python3", ...ctx })
}

test("installed_trusted: registrado, script presente e hash CONFERE", async () => {
  const { hashDoScript } = await imp("src/harness/codex-hooks-doctor.js")
  const r = await estado({
    hooksJson: registrado(),
    io: io({ [`${HOOKS_DIR}/stop.py`]: CONTEUDO }),
    trustState: { "stop.py": hashDoScript(CONTEUDO) },
  })
  assert.equal(r.state, "installed_trusted")
})

/**
 * O estado que mais importa: registrado, presente, e o Codex ainda NÃO confiou.
 * O hook não roda, e chamar isso de "instalado" é a diferença entre integração e
 * aparência de integração.
 */
test("installed_untrusted: sem trust, o hook NÃO roda — e o estado diz isso", async () => {
  const r = await estado({
    hooksJson: registrado(),
    io: io({ [`${HOOKS_DIR}/stop.py`]: CONTEUDO }),
    trustState: {},
  })
  assert.equal(r.state, "installed_untrusted")
})

/**
 * Mudar o script INVALIDA a confiança por construção — e é assim que tem que
 * ser: aprovar um script não pode aprovar as próximas versões dele.
 */
test("stale_hash: o script mudou depois da aprovação", async () => {
  const { hashDoScript } = await imp("src/harness/codex-hooks-doctor.js")
  const r = await estado({
    hooksJson: registrado(),
    io: io({ [`${HOOKS_DIR}/stop.py`]: "print('MUDOU')\n" }),
    trustState: { "stop.py": hashDoScript(CONTEUDO) },
  })
  assert.equal(r.state, "stale_hash")
  assert.notEqual(r.hash, r.trusted, "o relatório mostra os dois hashes")
})

test("missing_script: registrado, mas o arquivo não existe", async () => {
  const r = await estado({ hooksJson: registrado(), io: io({}), trustState: {} })
  assert.equal(r.state, "missing_script")
  assert.match(r.detail, /não existe/)
})

test("missing_script: nem registrado está", async () => {
  const r = await estado({ hooksJson: { hooks: {} }, io: io({}), trustState: {} })
  assert.equal(r.state, "missing_script")
  assert.match(r.detail, /não registrado/)
})

test("duplicate_registration: o mesmo script duas vezes rodaria duas vezes", async () => {
  const doc = registrado()
  doc.hooks.Stop = [...doc.hooks.Stop, ...doc.hooks.Stop]
  const r = await estado({
    hooksJson: doc,
    io: io({ [`${HOOKS_DIR}/stop.py`]: CONTEUDO }),
    trustState: {},
  })
  assert.equal(r.state, "duplicate_registration")
  assert.match(r.detail, /2 registros/)
})

/**
 * O legado vem ANTES de tudo: enquanto `config.toml` carregar wiring de hook, há
 * duas fontes de verdade sobre o mesmo hook, e relatar só a nova esconderia a
 * antiga.
 */
test("legacy_registration: wiring antigo em config.toml domina o relatório", async () => {
  const { hashDoScript } = await imp("src/harness/codex-hooks-doctor.js")
  const r = await estado({
    hooksJson: registrado(),
    legacyConfig: { hooks: { on_stop: ["python x"] } },
    io: io({ [`${HOOKS_DIR}/stop.py`]: CONTEUDO }),
    trustState: { "stop.py": hashDoScript(CONTEUDO) },
  })
  assert.equal(r.state, "legacy_registration",
    "mesmo tudo o mais estando certo, duas fontes de verdade precisam aparecer")
})

/**
 * `[hooks.state]` é o LEDGER DE CONFIANÇA do Codex, e a presença dele NÃO é
 * wiring legado. Confundir os dois faria o doctor reportar legado em toda
 * máquina que já aprovou um hook.
 */
test("`[hooks.state]` sozinho NÃO é legado — é o ledger de confiança", async () => {
  const { temLegado } = await imp("src/harness/codex-hooks-doctor.js")
  assert.equal(temLegado({ hooks: { state: { "stop.py": { enabled: true, trusted_hash: "abc" } } } }), false)
  assert.equal(temLegado({ hooks: { on_stop: ["x"], state: {} } }), true)
  assert.equal(temLegado({}), false)
})

// ── O relatório completo ───────────────────────────────────────────────────

test("`ok` NUNCA é verdadeiro com hook não confiado", async () => {
  const { diagnosticarHooksDoCodex, hashDoScript } = await imp("src/harness/codex-hooks-doctor.js")
  const { GSTACK_CODEX_HOOKS } = await imp("src/harness/codex-hooks-json.js")

  const arquivos = {}
  const hooks = {}
  for (const h of GSTACK_CODEX_HOOKS) {
    arquivos[`${HOOKS_DIR}/${h.script}`] = CONTEUDO
    hooks[h.event] = [{ matcher: h.matcher, hooks: [{ type: "command", command: `python3 "${HOOKS_DIR}/${h.script}"` }] }]
  }
  const ctx = { hooksDir: HOOKS_DIR, pythonCmd: "python3", hooksJson: { hooks }, io: io(arquivos) }

  const semTrust = diagnosticarHooksDoCodex(GSTACK_CODEX_HOOKS, { ...ctx, trustState: {} })
  assert.equal(semTrust.ok, false, "instalado e não confiado não é instalado")
  assert.equal(semTrust.byState.installed_untrusted, GSTACK_CODEX_HOOKS.length)

  const trust = Object.fromEntries(GSTACK_CODEX_HOOKS.map((h) => [h.script, hashDoScript(CONTEUDO)]))
  const comTrust = diagnosticarHooksDoCodex(GSTACK_CODEX_HOOKS, { ...ctx, trustState: trust })
  assert.equal(comTrust.ok, true, "o caminho para `ok` existe — não é inalcançável por construção")
})

// ── O produto não fabrica confiança ────────────────────────────────────────

/**
 * O controle que separa diagnóstico de falsificação: nenhum código do GStack
 * pode ESCREVER `trusted_hash` ou `hooks.state`. Lê-los para relatar é o
 * trabalho; escrevê-los seria conceder a aprovação em nome do usuário.
 */
test("nenhum módulo do produto ESCREVE `trusted_hash` ou `hooks.state`", async () => {
  const { readFileSync, readdirSync } = await import("node:fs")
  const suspeitos = []
  for (const dir of ["src/harness", "src/installer"]) {
    for (const f of readdirSync(path.join(repoRoot, dir)).filter((x) => x.endsWith(".js"))) {
      const src = readFileSync(path.join(repoRoot, dir, f), "utf-8")
      // Escrita seria uma ATRIBUIÇÃO; citar o nome em comentário é documentação.
      const linhas = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      if (linhas.some((l) => /trusted_hash\s*[:=]/.test(l) || /hooks\.state\s*=/.test(l))) {
        suspeitos.push(`${dir}/${f}`)
      }
    }
  }
  assert.deepEqual(suspeitos, [],
    "confiança pertence ao Codex e ao usuário — forjá-la é autorizar em nome deles")
})
