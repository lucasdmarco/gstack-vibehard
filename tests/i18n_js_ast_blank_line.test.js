import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Regra `console-blank-line` — a MENOR regra que descreve `console.log()`.
 *
 * `init.js:241` e `install.js:933` escrevem uma linha em branco entre blocos do
 * relatorio humano. Ficavam `unknown` nao por duvida, mas porque o repositorio
 * tem TRES formas de escrever a mesma linha e so duas eram descritas:
 * `logger.info("")` cai em `canonical-receiver-spacing`, `process.stdout.write`
 * de separador cai em `stream-terminal-control`, e `console.log()` sem argumento
 * nao caia em lugar nenhum.
 *
 * A audiencia e a mesma das outras duas (`terminal_control`), pelo mesmo motivo:
 * ausencia de idioma, nao ausencia de decisao. Cada teste abaixo fecha uma porta,
 * e o objetivo declarado e o oposto de generalizar — `console.log(qualquerCoisa)`
 * DEVE continuar `unknown`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(src) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-blank-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "commands"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  writeFileSync(path.join(root, "src", "cli", "index.js"), "export function info(m) { console.log(m) }\n")
  const alvo = path.join(root, "src", "commands", "demo.js")
  writeFileSync(alvo, src)
  return { root, alvo, cli: path.join(root, "src", "cli", "index.js") }
}

const classificar = async (f) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.cli, f.alvo]), { repoRoot: f.root })
}

const naLinha = (pts, l) => pts.find((p) => p.line === l)

// ── POSITIVO ────────────────────────────────────────────────────────────────

test("POSITIVO: `console.log()` sem argumento e `terminal_control`", async (t) => {
  const f = fixture(`
export function demoCommand() {
  console.log()
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 3)
  assert.equal(p.rule, "console-blank-line")
  assert.equal(p.audience, "terminal_control", "uma quebra de linha nao tem idioma")
  assert.equal(p.trigger, "vertical_spacing")
})

// ── NEGATIVOS: uma porta cada ───────────────────────────────────────────────

test("NEGATIVO: `console.log(valor)` continua `unknown` — a regra nao e sobre console solto", async (t) => {
  const f = fixture(`
export function demoCommand(config) {
  console.log(config)
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 3)
  assert.equal(p.audience, "unknown",
    "ha argumento: o que ele imprime e pergunta em aberto, e `unknown` e a resposta correta")
})

test("NEGATIVO: `console.log(undefined)` NAO e linha em branco — ha argumento", async (t) => {
  const f = fixture(`
export function demoCommand() {
  console.log(undefined)
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 3)
  assert.notEqual(p.rule, "console-blank-line",
    "`argKind` distingue AUSENCIA de argumento de argumento cujo valor e undefined")
})

test("NEGATIVO: `console.log()` DENTRO do ramo de maquina nao e benigno", async (t) => {
  const f = fixture(`
export function demoCommand(args = []) {
  const json = args.includes("--json")
  if (json) {
    console.log()
  }
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 5)
  assert.equal(p.audience, "unknown",
    "um \\n solto dentro de --json quebra o documento; classificar como controle benigno esconderia o bug")
})

test("NEGATIVO: `console` SOMBREADO nao e o canal do runtime", async (t) => {
  const f = fixture(`
const console = { log: () => {} }
export function demoCommand() {
  console.log()
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 4)
  assert.notEqual(p.rule, "console-blank-line",
    "a decisao e pela DECLARACAO, nao pelo nome `console`")
})

test("NEGATIVO: `console.error()` sem argumento nao entra — a regra nomeia `log`", async (t) => {
  const f = fixture(`
export function demoCommand() {
  console.error()
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 3)
  assert.notEqual(p.rule, "console-blank-line",
    "outro metodo e outro canal (stderr); estende-la exigiria prova propria, nao analogia")
})
