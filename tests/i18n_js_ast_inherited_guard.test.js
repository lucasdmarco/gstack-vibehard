import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * GUARDA DE MAQUINA HERDADA.
 *
 * `underMachineGuard` para na fronteira da funcao, e com razao: uma condicao
 * fora dela nao controla o no. So que a forma mais comum de emissor de payload
 * no repositorio e o helper de uma linha, e nele NAO ha guarda nenhuma
 * envolvendo a escrita:
 *
 *   const ctxJson = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")
 *
 * Quem esta sob `if (json)` sao as cinco chamadas de `ctxJson` em `context.js`,
 * e uma delas so indiretamente. O ponto nunca roda no modo humano — e mesmo
 * assim ficava com modo `null`, sem que nenhuma declaracao de consumidor
 * pudesse cobri-lo sem mentir sobre qual ramo ela prova.
 *
 * UNIVERSAL, nao existencial: TODO chamador precisa estar sob guarda. E quando
 * os chamadores nao sao exaustivos — funcao usada como valor, zero callsites,
 * funcao anonima — a prova fecha em `false`. Vacuidade nao e prova.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-herdada-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  const alvo = path.join(root, "src", "alvo.js")
  writeFileSync(alvo, corpo)
  return { root, alvo }
}

/** O unico ponto de escrita em stream do fixture. */
const oPonto = async (corpo, t) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture(corpo)
  t.after(() => cleanupTmp(f.root))
  const s = analyzeFile(f.alvo, createAnalyzer([f.alvo]), { repoRoot: f.root }).filter((p) => p.sink !== null)
  assert.equal(s.length, 1, `o fixture precisa ter exatamente um write em stream (tem ${s.length})`)
  return s[0]
}

// ── POSITIVOS ───────────────────────────────────────────────────────────────

test("POSITIVO: helper com TODOS os chamadores sob `if (json)` herda a guarda", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function a(json, x) { if (json) emitir(x) }
export function b(json, y) { if (json) emitir(y) }
`, t)
  assert.equal(p.underMachineGuard, false, "nenhuma guarda envolve a escrita")
  assert.equal(p.underInheritedMachineGuard, true)
})

/**
 * O SALTO INDIRETO, que e o caso real: em `context.js`, `ctxJson` e chamado por
 * `explainJson`, que nao tem guarda propria — quem tem e quem chama
 * `explainJson`. Sem recursao, este caminho reprovaria e derrubaria a
 * universalidade por um motivo que nao e o certo.
 */
test("POSITIVO: a heranca atravessa um helper intermediario", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
function intermediario(x) { emitir({ x }) }
export function a(json, x) { if (json) intermediario(x) }
`, t)
  assert.equal(p.underInheritedMachineGuard, true)
})

// ── NEGATIVOS: universalidade e exaustividade ──────────────────────────────

test("NEGATIVO: UM chamador fora da guarda derruba a heranca", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function a(json, x) { if (json) emitir(x) }
export function b(y) { emitir(y) }
`, t)
  assert.equal(p.underInheritedMachineGuard, false,
    "um caminho no modo humano e suficiente para a heranca ser mentira")
})

test("NEGATIVO: chamador no ramo `else` da guarda nao conta", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function a(json, x) { if (json) { return null } else { emitir(x) } }
`, t)
  assert.equal(p.underInheritedMachineGuard, false, "no `else` de `if (json)` estamos no caminho humano")
})

/**
 * ZERO CHAMADORES — e o helper precisa ser LOCAL para o caso chegar ate aqui.
 *
 * A primeira versao usava `export const emitir`, e a porta de export recusava
 * antes: o teste passava sem nunca exercitar a vacuidade, e um mutante que
 * aceitasse lista vazia sobrevivia. `[].every(...)` e `true`, entao sem a porta
 * um helper morto seria dado como "sempre sob guarda".
 */
test("NEGATIVO: ZERO chamadores nao prova nada — vacuidade nao e prova", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function a() { return 1 }
`, t)
  assert.equal(p.underInheritedMachineGuard, false)
})

/**
 * FUNCAO USADA COMO VALOR — a porta que impede a prova de ser otimista.
 *
 * Passada como callback, quem recebeu a referencia a chama de onde quiser, e os
 * callsites visiveis deixam de esgotar os chamadores. Mesmo problema que
 * `ehUsadaComoValor` ja resolvia em `resolverReceptor`.
 */
test("NEGATIVO: helper passado como VALOR nao tem chamadores exaustivos", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function a(json, x) { if (json) emitir(x) }
export function registrar(lista) { return lista.map(emitir) }
`, t)
  assert.equal(p.underInheritedMachineGuard, false,
    "quem recebeu a referencia chama de onde quiser")
})

test("NEGATIVO: helper EXPORTADO tambem escapa dos callsites visiveis", async (t) => {
  const p = await oPonto(`
export const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function a(json, x) { if (json) emitir(x) }
`, t)
  assert.equal(p.underInheritedMachineGuard, false, "outro modulo pode chamar sem guarda alguma")
})

test("NEGATIVO: funcao anonima nao tem callsite pesquisavel", async (t) => {
  const p = await oPonto(`
export function a(json, lista) {
  if (json) lista.forEach(function (x) { process.stdout.write(JSON.stringify(x) + "\\n") })
}
`, t)
  assert.equal(p.underInheritedMachineGuard, false)
})

