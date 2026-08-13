import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Regra `cli-version-surface` — a MENOR regra que descreve `--version`.
 *
 * `console.log(pkg.version)` no entrypoint publico ficava `unknown` por falta de
 * vocabulario, nao por duvida: `console.log` nao tem sink (as regras de
 * `machine_protocol` vivem todas em SINK_RULES) e `command-human-branch` exige
 * frase, enquanto a forma aqui e `opaque`.
 *
 * A regra tem SEIS portas e cada teste abaixo fecha exatamente uma. O objetivo
 * declarado e o oposto de generalizar: um `console.log(qualquerCoisa)` no mesmo
 * arquivo, fora do branch, DEVE continuar `unknown`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

const PROVA = Object.freeze({
  "src/index.js": { consumer: "cli_version_contract", evidence: "tests/cli_version_contract.test.js" },
})

/**
 * Fixture com MANIFESTO: `bin` e o que torna o arquivo superficie publica, e a
 * regra o le de la — por isso o package.json faz parte do fixture, nao do teste.
 */
function fixture(src, { bin = { tool: "src/index.js" }, alvoRel = "src/index.js" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-versurf-"))
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.2.3", bin }, null, 2))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "src", "cli", "index.js"), "export function info(m) { console.log(m) }\n")
  const alvo = path.join(root, alvoRel)
  mkdirSync(path.dirname(alvo), { recursive: true })
  writeFileSync(alvo, src)
  return { root, alvo }
}

const classificar = async (f, opcoes = {}) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const pts = analyzeFile(f.alvo, createAnalyzer([f.alvo, path.join(f.root, "src", "cli", "index.js")]),
    { repoRoot: f.root, versionProofs: PROVA, ...opcoes })
  return pts
}

/** O corpo REAL de `src/index.js`, reduzido ao que a regra inspeciona. */
const CABECALHO = `
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"))
const args = process.argv.slice(2)
`

// ── POSITIVO ────────────────────────────────────────────────────────────────

test("POSITIVO: a forma real de src/index.js vira `public_diagnostic` por `cli-version-surface`", async (t) => {
  const f = fixture(`${CABECALHO}
if (args[0] === "--version" || args[0] === "-v") {
  console.log(pkg.version)
}
`)
  t.after(() => cleanupTmp(f.root))
  const [p] = await classificar(f)
  assert.equal(p.rule, "cli-version-surface")
  assert.equal(p.audience, "public_diagnostic", "superficie publica: entra na claim English-first")
  assert.equal(p.trigger, "version_surface")
})

test("POSITIVO: `--version` sozinho basta — `-v` e opcional no contrato", async (t) => {
  const f = fixture(`${CABECALHO}
if (args[0] === "--version") { console.log(pkg.version) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].rule, "cli-version-surface")
})

// ── CONTROLES NEGATIVOS — um por porta ──────────────────────────────────────

test("CONTROLE: `console` LOCAL sombreado nao e o console do runtime", async (t) => {
  const f = fixture(`${CABECALHO}
const console = { log: (m) => process.stderr.write(String(m)) }
if (args[0] === "--version") { console.log(pkg.version) }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await classificar(f)).find((x) => x.line > 8 && x.callee === "console.log")
  assert.equal(p.audience, "unknown",
    "`binding.kind` diria `global` para todo console; quem decide e a DECLARACAO")
})

test("CONTROLE: `obj.version` sem binding canonico para o manifesto nao casa", async (t) => {
  const f = fixture(`${CABECALHO}
const outro = { version: "9.9.9" }
if (args[0] === "--version") { console.log(outro.version) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "a propriedade se chamar `version` nao prova que o valor vem do manifesto")
})

test("CONTROLE: sem PROVA publica declarada, o ponto continua unknown", async (t) => {
  const f = fixture(`${CABECALHO}
if (args[0] === "--version") { console.log(pkg.version) }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await classificar(f, { versionProofs: {} })
  assert.equal(pts[0].audience, "unknown", "forma sem contrato executado e intencao, nao prova")
})

test("CONTROLE: a MESMA expressao FORA do branch de versao nao e superficie de versao", async (t) => {
  const f = fixture(`${CABECALHO}
console.log(pkg.version)
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "e o ramo derivado de argv que define a superficie, nao a expressao")
})

test("CONTROLE: no ramo ELSE do branch de versao tambem nao casa", async (t) => {
  const f = fixture(`${CABECALHO}
if (args[0] === "--version") { process.exitCode = 0 } else { console.log(pkg.version) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "no `else` a flag NAO foi passada — mesma disciplina de underMachineGuard")
})

test("CONTROLE: versao em STDERR nao e o contrato", async (t) => {
  const f = fixture(`${CABECALHO}
if (args[0] === "--version") { console.error(pkg.version) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "o contrato publico afere stdout e exige stderr VAZIO")
})

test("CONTROLE: versao CONCATENADA com prosa nao casa — ali ha moldura a traduzir", async (t) => {
  const f = fixture(`${CABECALHO}
if (args[0] === "--version") { console.log(\`gstack versao \${pkg.version}\`) }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await classificar(f))[0]
  assert.notEqual(p.rule, "cli-version-surface",
    "com moldura a pergunta muda: ha texto humano a traduzir, e isso e outra regra")
})

test("CONTROLE: `version` LOCAL homonima nao casa", async (t) => {
  const f = fixture(`${CABECALHO}
const version = "9.9.9"
if (args[0] === "--version") { console.log(version) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "identificador solto nao e `<manifesto>.version`")
})

test("CONTROLE: arquivo FORA do `bin` do manifesto nao e superficie publica", async (t) => {
  const f = fixture(`${CABECALHO}
if (args[0] === "--version") { console.log(pkg.version) }
`, { bin: { tool: "src/outro.js" } })
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "o que torna publico e o manifesto apontar o arquivo, nao o nome dele")
})

test("CONTROLE: branch de argv com operando ESTRANHO derruba a guarda", async (t) => {
  const f = fixture(`${CABECALHO}
const outraFlag = true
if (args[0] === "--version" || outraFlag) { console.log(pkg.version) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "no `then` dessa condicao o ponto pode rodar por outro motivo, que a prova nao cobre")
})

test("CONTROLE: `args` que NAO deriva de process.argv nao e branch de versao", async (t) => {
  const f = fixture(`
import { readFileSync } from "fs"
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))
const args = ["--version"]
if (args[0] === "--version") { console.log(pkg.version) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await classificar(f))[0].audience, "unknown",
    "a origem argv e o que liga o branch a invocacao real do usuario")
})

test("CONTROLE: a regra NAO e generica — outro `console.log` opaco no branch fica unknown", async (t) => {
  const f = fixture(`${CABECALHO}
const config = { a: 1 }
if (args[0] === "--version") { console.log(pkg.version); console.log(config) }
`)
  t.after(() => cleanupTmp(f.root))
  const pts = await classificar(f)
  assert.equal(pts.find((p) => p.argKind === "PropertyAccessExpression").rule, "cli-version-surface")
  assert.equal(pts.find((p) => p.argKind === "Identifier").audience, "unknown",
    "a regra descreve UMA superficie; 'console opaco em entrypoint' seria outra coisa")
})
