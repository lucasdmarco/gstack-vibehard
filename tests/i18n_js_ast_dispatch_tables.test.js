import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * TABELA DE DESPACHO — as duas formas que o grafo nao reconhecia.
 *
 * `arestasDeChamada` ja somava as entradas de `const SUBS = { k: () => f() }`
 * lido por chave dinamica. Duas formas REAIS do repositorio ficavam de fora, e o
 * efeito medido era o mesmo nas duas: o grafo partia no `SUBS[chave]` e todo
 * ponto abaixo do handler saia com `commands: []`, onde a ancora fina e
 * fail-closed.
 *
 *   `Object.freeze({...})`  visual.js congela as TRES tabelas que usa;
 *                           research.js congela a de NotebookLM. O wrapper e uma
 *                           CallExpression, e `isObjectLiteralExpression` dava
 *                           `false`. Doze pontos de visual.js sem comando.
 *
 *   `search: ctxSearch`     context.js:294 referencia o handler DIRETO nas oito
 *                           entradas. `isFunctionLike` reprovava, e como o teste
 *                           e `.every`, a tabela INTEIRA caia — nao so a entrada.
 *
 * O que estes testes protegem nao e "mais alcance": e alcance com a MESMA prova
 * de sempre. A identidade do handler vem do binding da propriedade resolvido ate
 * a declaracao, por identidade de no — nunca do texto do nome, da posicao na
 * tabela ou do arquivo. Cada negativo abaixo fecha uma porta pela qual um alcance
 * NAO provado entraria.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

/**
 * Fixture com a cadeia canonica INTEIRA: comando -> handler -> import -> arquivo.
 *
 * O `DISPATCH` mora em `src/cli/index.js` porque e de la que
 * `entrypointsPorComando` o le — `isCanonicalRenderFile` decide pelo caminho. Sem
 * o import real, o checker nao resolve o handler ate a declaracao do alvo e
 * NENHUM comando e derivado: o fixture precisa da cadeia toda para que o
 * positivo signifique alguma coisa.
 */
function fixture(corpoDoAlvo, {
  dispatch = `{ demo: (a) => demoCommand(a) }`,
  importa = "demoCommand, outroCommand",
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-dispatch-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "commands"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  writeFileSync(path.join(root, "src", "cli", "index.js"), `
import { ${importa} } from "../commands/demo.js"
export function info(m) { console.log(m) }
export function warn(m) { console.log(m) }
const DISPATCH = ${dispatch}
export function run(c, a) { const h = DISPATCH[c]; return h ? h(a) : null }
export { outroCommand }
`)
  const alvo = path.join(root, "src", "commands", "demo.js")
  writeFileSync(alvo, corpoDoAlvo)
  return { root, alvo, cli: path.join(root, "src", "cli", "index.js") }
}

const analisar = async (f, ctx = {}) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.cli, f.alvo]), { repoRoot: f.root, ...ctx })
}

/** Comandos que alcancam a linha do ponto cujo texto contem `marca`. */
const comandosDe = (pts, marca) => {
  const p = pts.find((x) => x.line === marca)
  return p ? p.commands : null
}

// ── POSITIVOS ───────────────────────────────────────────────────────────────

/**
 * A FORMA REAL de visual.js:266-280, reduzida ao que o grafo inspeciona.
 * Tabela congelada, handler arrow que delega, leitura por chave dinamica.
 */
test("POSITIVO: `Object.freeze({...})` lido por chave dinamica alcanca o handler", async (t) => {
  const f = fixture(`
function detectCmd(a) {
  process.stdout.write(JSON.stringify({ ok: true }))
}
const SUBCOMMANDS = Object.freeze({
  detect: (a) => detectCmd(a),
})
export function demoCommand(args = []) {
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(args)
  return null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 3), ["demo"],
    "congelar a tabela nao pode esconder o despacho: em modulo ES, congelar PROVA que as chaves sao as enumeradas")
})

test("POSITIVO: referencia direta (`detect: detectCmd`) alcanca o handler", async (t) => {
  const f = fixture(`
function detectCmd(a) {
  process.stdout.write(JSON.stringify({ ok: true }))
}
const SUBCOMMANDS = { detect: detectCmd }
export function demoCommand(args = []) {
  const handler = SUBCOMMANDS[args[0]]
  if (handler) return handler(args)
  return null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 3), ["demo"],
    "o handler E o valor: nao ha corpo a percorrer, a identidade vem do binding da propriedade")
})

