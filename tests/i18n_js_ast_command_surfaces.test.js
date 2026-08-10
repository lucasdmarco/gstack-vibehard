import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Task 3 — classificação ESTRUTURAL das superfícies de saída auditadas.
 *
 * Antes desta leva, todo `process.*.write` saía `unknown` por decisão explícita:
 * classificá-lo pela identidade do arquivo faria um payload JSON virar "texto
 * que o usuário lê". As regras acrescentadas aqui decidem pela FORMA da
 * expressão e pela guarda que envolve o ponto — nunca por nome de método, nome
 * de arquivo ou conteúdo de frase.
 *
 * Cada regra é acompanhada de um homônimo hostil: um caso que se parece com ela
 * e precisa continuar `unknown`. Regra sem homônimo não está provada — está
 * apenas passando no caso que o autor imaginou.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(src, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-surf-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  const canonical = path.join(root, "src", "cli", "index.js")
  writeFileSync(canonical, `
export function info(msg) { console.log(msg) }
export function warn(msg) { console.warn(msg) }
`)
  for (const [rel, conteudo] of Object.entries(extra)) {
    const p = path.join(root, rel)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, conteudo)
  }
  const alvo = path.join(root, "src", "commands", "x.js")
  mkdirSync(path.dirname(alvo), { recursive: true })
  writeFileSync(alvo, src)
  return { root, alvo, canonical, extras: Object.keys(extra).map((r) => path.join(root, r)) }
}

const analisar = async (f, ctx = {}) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer([f.alvo, f.canonical, ...f.extras])
  return analyzeFile(f.alvo, a, ctx)
}

/** Consumidor declarado para o arquivo alvo — o que `machine_protocol` exige. */
const comConsumidor = (f) => ({
  consumers: { [String(f.alvo).replace(/\\/g, "/")]: { consumer: "teste", proof: "fixture" } },
})

const audiencias = (pts) => pts.map((p) => p.audience)
const regraDe = (pts, linha) => pts.find((p) => p.line === linha)

// ── Regra 1: serializador estrutural + consumidor declarado ─────────────────

