import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { parse as parseToml } from "smol-toml"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * `P0.CODEX-HOOKS` — o contrato REAL do Codex, confrontado com o que o GStack
 * escrevia.
 *
 * O achado registrado dizia "chaves TOML fora do contrato oficial". A
 * confrontação com o binário instalado (v0.145.0) mostrou algo maior: a
 * integração NUNCA TEVE COMO EXECUTAR. Três defeitos independentes, e qualquer
 * um sozinho já bastaria — nomes que não existem, forma errada, e ausência do
 * `trusted_hash` sem o qual o próprio Codex diz que "hooks won't run".
 *
 * O QUE ESTE ARQUIVO GUARDA é que o produto não volte a escrever configuração
 * INERTE no arquivo do usuário, e que a limpeza do que já foi escrito funcione.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── O contrato, com procedência ────────────────────────────────────────────

test("o contrato declara COMO foi obtido, e que não é documentação oficial", async () => {
  const { CODEX_CONTRACT_PROVENANCE } = await imp("src/harness/codex-hook-contract.js")
  assert.equal(CODEX_CONTRACT_PROVENANCE.codexVersion, "0.145.0")
  assert.equal(CODEX_CONTRACT_PROVENANCE.isOfficialDocumentation, false,
    "extrair strings de binário não é ler a documentação — e a diferença precisa viajar junto")
  assert.match(CODEX_CONTRACT_PROVENANCE.method, /strings/i)
  assert.match(CODEX_CONTRACT_PROVENANCE.binary, /codex\.exe$/)
})

/**
 * CADA EVENTO, SEPARADAMENTE. Um teste que só contasse "10 eventos" passaria com
 * a lista errada; aqui cada nome é afirmado por si.
 */
for (const evento of [
  "pre_tool_use", "permission_request", "post_tool_use", "pre_compact", "post_compact",
  "session_start", "session_end", "user_prompt_submit", "subagent_start", "subagent_stop",
]) {
  test(`EVENTO: ${evento} é reconhecido pelo Codex`, async () => {
    const { ehEventoDoCodex, CODEX_EVENTS_WIRE } = await imp("src/harness/codex-hook-contract.js")
    assert.equal(ehEventoDoCodex(evento), true)
    assert.ok(CODEX_EVENTS_WIRE.includes(evento))
  })
}

/**
 * NÃO EXISTE `stop` na forma de payload — o equivalente é `session_end`. Foi
 * exatamente esta confusão que produziu `on_stop`, e depois a recomendação
 * (errada) de renomeá-lo para `Stop`.
 */
test("EVENTO: `stop` não é evento de payload; `session_end` é o equivalente", async () => {
  const { CODEX_EVENTS_WIRE } = await imp("src/harness/codex-hook-contract.js")
  assert.equal(CODEX_EVENTS_WIRE.includes("stop"), false)
  assert.equal(CODEX_EVENTS_WIRE.includes("session_end"), true)
})

test("as QUATRO chaves que o GStack escrevia são inertes, cada uma com seu motivo", async () => {
  const { CHAVES_INERTES_ESCRITAS, ehEventoDoCodex } = await imp("src/harness/codex-hook-contract.js")
  assert.equal(CHAVES_INERTES_ESCRITAS.length, 4)

  const porChave = Object.fromEntries(CHAVES_INERTES_ESCRITAS.map((c) => [c.key, c]))
  // As duas primeiras nem sequer existem no Codex.
  for (const k of ["on_session_start", "on_stop"]) {
    assert.equal(ehEventoDoCodex(k), false, `${k} não pode ser reconhecido`)
    assert.match(porChave[k].problem, /não existe/i)
  }
  // As outras duas existem como nome de PAYLOAD, e ainda assim estavam erradas:
  // nome de configuração é outro, e a forma do valor também.
  assert.match(porChave.pre_tool_use.problem, /PAYLOAD/)
  assert.match(porChave.post_tool_use.problem, /stop\.py/,
    "apontar PostToolUse para o hook de outro evento é o defeito semântico do achado")
})

test("o Codex exige `trusted_hash`: hook não confiado não roda", async () => {
  const { CODEX_HOOK_STATE_FIELDS, CODEX_HANDLER_FIELDS } = await imp("src/harness/codex-hook-contract.js")
  assert.ok(CODEX_HOOK_STATE_FIELDS.includes("trusted_hash"))
  assert.ok(CODEX_HANDLER_FIELDS.includes("command"),
    "handler é objeto com `command` — nunca o array de strings que o GStack escrevia")
})

// ── O produto não escreve mais configuração inerte ─────────────────────────