test("POSITIVO: tabela MISTA (arrow + referencia direta) alcanca os dois handlers", async (t) => {
  const f = fixture(`
function aCmd() { process.stdout.write(JSON.stringify({ a: 1 })) }
function bCmd() { process.stdout.write(JSON.stringify({ b: 2 })) }
const SUBS = Object.freeze({ a: (x) => aCmd(x), b: bCmd })
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h(args) : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 2), ["demo"], "entrada arrow")
  assert.deepEqual(comandosDe(pts, 3), ["demo"], "entrada por referencia direta, na MESMA tabela")
})

/**
 * Despacho ANINHADO — `visual.js` tem dois niveis: `SUBCOMMANDS.hooks` cai em
 * `hooksCmd`, que le `HOOKS_ACTIONS[...]`. Se so o primeiro nivel fosse somado,
 * `hooksStatusCmd` continuaria sem comando.
 */
test("POSITIVO: despacho de DOIS niveis (a forma de visual.js hooks) alcanca a folha", async (t) => {
  const f = fixture(`
function hooksStatusCmd() { process.stdout.write(JSON.stringify({ ok: true })) }
const HOOKS_ACTIONS = Object.freeze({ status: (c) => hooksStatusCmd(c) })
function hooksCmd(args) {
  const action = HOOKS_ACTIONS[args[1]]
  return action ? action(args) : null
}
const SUBCOMMANDS = Object.freeze({ hooks: (a) => hooksCmd(a) })
export function demoCommand(args = []) {
  const h = SUBCOMMANDS[args[0]]
  return h ? h(args) : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 2), ["demo"], "a folha do segundo nivel tambem e alcancada")
})

// ── NEGATIVOS: cada um fecha uma porta ──────────────────────────────────────

test("NEGATIVO: arrow DESCONECTADA (nunca em tabela lida) continua inalcancavel", async (t) => {
  const f = fixture(`
const ORFA = Object.freeze({ nunca: () => process.stdout.write(JSON.stringify({ x: 1 })) })
export function demoCommand(args = []) { return args.length }
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 2), [],
    "tabela que ninguem le por chave dinamica nao cria alcance — congelar nao e invocar")
})

test("NEGATIVO: callback arrow passado como VALOR nao vira handler", async (t) => {
  const f = fixture(`
function aplicar(fn) { return fn() }
export function demoCommand(args = []) {
  return aplicar(() => process.stdout.write(JSON.stringify({ x: 1 })))
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 4), [],
    "quem recebeu o callback decide se ele roda; `<anon>` na cadeia derruba o alcance")
})

/**
 * A tabela usa REFERENCIA DIRETA de proposito. Com `go: () => alvo()` o teste
 * nao isolaria nada: o arrow vive lexicalmente dentro de `demoCommand`, e
 * `alvo()` ali dentro ja e chamada estatica simples — a aresta nasceria pela
 * regra que existe desde a 3.1a, com ou sem tabela. Passaria por motivo errado.
 * Sem chamada nenhuma no corpo, a UNICA aresta possivel seria a da tabela.
 */
test("NEGATIVO: tabela LOCAL (dentro da funcao) nao vira despacho canonico", async (t) => {
  const f = fixture(`
function alvo() { process.stdout.write(JSON.stringify({ x: 1 })) }
export function demoCommand(args = []) {
  const LOCAL = Object.freeze({ go: alvo })
  const h = LOCAL[args[0]]
  return h ? h() : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 2), [],
    "so tabela TOP-LEVEL e enumerada: a local nao esta em `sf.statements` e nao foi provada")
})

test("NEGATIVO: chave COMPUTADA derruba a tabela inteira — nao inventa comando", async (t) => {
  const f = fixture(`
const CHAVE = "go"
function alvo() { process.stdout.write(JSON.stringify({ x: 1 })) }
const SUBS = Object.freeze({ [CHAVE]: () => alvo() })
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h() : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 3), [],
    "a chave e dinamica em tempo de AUTORIA: o dominio de chaves nao esta comprovado")
})

