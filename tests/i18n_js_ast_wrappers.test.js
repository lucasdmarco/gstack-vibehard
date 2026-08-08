import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Task 3.1c (parte 1) — WRAPPERS TRANSPARENTES DE APRESENTAÇÃO.
 *
 * `monitor.js` envolve quase toda saída em `color(text, code)`, e por isso 16 de
 * seus 24 pontos ficavam `opaque`: não havia o que classificar numa chamada cujo
 * conteúdo o engine não atravessava.
 *
 * Wrapper transparente é aquele que recebe um texto, decora e devolve — o
 * conteúdo atravessa intacto. O reconhecimento é ESTRUTURAL: corpo de um único
 * `return`, expressão composta apenas de parâmetros e literais. Nome de função
 * nunca é evidência; `color` em outro módulo, ou uma que consulte estado, ou uma
 * que componha dois textos, não passa.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(src, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-wrap-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  const canonical = path.join(root, "src", "cli", "index.js")
  writeFileSync(canonical, "export function info(msg) { console.log(msg) }\n")
  for (const [rel, c] of Object.entries(extra)) {
    const p = path.join(root, rel)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, c)
  }
  const alvo = path.join(root, "src", "commands", "x.js")
  mkdirSync(path.dirname(alvo), { recursive: true })
  writeFileSync(alvo, src)
  return { root, alvo, canonical, extras: Object.keys(extra).map((r) => path.join(root, r)) }
}

const analisar = async (f) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.alvo, f.canonical, ...f.extras]))
}

const COLOR = 'function color(text, code) { return code + text + "\\u001b[0m" }\n'

// ── Positivo ────────────────────────────────────────────────────────────────

test("wrapper transparente local deixa o texto ser analisado", async (t) => {
  const f = fixture(`${COLOR}
export function run() { console.log(color("Monitor iniciado.", "\\u001b[36m")) }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].argForm, "text_literal", "o texto atravessa o wrapper intacto")
  assert.equal(pts[0].audience, "public_diagnostic")
})

test("a carga é escolhida pelo CALLSITE, não pela posição declarada", async (t) => {
  const f = fixture(`${COLOR}
export function run() { console.log(color("\\u001b[36m", "Ordem trocada.")) }
`)
  t.after(() => cleanupTmp(f.root))
  // Aqui o texto está no 2º argumento; o 1º é sequência de controle pura.
  assert.equal((await analisar(f))[0].argForm, "text_literal")
})

// ── Controles hostis ────────────────────────────────────────────────────────

test("HOSTIL: `color` de OUTRO módulo não é wrapper deste", async (t) => {
  const f = fixture(`
import { color } from "../util/tema.js"
export function run() { console.log(color("Texto qualquer.", 1)) }
`, { "src/util/tema.js": COLOR })
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].argForm, "opaque",
    "a resolução é por identidade de nó no módulo; homônimo importado não herda a transparência")
  assert.equal((await analisar(f))[0].audience, "unknown")
})

test("HOSTIL: função que consulta ESTADO não é transparente", async (t) => {
  const f = fixture(`
function color(text) { return prefixoGlobal() + text }
function prefixoGlobal() { return "[app] " }
export function run() { console.log(color("Nao atravessa.")) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].argForm, "opaque",
    "há chamada dentro do return: o que sai não é só o que entrou")
})

test("HOSTIL: acesso a propriedade no return derruba a transparência", async (t) => {
  const f = fixture(`
function color(text, cfg) { return cfg.prefixo + text }
export function run() { console.log(color("Nao atravessa.", {})) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].argForm, "opaque", "`cfg.prefixo` pode ser qualquer coisa em runtime")
})

test("HOSTIL: wrapper que COMPÕE dois textos não tem carga única", async (t) => {
  const f = fixture(`
function juntar(a, b) { return a + " " + b }
export function run() { console.log(juntar("Primeira parte.", "Segunda parte.")) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].argForm, "opaque",
    "dois argumentos textuais atravessam; escolher um deles seria arbitrário, e ambos formam UMA mensagem que ninguém inspecionou")
})

test("HOSTIL: corpo com mais de um statement não é wrapper", async (t) => {
  const f = fixture(`
function color(text, code) {
  const enfeitado = code + text
  return enfeitado
}
export function run() { console.log(color("Indireto.", 1)) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].argForm, "opaque",
    "seguir a variável intermediária é análise de fluxo, que esta capacidade não faz — fingir que faz seria o erro")
})

test("HOSTIL: parâmetro que SOMBREIA o wrapper não é o wrapper", async (t) => {
  const f = fixture(`${COLOR}
export function run(color) { console.log(color("Quem chama decide.", 1)) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].argForm, "opaque",
    "mesma máquina de identidade de nó da 3.1a: o parâmetro sombreia a função local")
})

test("HOSTIL: argumento OPACO dentro do wrapper continua opaco", async (t) => {
  const f = fixture(`${COLOR}
export function run(payload) { console.log(color(payload, 1)) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].argForm, "opaque",
    "atravessar o wrapper não cria conteúdo: se o que entrou é desconhecido, o que sai também é")
})

test("HOSTIL: wrapper que IGNORA o parâmetro não passa nada adiante", async (t) => {
  const f = fixture(`
function color(text) { return "constante" }
export function run() { console.log(color("Este texto some.")) }
`)
  t.after(() => cleanupTmp(f.root))
  const { ehWrapperTransparente } = await eng()
  assert.equal((await analisar(f))[0].argForm, "opaque",
    "nenhum parâmetro atravessa; o argumento não é o que chega à saída")
  assert.equal(typeof ehWrapperTransparente, "function")
})

// ── Censo, ainda sem converter ──────────────────────────────────────────────

test("CENSO: wrappers derrubam os `opaque` de monitor.js de 16 para 1", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer(["src/commands/monitor.js", "src/cli/index.js"])
  const pts = analyzeFile("src/commands/monitor.js", a)
  const unk = pts.filter((p) => p.audience === "unknown")
  const opacos = unk.filter((p) => p.argForm === "opaque")

  assert.equal(unk.length, 13, "24 -> 13: os 16 opacos eram chamadas a `color`")
  assert.equal(opacos.length, 1)
  assert.equal(unk.filter((p) => p.argForm === "text").length, 12,
    "o que resta são molduras interpoladas — audiência e provenance são decisões distintas, e esta é a segunda")
})

test("CENSO: nenhum arquivo convertido — provenance segue pendente", async () => {
  const { CONVERTED_FILES } = await import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)
  assert.deepEqual([...CONVERTED_FILES], ["src/cli/index.js"])
})
