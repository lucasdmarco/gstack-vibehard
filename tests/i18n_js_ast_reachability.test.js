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

/**
 * TABELA DE DESPACHO TOP-LEVEL lida por chave dinâmica — a ÚNICA exceção ao
 * `obj[k]()` acima, e ela precisa dos dois lados provados.
 *
 * MOTIVO MEDIDO: é o idioma de roteamento de subcomando de quase todo
 * `src/commands/*.js`. Com o grafo partido nele, TODO ponto de `secrets.js`,
 * `visual.js` e `context.js` fora do corpo imediato do handler saía com
 * `commands: []`, e a âncora fina — fail-closed em lista vazia — não podia
 * cobrir nenhum. A saída sem esta capacidade seria declarar consumidor por
 * ARQUIVO em treze arquivos, ou seja, desligar a checagem de rota exatamente
 * onde ela faz falta.
 *
 * A soma é conservadora NA DIREÇÃO CERTA: como o índice não é estático, somam-se
 * TODAS as entradas, e `coberturaAncorada` exige `commands.every(...)` — mais
 * comandos alcançando o ponto significa mais rotas a provar, nunca menos.
 */
test("DESPACHO: tabela `const` top-level lida por chave dinâmica alcança as entradas", async (t) => {
  const f = fixture(`
function doctor() { console.log("Sou o doctor.") }
function lista() { console.log("Sou o list.") }
const SUBS = { doctor: () => doctor(), list: () => lista() }
export function run(sub) { const h = SUBS[sub]; return h && h() }
`)
  t.after(() => cleanupTmp(f.root))
  const a = await alcance(f)
  assert.equal(a.alcancadas.has("doctor"), true, "a aresta existe de verdade: `run` pode chegar em qualquer entrada")
  assert.equal(a.alcancadas.has("lista"), true, "chave dinâmica ⇒ TODAS as entradas, não a primeira")
})

test("DESPACHO: a soma não vaza entre tabelas — ler A não alcança as entradas de B", async (t) => {
  const f = fixture(`
function daA() { console.log("Sou da A.") }
function daB() { console.log("Sou da B.") }
const A = { x: () => daA() }
const B = { y: () => daB() }
export function run(k) { return A[k]() }
`)
  t.after(() => cleanupTmp(f.root))
  const a = await alcance(f)
  assert.equal(a.alcancadas.has("daA"), true)
  assert.equal(a.alcancadas.has("daB"), false,
    "só a tabela REALMENTE lida soma; senão a capacidade viraria 'tudo alcança tudo'")
})

test("HOSTIL DESPACHO: tabela `let` não cria aresta — pode ser reatribuída", async (t) => {
  const f = fixture(`
function render() { console.log("Talvez eu rode.") }
let SUBS = { r: () => render() }
export function run(k) { return SUBS[k]() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "sem `const` a tabela lida em runtime pode não ser esta")
})

test("HOSTIL DESPACHO: valor NÃO function-like derruba a tabela inteira", async (t) => {
  const f = fixture(`
function render() { console.log("Talvez eu rode.") }
const SUBS = { r: () => render(), versao: 2 }
export function run(k) { return SUBS[k]() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "objeto de configuração não é tabela de despacho; aceitar 'quase' é aceitar qualquer objeto")
})

test("HOSTIL DESPACHO: SPREAD derruba — a lista de entradas deixa de ser enumerável", async (t) => {
  const f = fixture(`
function render() { console.log("Talvez eu rode.") }
const OUTRAS = {}
const SUBS = { ...OUTRAS, r: () => render() }
export function run(k) { return SUBS[k]() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "com spread não se sabe o conjunto de chaves nem de valores")
})

test("HOSTIL DESPACHO: chave COMPUTADA derruba", async (t) => {
  const f = fixture(`
function render() { console.log("Talvez eu rode.") }
const NOME = "r"
const SUBS = { [NOME]: () => render() }
export function run(k) { return SUBS[k]() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "chave já é dinâmica em tempo de AUTORIA")
})

test("HOSTIL DESPACHO: parâmetro que SOMBREIA a tabela não cria aresta", async (t) => {
  const f = fixture(`
function render() { console.log("Talvez eu rode.") }
const SUBS = { r: () => render() }
export function run(SUBS, k) { return SUBS[k]() }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "identidade do nó, não coincidência de nome — quem decide o que `SUBS` é aqui é o chamador")
})

/**
 * ISOLA a capacidade: é a LEITURA DINÂMICA que soma, não a existência da tabela.
 *
 * Sem este controle, os positivos acima seriam satisfeitos por uma implementação
 * que simplesmente marcasse alcançável tudo que aparece em qualquer tabela
 * top-level — e aí `SUBS` sequer precisaria ser lido para "alcançar".
 */
test("HOSTIL DESPACHO: tabela top-level NUNCA lida não alcança nada", async (t) => {
  const f = fixture(`
function render() { console.log("Talvez eu rode.") }
const SUBS = { r: () => render() }
export function run() { console.log("Não leio a tabela.") }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), false,
    "quem soma é o acesso `SUBS[k]`; tabela declarada e não lida não alcança ninguém")
})

/**
 * FRONTEIRA da capacidade, registrada como ela é — não como seria conveniente.
 *
 * Aqui a aresta `run -> render` EXISTE, e já existia antes desta capacidade: a
 * chamada `render()` está lexicalmente dentro do corpo de `run`, e o walk de
 * `arestasDeChamada` sempre percorreu o corpo inteiro, funções aninhadas
 * inclusive. Não é a tabela local que cria o alcance — é o call site.
 *
 * O contraste com "HOSTIL: chamada DINÂMICA não cria aresta" (tabela local com
 * `{ render }`, REFERÊNCIA e não chamada) é exatamente o que separa as duas
 * coisas, e é por isso que aquele teste continua verde.
 */
test("FRONTEIRA: tabela local com CHAMADA no corpo já alcançava — o call site é lexical", async (t) => {
  const f = fixture(`
function render() { console.log("Chamada lexicalmente dentro de run.") }
export function run(k) {
  const SUBS = { r: () => render() }
  return SUBS[k]()
}
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await alcance(f)).alcancadas.has("render"), true,
    "comportamento PRÉ-EXISTENTE do walk de corpo; atribuí-lo à tabela de despacho seria ler a capacidade errado")
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