test("NEGATIVO: SPREAD na tabela invalida o despacho", async (t) => {
  const f = fixture(`
const EXTRA = { outro: () => null }
function alvo() { process.stdout.write(JSON.stringify({ x: 1 })) }
const SUBS = Object.freeze({ go: () => alvo(), ...EXTRA })
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h() : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 3), [],
    "o spread traz chaves que o literal nao enumera; enumerar mesmo assim afirmaria um dominio falso")
})

test("NEGATIVO: MUTACAO posterior da tabela invalida o despacho", async (t) => {
  const f = fixture(`
function alvo() { process.stdout.write(JSON.stringify({ x: 1 })) }
const SUBS = { go: () => alvo() }
SUBS.extra = () => null
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h() : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 2), [],
    "`const` impede reatribuir o binding, nao mutar a propriedade: o conjunto lido em runtime nao e o enumerado")
})

test("NEGATIVO: `Object` SOMBREADO nao congela nada — a tabela nao e reconhecida", async (t) => {
  const f = fixture(`
const Object = { freeze: (x) => x }
function alvo() { process.stdout.write(JSON.stringify({ x: 1 })) }
const SUBS = Object.freeze({ go: () => alvo() })
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h() : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 3), [],
    "a decisao e pela DECLARACAO (lib .d.ts ou nenhuma), nunca pelo nome `Object`")
})

test("NEGATIVO: HOMONIMO importado na entrada nao casa com a funcao local", async (t) => {
  const f = fixture(`
import { outroCommand as alvo } from "../cli/index.js"
function alvoLocal() { process.stdout.write(JSON.stringify({ x: 1 })) }
const SUBS = Object.freeze({ go: alvo })
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h() : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 3), [],
    "a entrada e forma legitima, mas resolve para OUTRO arquivo: nao ha aresta local a afirmar")
})

test("NEGATIVO: parametro que SOMBREIA a funcao local nao cria aresta", async (t) => {
  const f = fixture(`
function alvo() { process.stdout.write(JSON.stringify({ x: 1 })) }
const SUBS = Object.freeze({ go: (alvo) => alvo() })
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h(() => null) : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 2), [],
    "quem decide o que `alvo` e nesse corpo e o chamador — identidade de no, nao coincidencia de nome")
})

// ── SOBRE-APROXIMACAO CONSERVADORA ──────────────────────────────────────────

test("duas chaves para o MESMO handler preservam os DOIS comandos", async (t) => {
  const f = fixture(`
function compartilhado() { process.stdout.write(JSON.stringify({ x: 1 })) }
export function devCommand() { return compartilhado() }
export function logsCommand() { return compartilhado() }
export function demoCommand() { return null }
export function outroCommand() { return null }
`, {
  dispatch: `{ dev: (a) => devCommand(a), logs: (a) => logsCommand(a) }`,
  importa: "demoCommand, outroCommand, devCommand, logsCommand",
})
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  assert.deepEqual(comandosDe(pts, 2), ["dev", "logs"],
    "handler compartilhado acumula rotas: mais comandos = MAIS prova exigida, nunca menos")
})

test("comando PROVADO nao cobre comando NAO provado no mesmo ponto", async (t) => {
  const f = fixture(`
function compartilhado() { process.stdout.write(JSON.stringify({ x: 1 })) }
export function devCommand() { return compartilhado() }
export function logsCommand() { return compartilhado() }
export function demoCommand() { return null }
export function outroCommand() { return null }
`, {
  dispatch: `{ dev: (a) => devCommand(a), logs: (a) => logsCommand(a) }`,
  importa: "demoCommand, outroCommand, devCommand, logsCommand",
})
  t.after(() => cleanupTmp(f.root))
  const consumers = {
    "src/commands/demo.js": {
      commands: [{ command: "dev", mode: null, consumer: "c", evidence: "e" }],
    },
  }
  const pts = await analisar(f, { consumers })
  const p = pts.find((x) => x.line === 2)
  assert.deepEqual(p.commands, ["dev", "logs"])
  assert.equal(p.audience, "unknown",
    "rodar `logs` executa aquela escrita sem consumidor que a leia: cobertura e UNIVERSAL, nao existencial")
})

test("AUSENCIA de consumidor declarado mantem `unknown` mesmo com comando derivado", async (t) => {
  const f = fixture(`
function alvo() { process.stdout.write(JSON.stringify({ x: 1 })) }
const SUBS = Object.freeze({ go: () => alvo() })
export function demoCommand(args = []) {
  const h = SUBS[args[0]]
  return h ? h() : null
}
export function outroCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  const p = pts.find((x) => x.line === 2)
  assert.deepEqual(p.commands, ["demo"], "o comando foi derivado")
  assert.equal(p.audience, "unknown", "derivar a rota NAO e provar o consumidor: sao dois fatos separados")
})