test("NEGATIVO: recursao termina e nao afirma nada", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
function ciclo(x) { if (x) { ciclo(x - 1) } else { emitir(x) } }
export function a(json, x) { if (json) ciclo(x) }
`, t)
  assert.equal(typeof p.underInheritedMachineGuard, "boolean", "a analise precisa TERMINAR")
})

// ── Separacao dos dois fatos, e o unico consumidor ─────────────────────────

/**
 * OS DOIS FATOS SAO SEPARADOS DE PROPOSITO. A guarda direta descreve o NO; a
 * herdada descreve os CHAMADORES. Fundi-las mudaria `ehFraseHumana` e
 * `console-blank-line` em arquivos ja reconciliados — decisao de quem for
 * reconcilia-los, nao efeito colateral desta fatia.
 */
test("os dois campos nao se fundem: a guarda direta continua descrevendo o no", async (t) => {
  const p = await oPonto(`
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function a(json, x) { if (json) emitir(x) }
`, t)
  assert.equal(p.underMachineGuard, false)
  assert.equal(p.underInheritedMachineGuard, true)
})

/**
 * O UNICO CONSUMIDOR DA HERANCA, exercitado ponta a ponta.
 *
 * A ancora fina e (arquivo, comando, modo). Sem a heranca, `modoDoPonto` devolve
 * `null` para o helper e NENHUMA declaracao de `--json` o cobre — o ponto fica
 * `unknown` por um motivo que nao e duvida sobre ele, e sim sobre onde a guarda
 * mora. A cadeia canonica (DISPATCH -> handler -> arquivo alvo) precisa ser real
 * aqui, senao `commands` sai vazio e a ancora nao casa por outro motivo.
 */
function fixtureComDispatch(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-herdada-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "commands"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  writeFileSync(path.join(root, "src", "cli", "index.js"), `
import { demoCommand } from "../commands/demo.js"
export function info(m) { console.log(m) }
const DISPATCH = { demo: (a) => demoCommand(a) }
export function run(c, a) { const h = DISPATCH[c]; return h ? h(a) : null }
`)
  const alvo = path.join(root, "src", "commands", "demo.js")
  writeFileSync(alvo, corpo)
  return { root, alvo, cli: path.join(root, "src", "cli", "index.js") }
}

const CORPO_DEMO = `
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
export function demoCommand(args) {
  const json = args.includes("--json")
  if (json) emitir({ ok: true })
}
`

const pontoDoDemo = async (f, consumers) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const pts = analyzeFile(f.alvo, createAnalyzer([f.cli, f.alvo]), { repoRoot: f.root, consumers })
  return pts.find((x) => x.sink !== null)
}

test("a heranca escolhe o MODO da ancora de consumidor", async (t) => {
  const { MODO_JSON } = await eng()
  const f = fixtureComDispatch(CORPO_DEMO)
  t.after(() => cleanupTmp(f.root))

  const p = await pontoDoDemo(f, {
    "src/commands/demo.js": {
      commands: [{ command: "demo", mode: MODO_JSON, consumer: "teste", evidence: "fixture" }],
    },
  })
  assert.equal(p.underInheritedMachineGuard, true)
  assert.deepEqual(p.commands, ["demo"], "a cadeia canonica precisa ser real, senao a ancora falha por outro motivo")
  assert.equal(p.audience, "machine_protocol",
    "so com o modo `--json` a declaracao ancorada cobre o ponto")
})

test("NEGATIVO: declaracao para o modo HUMANO nao cobre o ponto herdado", async (t) => {
  const f = fixtureComDispatch(CORPO_DEMO)
  t.after(() => cleanupTmp(f.root))

  const p = await pontoDoDemo(f, {
    "src/commands/demo.js": {
      commands: [{ command: "demo", mode: null, consumer: "teste", evidence: "fixture" }],
    },
  })
  assert.equal(p.audience, "unknown", "o ponto serve `--json`; prova do ramo humano nao fala sobre ele")
})

// ── Ancorado no repositorio real ───────────────────────────────────────────

test("REPO: `context.js:50` (`ctxJson`) herda, e e o UNICO ponto do arquivo que herda", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, "src", "commands", "context.js")
  const pts = analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot })

  const ctxJson = pts.find((p) => p.line === 50)
  assert.ok(ctxJson, "se o helper mudou de linha, a medicao mudou")
  assert.equal(ctxJson.argForm, "serializer")
  assert.equal(ctxJson.underMachineGuard, false, "nenhuma guarda envolve a escrita do helper")
  assert.equal(ctxJson.underInheritedMachineGuard, true, "as cinco chamadas dele estao sob `if (json)`")

  assert.deepEqual(pts.filter((p) => p.underInheritedMachineGuard).map((p) => p.line), [50],
    "a heranca precisa ser estreita — um helper, nao o arquivo")
})

/**
 * A prova de que a heranca nao vazou para o resto do lote: o registry dos onze
 * arquivos ja convertidos e byte-identico ao de antes desta capacidade.
 */
test("REPO: nenhum arquivo ja convertido muda de classificacao", async () => {
  const { buildRegistry, serializar, CONVERTED_FILES } = await import(
    pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href
  )
  const { readFileSync } = await import("node:fs")
  const emDisco = readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry.json"), "utf-8")
  const gerado = serializar(buildRegistry(CONVERTED_FILES, { root: repoRoot }))
  assert.equal(gerado.replace(/\r\n/g, "\n"), emDisco.replace(/\r\n/g, "\n"),
    "a capacidade nova nao pode mexer no que ja estava reconciliado")
})