test("`buildGstackConfig` NÃO produz mais bloco `hooks`", async () => {
  const { GSTACK_MCP_SERVERS } = await imp("src/harness/codex.js")
  const fonte = readFileSync(path.join(repoRoot, "src/harness/codex.js"), "utf-8")
  assert.equal(/^\s*hooks:\s*\{/m.test(fonte), false,
    "escrever configuração inerte é pior que não escrever: dá aparência de integração ativa")
  assert.ok(GSTACK_MCP_SERVERS.length > 0, "o resto do merge continua existindo")
})

test("a lista de limpeza é DERIVADA do contrato, não recopiada", async () => {
  const { GSTACK_HOOK_KEYS } = await imp("src/harness/codex.js")
  const { CHAVES_INERTES_ESCRITAS } = await imp("src/harness/codex-hook-contract.js")
  assert.deepEqual(GSTACK_HOOK_KEYS, CHAVES_INERTES_ESCRITAS.map((c) => c.key),
    "se a lista de chaves inertes mudar, a limpeza precisa acompanhar sozinha")
})

// ── O ciclo completo, em HOME descartável ──────────────────────────────────

const sandbox = (t) => {
  const raiz = mkdtempSync(path.join(tmpdir(), "gstack-codexhooks-"))
  t.after(() => cleanupTmp(raiz))
  return raiz
}

const CONFIG_DO_USUARIO = [
  "# config do usuario",
  'notify = ["meu-notificador"]',
  "",
  "[hooks]",
  'session_start = ["meu-hook-proprio.sh"]',
  'on_stop = ["python /home/u/.codex/hooks/stop.py", "meu-stop-proprio.sh"]',
  "",
].join("\n")

/**
 * PRESERVAR O HOOK DO USUÁRIO é o ponto: a limpeza remove o comando do GStack de
 * dentro do array e mantém o resto. Apagar a chave inteira destruiria trabalho
 * alheio — e `session_start`, que o usuário configurou por conta própria com um
 * nome VÁLIDO, não pode ser tocada.
 */
test("CICLO: a limpeza remove o comando do GStack e PRESERVA o do usuário", async (t) => {
  const raiz = sandbox(t)
  const cfg = path.join(raiz, "config.toml")
  writeFileSync(cfg, CONFIG_DO_USUARIO)

  const { stripGstackFromCodexConfig } = await imp("src/harness/codex.js")
  stripGstackFromCodexConfig(cfg, readFileSync, (f, c) => writeFileSync(f, c))

  const depois = parseToml(readFileSync(cfg, "utf-8"))
  assert.deepEqual(depois.hooks.on_stop, ["meu-stop-proprio.sh"],
    "o comando do usuário fica; só o do GStack sai")
  assert.deepEqual(depois.hooks.session_start, ["meu-hook-proprio.sh"],
    "chave que o GStack nunca escreveu não pode ser tocada")
  assert.deepEqual(depois.notify, ["meu-notificador"], "o resto do config é preservado")
})

test("CICLO: sem comando do usuário, a chave inerte é REMOVIDA por inteiro", async (t) => {
  const raiz = sandbox(t)
  const cfg = path.join(raiz, "config.toml")
  writeFileSync(cfg, ['[hooks]', 'on_stop = ["python /home/u/.codex/hooks/stop.py"]', ""].join("\n"))

  const { stripGstackFromCodexConfig } = await imp("src/harness/codex.js")
  stripGstackFromCodexConfig(cfg, readFileSync, (f, c) => writeFileSync(f, c))

  const depois = parseToml(readFileSync(cfg, "utf-8"))
  assert.equal("hooks" in depois, false, "sem nada do usuário, o bloco inteiro sai")
})

test("CICLO: limpar DUAS vezes é idempotente (reinstalação/upgrade)", async (t) => {
  const raiz = sandbox(t)
  const cfg = path.join(raiz, "config.toml")
  writeFileSync(cfg, CONFIG_DO_USUARIO)

  const { stripGstackFromCodexConfig } = await imp("src/harness/codex.js")
  const escrever = (f, c) => writeFileSync(f, c)
  stripGstackFromCodexConfig(cfg, readFileSync, escrever)
  const primeira = readFileSync(cfg, "utf-8")
  stripGstackFromCodexConfig(cfg, readFileSync, escrever)
  assert.equal(readFileSync(cfg, "utf-8"), primeira,
    "upgrade e reinstalação passam por aqui — a segunda passagem não pode mudar nada")
})

test("CICLO: config ausente ou ilegível não quebra a limpeza", async (t) => {
  const raiz = sandbox(t)
  const { stripGstackFromCodexConfig } = await imp("src/harness/codex.js")
  assert.equal(stripGstackFromCodexConfig(path.join(raiz, "nao-existe.toml")), false)

  const quebrado = path.join(raiz, "quebrado.toml")
  writeFileSync(quebrado, "isto = nao [e toml valido")
  assert.equal(stripGstackFromCodexConfig(quebrado, readFileSync, () => {}), false,
    "config ilegível do usuário não pode ser sobrescrita às cegas")
  assert.ok(existsSync(quebrado), "e nem apagada")
})
