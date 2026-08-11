import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Task 3.1a — ALCANÇABILIDADE INTRA-MÓDULO, fail-closed.
 *
 * `monitor.js` tem 27 pontos de saída e UM único export: as chamadas vivem em
 * funções internas, e `exportedFromModule` é `false` em todas. A regra
 * `command-human-branch` olhava só a função imediata, então nenhuma delas podia
 * ser considerada superfície de comando.
 *
 * O grafo aqui responde UMA pergunta: esta função é atingível a partir de um
 * export deste módulo, por chamada estática? Toda outra forma de chegar lá —
 * `obj[nome]()`, callback, import de outro módulo, símbolo não resolvido — não
 * cria aresta. A direção do erro é sempre a mesma: menos alcançável, nunca mais.
 *
 * O que esta capacidade NÃO faz, e é o motivo de `monitor.js` continuar não
 * convertido: ela não diz nada sobre o ARGUMENTO. Alcançar a função é condição
 * necessária, não suficiente.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(src, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-reach-"))
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

const alcance = async (f) => {
  const { alcancaveisDeExport, createAnalyzer } = await eng()
  const a = createAnalyzer([f.alvo, f.canonical, ...f.extras])
  return alcancaveisDeExport(a.checker, a.program.getSourceFile(f.alvo))
}

// ── Positivo ────────────────────────────────────────────────────────────────

test("função interna chamada por um export é alcançável", async (t) => {
  const f = fixture(`
function render() { console.log("Concluido.") }
export function run() { render() }
`)
  t.after(() => cleanupTmp(f.root))
  const r = await alcance(f)
  assert.ok(r.alcancadas.has("render"), "chamada estática direta do export precisa alcançar")
  assert.ok(r.raizes.has("run"))
  const pts = await analisar(f)
  assert.equal(pts[0].reachableFromExport, true)
  assert.equal(pts[0].audience, "public_diagnostic")
})

test("alcance é TRANSITIVO — dois saltos contam", async (t) => {
  const f = fixture(`
function fundo() { console.log("Passo final.") }
function meio() { fundo() }
export function run() { meio() }
`)
  t.after(() => cleanupTmp(f.root))
  const r = await alcance(f)
  assert.ok(r.alcancadas.has("fundo"))
  assert.equal((await analisar(f))[0].audience, "public_diagnostic")
})

test("CICLO não trava e não deixa de alcançar", async (t) => {
  const f = fixture(`
function a() { console.log("Em a.") ; b() }
function b() { a() }
export function run() { a() }
`)
  t.after(() => cleanupTmp(f.root))
  const r = await alcance(f)
  assert.ok(r.alcancadas.has("a") && r.alcancadas.has("b"), "a BFS marca visitados; `a -> b -> a` termina")
})

test("`export const f = () => …` também é raiz", async (t) => {
  const f = fixture(`
function render() { console.log("Pronto.") }
export const run = () => { render() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.ok((await alcance(f)).raizes.has("run"), "export via variável é export")
})

// ── Controles hostis: cada um precisa NÃO alcançar ──────────────────────────

test("HOSTIL: helper desconectado permanece inalcançável", async (t) => {
  const f = fixture(`
function orfa() { console.log("Ninguem me chama.") }
export function run() { return 1 }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("orfa"), false)
  assert.equal((await analisar(f))[0].audience, "unknown",
    "sem chamador conhecido, não há prova de que a saída chegue ao usuário")
})

test("HOSTIL: chamada DINÂMICA não cria aresta", async (t) => {
  const f = fixture(`
function render() { console.log("Talvez eu rode.") }
export function run(nome) {
  const tabela = { render }
  tabela[nome]()
}
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "`tabela[nome]()` depende de valor em runtime — presumir o alvo inventaria alcance")
  assert.equal((await analisar(f))[0].audience, "unknown")
})

test("HOSTIL: função passada como CALLBACK não conta", async (t) => {
  const f = fixture(`
function render() { console.log("Sou callback.") }
export function run(lista) { lista.forEach(render) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "referenciar não é chamar: quem recebeu o callback decide se e quando invocá-lo")
})

test("HOSTIL: HOMÔNIMO importado de outro módulo não alcança o local", async (t) => {
  const f = fixture(`
import { render } from "../util/externo.js"
function local() { console.log("Sou a local.") }
export function run() { render() }
`, { "src/util/externo.js": "export function render() { return 1 }\n" })
  t.after(() => cleanupTmp(f.root))
  const r = await alcance(f)
  assert.equal(r.alcancadas.has("local"), false,
    "o `render` chamado é o IMPORTADO; mesmo nome, outra declaração — a aresta é resolvida pelo checker, não pelo texto")
})

test("HOSTIL: parâmetro que SOMBREIA a função local não cria aresta", async (t) => {
  const f = fixture(`
function render() { console.log("A local.") }
export function run(render) { render() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "o parâmetro sombreia a função: quem chama `run` decide o que `render` é")
})

test("HOSTIL: ALIAS local aponta para a declaração real", async (t) => {
  const f = fixture(`
function render() { console.log("Alcancado por alias?") }
const apelido = render
export function run() { apelido() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "`apelido` é uma variável, não a declaração; seguir a atribuição é análise de fluxo, que esta capacidade não faz — e fingir que faz seria o erro")
})

test("HOSTIL: callback anônimo dentro de export não é alcançável", async (t) => {
  const f = fixture(`
export function run(lista) {
  lista.forEach(() => { console.log("Dentro do anonimo.") })
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.equal(pts[0].reachableFromExport, false,
    "`<anon>` não tem nome que case com o grafo; quem passou o callback decide se ele roda")
})

// ── Censo da capacidade, sem converter nada ─────────────────────────────────

/**
 * MEDIÇÃO, não conversão. Estes dois arquivos continuam FORA de
 * `CONVERTED_FILES`: a alcançabilidade é condição necessária e não suficiente, e
 * chamar isto de reconciliação parcial daria ao número uma autoridade que ele
 * não tem.
 *
 * `monitor.js` não se move porque seus 24 `unknown` param na FORMA do argumento
 * (8 `text`, 16 `opaque`), não na alcançabilidade — é a Task 3.1c que trata
 * disso. `create.js` melhora de 1 para 6 pelo mesmo motivo invertido: lá havia
 * pontos com literal puro em função interna alcançável.
 */
test("CENSO: a capacidade melhora `create.js` e não move `monitor.js`", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvos = ["src/commands/monitor.js", "src/cli/create.js"]
  const a = createAnalyzer([...alvos, "src/cli/index.js"])
  const contar = (f) => {
    const pts = analyzeFile(f, a)
    return { total: pts.length, unknown: pts.filter((p) => p.audience === "unknown").length }
  }

  // HISTÓRICO DO NÚMERO, porque ele mudou por uma causa nomeável:
  //   95 -> 90 (create.js)   pela alcançabilidade desta task;
  //   24 -> 13 (monitor.js)  pelos wrappers transparentes da 3.1c, NÃO por esta;
  //   13 ->  1 (monitor.js)  pelos entrypoints canônicos da 3.1c parte 2;
  //    1 ->  0 (monitor.js)  por `interpolation_only`, que descreve o último.
  // A afirmação original da 3.1a segue de pé: alcançar a função é condição
  // necessária e não suficiente, e sozinha ela não moveu `monitor.js`.
  const mon = contar("src/commands/monitor.js")
  assert.equal(mon.total, 27)
  assert.equal(mon.unknown, 0, "0 ao fim da 3.1c; a alcançabilidade por export sozinha não movia nenhum dos 24")

  const cre = contar("src/cli/create.js")
  assert.equal(cre.total, 91)
  assert.equal(cre.unknown, 0,
    "create.js: 95 -> 90 por esta task; o restante caiu nas fatias seguintes até zerar")
})

/**
 * Travava a lista inteira e quebrava a cada arquivo do lote JS — conversões que
 * nada têm a ver com esta capacidade. O invariante que sobrevive: converter é ato
 * DECLARADO, e a declaração precisa bater com o artefato.
 */
test("CENSO: a alcançabilidade não converte arquivo — conversão é declaração explícita", async () => {
  const { CONVERTED_FILES } = await import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)
  const r = JSON.parse(readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry.json"), "utf8"))
  assert.deepEqual([...CONVERTED_FILES].sort(), r.convertedFiles)
})