test("write de serializador COM consumidor declarado é `machine_protocol`", async (t) => {
  const f = fixture(`
export function run(data) {
  process.stdout.write(JSON.stringify(data) + "\\n")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f, comConsumidor(f))
  assert.equal(pts.length, 1)
  assert.equal(pts[0].audience, "machine_protocol")
  assert.equal(pts[0].rule, "stream-json-protocol")
  assert.equal(pts[0].argForm, "serializer")
})

test("HOMÔNIMO: serializador SEM consumidor declarado continua `unknown`", async (t) => {
  const f = fixture(`
export function run(data) {
  process.stdout.write(JSON.stringify(data) + "\\n")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f) // sem `consumers`
  assert.equal(pts[0].audience, "unknown",
    "serializador prova a FORMA do payload, não que exista alguém consumindo; `machine_protocol` exige os dois")
  assert.equal(pts[0].argForm, "serializer", "a evidência estrutural continua registrada, só não basta sozinha")
})

test("HOMÔNIMO: texto que PARECE JSON, sem serializador, não é protocolo", async (t) => {
  const f = fixture(`
export function run(nome) {
  process.stdout.write('{"status":"ok","nome":"' + nome + '"}\\n')
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f, comConsumidor(f))
  assert.equal(pts[0].audience, "unknown",
    "concatenação de string com cara de JSON não é serializador — classificar pelo formato do texto seria ler conteúdo")
  assert.notEqual(pts[0].argForm, "serializer")
})

test("HOMÔNIMO: `json` como NOME de variável não cria protocolo", async (t) => {
  const f = fixture(`
export function run() {
  const json = "Arquivo salvo com sucesso"
  process.stdout.write(json)
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f, comConsumidor(f))
  assert.equal(pts[0].audience, "unknown", "o nome da variável não é evidência de nada")
  assert.equal(pts[0].argForm, "opaque")
})

// ── Regra 2: bytes de controle do terminal ──────────────────────────────────

test("write só de sequência CSI é `terminal_control`", async (t) => {
  const f = fixture(`
export function limpar() {
  process.stdout.write("\\u001b[2K\\r")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "terminal_control")
  assert.equal(pts[0].rule, "stream-terminal-control")
})

test("HOMÔNIMO: controle MISTURADO com texto não é controle puro", async (t) => {
  const f = fixture(`
export function limpar() {
  process.stdout.write("\\u001b[2KAborted by user\\n")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "unknown",
    "há texto legível junto do controle: chamar de `terminal_control` esconderia uma frase traduzível atrás do enfeite")
})

// ── Regra 3: guarda POSITIVA de debug ───────────────────────────────────────

test("write sob `if (process.env.DEBUG)` é `internal_debug`", async (t) => {
  const f = fixture(`
export function run(x) {
  if (process.env.DEBUG) {
    process.stdout.write("estado interno: " + x + "\\n")
  }
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "internal_debug")
  assert.equal(pts[0].rule, "stream-debug-guarded")
})

test("HOMÔNIMO: `DEBUG || outra` NÃO é caminho de debug", async (t) => {
  const f = fixture(`
export function run(x) {
  if (process.env.DEBUG || x.verbose) {
    process.stdout.write("mensagem que o usuario le\\n")
  }
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "unknown",
    "com `||`, o ramo THEN roda com DEBUG desligado; chamar de interno afirmaria que está fora do fluxo padrão quando está dentro")
  assert.equal(pts[0].underDebugGuard, false)
})

test("HOMÔNIMO: `!DEBUG` inverte a polaridade", async (t) => {
  const f = fixture(`
export function run() {
  if (!process.env.DEBUG) {
    process.stdout.write("saida normal\\n")
  }
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "unknown")
  assert.equal(pts[0].underDebugGuard, false)
})

// ── Regra 4: ramo humano de comando exportado ───────────────────────────────

test("console.* com texto em função exportada é `public_diagnostic`", async (t) => {
  const f = fixture(`
export function run() {
  console.log("Nada a fazer.")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "public_diagnostic")
  assert.equal(pts[0].rule, "command-human-branch")
})

test("HOMÔNIMO: ramo de máquina e ramo humano no MESMO comando divergem", async (t) => {
  const f = fixture(`
export function run(json, dados) {
  if (json) {
    console.log(JSON.stringify(dados))
  } else {
    console.log("Nenhum resultado encontrado.")
  }
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts.length, 2)
  const [maquina, humano] = pts
  assert.equal(maquina.underMachineGuard, true)
  assert.equal(maquina.audience, "unknown",
    "no ramo `if (json)` a saída não é o canal humano — a audiência é do PONTO, não do arquivo")
  assert.equal(humano.audience, "public_diagnostic")
  assert.equal(humano.underMachineGuard, false, "o `else` de `if (json)` é justamente o caminho humano")
})

/**
 * Lacuna encontrada por mutação: desligar `underMachineGuard` na regra não
 * quebrava teste algum. O caso do ramo misto usava `JSON.stringify` no ramo de
 * máquina, e ali `argForm` já é `serializer` — a regra não dispararia de
 * qualquer modo, então a guarda nunca era o que decidia. Aqui o ramo de máquina
 * emite LITERAL, e só `underMachineGuard` pode segurá-lo.
 */
test("HOMÔNIMO: literal puro DENTRO do ramo `if (json)` não é canal humano", async (t) => {
  const f = fixture(`
export function run(json) {
  if (json) {
    console.log("{}")
  }
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].argForm, "text_literal", "o argumento sozinho satisfaria a regra")
  assert.equal(pts[0].underMachineGuard, true)
  assert.equal(pts[0].audience, "unknown",
    "só a guarda de modo máquina impede a classificação — se ela for removida, este caso vira `public_diagnostic` indevidamente")
})

/**
 * Segunda lacuna da mutação: aceitar literais NÃO-separadores junto do
 * serializador não quebrava nada. `JSON.stringify(x) + " itens"` mistura payload
 * com frase traduzível; chamar isso de protocolo esconderia a frase.
 */
test("HOMÔNIMO: serializador com texto anexado não é payload puro", async (t) => {
  const f = fixture(`
export function run(dados) {
  process.stdout.write("Resultado: " + JSON.stringify(dados) + "\\n")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f, comConsumidor(f))
  assert.notEqual(pts[0].argForm, "serializer",
    "há literal com texto legível junto do payload — só separadores em branco podem acompanhar um serializador")
  assert.equal(pts[0].audience, "unknown")
})

test("HOMÔNIMO: função NÃO exportada não é superfície de comando", async (t) => {
  const f = fixture(`
function auxiliarInalcancavel() {
  console.log("nunca chega ao usuario por esta via")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "unknown",
    "helper não exportado não prova canal de comando; sem chamador conhecido, a saída fica em investigação")
})

/**
 * REGRESSÃO REAL desta leva, não caso hipotético.
 *
 * A primeira versão de `command-human-branch` aceitava `argForm: "text"`, que
 * inclui literal MISTURADO com parte opaca. Com isso, um módulo de banco de
 * dados — `export function select(t) { console.log("SELECT * FROM " + t) }` —
 * passou a ser classificado como canal humano do CLI, quebrando um controle
 * negativo que já existia em `i18n_js_ast_binding.test.js`. A regra foi
 * restringida a `text_literal`; este teste guarda a restrição no lugar onde ela
 * nasceu, para que alargá-la de novo custe uma falha explícita.
 */
test("HOMÔNIMO: literal MISTURADO com parte opaca não é frase para humano", async (t) => {
  const f = fixture(`
export function select(tabela) {
  console.log("SELECT * FROM " + tabela)
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].argForm, "text", "há texto legível, mas também parte opaca")
  assert.equal(pts[0].audience, "unknown",
    "concatenar identificador desconhecido forma qualquer coisa — inclusive uma query SQL, que não é canal do CLI")
})

test("HOMÔNIMO: argumento opaco em função exportada não vira texto público", async (t) => {
  const f = fixture(`
export function run(payload) {
  console.log(payload)
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "unknown", "não se sabe o que é `payload` — classificar seria adivinhar")
  assert.equal(pts[0].argForm, "opaque")
})

// ── Regra 5: propagação sancionada do logger ────────────────────────────────

test("helper do módulo canônico é `public_diagnostic`, mesmo sob alias", async (t) => {
  const f = fixture(`
import { info as say } from "../cli/index.js"
export function run() { say("Concluido.") }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "public_diagnostic")
  assert.equal(pts[0].rule, "render-via-canonical-helper")
  assert.equal(pts[0].canonicalName, "info", "o nome DECLARADO decide, não o apelido local")
})

test("HOMÔNIMO: `info` de OUTRA origem não herda o canal sancionado", async (t) => {
  const f = fixture(`
import { info } from "../util/telemetria.js"
export function run() { info("evento interno") }
`, { "src/util/telemetria.js": "export function info(e) { return e }\n" })
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "unknown",
    "mesmo nome, outra declaração: a origem é conferida pelo checker, nunca pelo nome do método")
  assert.notEqual(pts[0].rule, "render-via-canonical-helper")
})

test("HOMÔNIMO: parâmetro que SOMBREIA o logger não é o logger", async (t) => {
  const f = fixture(`
import { info } from "../cli/index.js"
export function run(info) {
  info("texto vindo de origem desconhecida")
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].audience, "unknown",
    "o parâmetro sombreia o import: quem chama decide o que `info` é, e isso não está neste arquivo")
  assert.equal(pts[0].binding.kind, "parameter")
})

// ── Invariantes da leva ─────────────────────────────────────────────────────

test("a Task 3 não converteu arquivo algum por si", async () => {
  const { CONVERTED_FILES } = await import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)
  // monitor.js entrou em d9824f6, DEPOIS desta task. A afirmação que este teste
  // guarda continua de pé: a Task 3 instalou regras e não converteu nada.
  assert.deepEqual([...CONVERTED_FILES], ["src/cli/index.js", "src/commands/monitor.js"],
    "a Task 3 instala regras; converter arquivos é da Task 4, e misturar as duas impediria atribuir qualquer variação de contagem a uma causa")
})

test("o registro de consumidores só admite entrada com prova apontável", async () => {
  const { MACHINE_PROTOCOL_CONSUMERS } = await eng()
  // Nasceu vazio na Task 3 e ganhou a primeira entrada quando um consumidor REAL
  // foi identificado. O invariante nunca foi "estar vazio" -- é que cada entrada
  // nomeie o teste que consome a saída, e não o formato que ela aparenta ter.
  for (const [arquivo, d] of Object.entries(MACHINE_PROTOCOL_CONSUMERS)) {
    assert.ok(arquivo.startsWith("src/"), `chave deve ser caminho de fonte: ${arquivo}`)
    assert.ok(d.consumer && d.proof, `${arquivo} sem consumidor ou prova`)
    assert.ok(d.proof.includes("tests/"), `${arquivo}: a prova precisa apontar um teste real`)
  }
})

test("toda audiência emitida pelas regras novas é declarada em AUDIENCES", async () => {
  const { SINK_RULES, JS_RULES } = await eng()
  const { AUDIENCES } = await import(pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-audiences.js")).href)
  for (const r of [...SINK_RULES, ...JS_RULES]) {
    assert.ok(AUDIENCES.includes(r.audience), `regra \`${r.id}\` emite \`${r.audience}\`, ausente de AUDIENCES`)
  }
})
