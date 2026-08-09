import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Task 3.1c (parte 2) — ENTRYPOINTS CANÔNICOS, derivados do `DISPATCH` real.
 *
 * Moldura INTERPOLADA (`argForm: "text"`) só vira canal humano com entrypoint
 * canônico provado. O critério frouxo — "alcançável a partir de um export
 * qualquer" — reintroduziria o falso positivo do SQL: `export function select(t)
 * { console.log("SELECT * FROM " + t) }` é literal + parâmetro, exatamente esta
 * forma, e não é canal do CLI.
 *
 * A autoridade é o objeto `DISPATCH` de `src/cli/index.js`, e SÓ ele. `COMMANDS`
 * e `command-layers.js` descrevem catálogo e camada; nenhum dos dois executa
 * nada. Só o mapa que o CLI consulta para chamar o handler prova que uma função
 * é alcançada por invocação real.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(dispatch, alvoSrc) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-entry-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "commands"), { recursive: true })
  const canonical = path.join(root, "src", "cli", "index.js")
  writeFileSync(canonical, `
import { cmd } from "../commands/x.js"
export function info(msg) { console.log(msg) }
const DISPATCH = {
${dispatch}
}
export default DISPATCH
`)
  const alvo = path.join(root, "src", "commands", "x.js")
  writeFileSync(alvo, alvoSrc)
  return { root, alvo, canonical }
}

const analisar = async (f) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.alvo, f.canonical]))
}

const INTERPOLADO = `
export function cmd(nome) {
  console.log(\`Processando \${nome}...\`)
}
`

// ── Positivo ────────────────────────────────────────────────────────────────

test("moldura interpolada em handler do DISPATCH recebe audiência", async (t) => {
  const f = fixture("  x: (a) => cmd(a),", INTERPOLADO)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f))[0]
  assert.equal(p.argForm, "text", "literal + interpolação")
  assert.equal(p.reachableFromEntrypoint, true)
  assert.equal(p.audience, "public_diagnostic")
})

test("referência direta ao handler (`x: cmd`) também é entrypoint", async (t) => {
  const f = fixture("  x: cmd,", INTERPOLADO)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].reachableFromEntrypoint, true)
})

test("o alcance a partir do entrypoint é TRANSITIVO", async (t) => {
  const f = fixture("  x: (a) => cmd(a),", `
function render(nome) { console.log(\`Item \${nome}\`) }
export function cmd(a) { render(a) }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f))[0]
  assert.equal(p.reachableFromEntrypoint, true, "função interna chamada pelo handler conta")
  assert.equal(p.audience, "public_diagnostic")
})

// ── Controles hostis ────────────────────────────────────────────────────────

test("HOSTIL: export que NÃO está no DISPATCH não classifica interpolado", async (t) => {
  // Este é o caso `select` do módulo de banco, na forma exata que ele tem.
  const f = fixture("  outro: (a) => cmd(a),", `
export function cmd() { return 1 }
export function select(tabela) {
  console.log(\`SELECT * FROM \${tabela}\`)
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.line > 3)
  assert.equal(p.reachableFromExport, true, "é export, e por isso o critério frouxo o aprovaria")
  assert.equal(p.reachableFromEntrypoint, false, "mas não é handler de comando algum")
  assert.equal(p.audience, "unknown", "é exatamente o falso positivo do SQL que o critério estrito impede")
})

test("HOSTIL: chave COMPUTADA no DISPATCH não vira raiz", async (t) => {
  const f = fixture("  [nomeDinamico]: (a) => cmd(a),", INTERPOLADO)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].reachableFromEntrypoint, false,
    "a chave só existe em runtime; a forma não prova qual comando é")
})

test("HOSTIL: handler que NÃO é chamada direta não vira raiz", async (t) => {
  const f = fixture("  x: (a) => { registrar(a); return cmd(a) },", INTERPOLADO)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].reachableFromEntrypoint, false,
    "há mais de uma expressão no corpo; o que o arrow faz além de delegar não foi inspecionado")
})

test("HOSTIL: spread no DISPATCH não vira raiz", async (t) => {
  const f = fixture("  ...outrosComandos,", INTERPOLADO)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].reachableFromEntrypoint, false,
    "o conteúdo do spread não está aqui — presumi-lo seria inventar entrypoints")
})

test("HOSTIL: sem DISPATCH, nada é entrypoint (ausência ≠ permissão)", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-nodisp-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "commands"), { recursive: true })
  const canonical = path.join(root, "src", "cli", "index.js")
  writeFileSync(canonical, "export function info(msg) { console.log(msg) }\n")
  const alvo = path.join(root, "src", "commands", "x.js")
  writeFileSync(alvo, INTERPOLADO)
  const f = { root, alvo, canonical }
  t.after(() => cleanupTmp(root))

  const p = (await analisar(f))[0]
  assert.equal(p.reachableFromEntrypoint, false)
  assert.equal(p.audience, "unknown", "não encontrar o DISPATCH é ausência de prova, nunca permissão")
})

test("HOSTIL: `text_literal` NÃO depende de entrypoint — o critério é por forma", async (t) => {
  const f = fixture("  outro: (a) => cmd(a),", `
export function cmd() { return 1 }
export function avulsa() { console.log("Frase inteiramente literal.") }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.argForm === "text_literal")
  assert.equal(p.reachableFromEntrypoint, false)
  assert.equal(p.audience, "public_diagnostic",
    "literal puro já era aceito com export desde a Task 3; o endurecimento vale para a moldura INTERPOLADA")
})

// ── Provenance segue pendente, e é decisão separada ─────────────────────────

/**
 * Audiência e provenance deixaram de ser a mesma decisão. Um ponto interpolado
 * pode ter canal provado — sabemos QUEM lê — e ainda assim não estar pronto para
 * migração, porque não se sabe o que cada `${…}` traz.
 */
test("interpolado classificado continua com provenance NÃO resolvida", async (t) => {
  const f = fixture("  x: (a) => cmd(a),", INTERPOLADO)
  t.after(() => cleanupTmp(f.root))
  const { argumentProvenance } = await eng()
  const p = (await analisar(f))[0]

  assert.equal(p.audience, "public_diagnostic", "o canal está provado")
  const prov = argumentProvenance(p)
  assert.equal(prov.resolved, false, "mas a origem do dado interpolado, não")
  assert.equal(prov.kind, "interpolated")
  assert.deepEqual(prov.ids, ["nome"])
})

// ── Censo ───────────────────────────────────────────────────────────────────

// O censo definitivo de monitor.js vive no fim deste arquivo: o último ponto
// deixou de ser `opaque` quando `interpolation_only` passou a descrevê-lo.

test("CENSO: create.js melhora para 86 e segue FORA de convertedFiles", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer(["src/cli/create.js", "src/cli/index.js"])
  const unk = analyzeFile("src/cli/create.js", a).filter((p) => p.audience === "unknown")
  assert.equal(unk.length, 86, "os `logger.*` seguem pendentes da 3.1b")

  const { CONVERTED_FILES } = await import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)
  assert.deepEqual([...CONVERTED_FILES], ["src/cli/index.js", "src/commands/monitor.js"],
    "os entrypoints não converteram nada; monitor.js entrou em d9824f6")
})

// ── `interpolation_only`: moldura sem texto (forma, não audiência nova) ─────

/**
 * `console.log(`  ${icon} ${id}`)` tem moldura — os literais existem — mas ela é
 * só espaçamento. O ponto NÃO é ambiguidade: sabe-se o que sai (a composição de
 * dois dados), e sabe-se que não há palavra a traduzir. Um `console.log(payload)`
 * é outra coisa: investigação pendente. Tratá-los igual esconderia um ponto que
 * jamais terá string dentro da fila do que ainda precisa ser investigado.
 */
test("moldura só de espaçamento vira `interpolation_only`, não `opaque`", async (t) => {
  const f = fixture("  x: (a) => cmd(a),", `
export function cmd(icon, id) {
  console.log(\`  \${icon} \${id}\`)
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f))[0]
  assert.equal(p.argForm, "interpolation_only")
  assert.deepEqual(p.templateIds, ["icon", "id"], "os ids são PRESERVADOS — há dado dinâmico a decidir")
})

test("`interpolation_only` recebe audiência pelo MESMO canal canônico", async (t) => {
  const f = fixture("  x: (a) => cmd(a),", `
export function cmd(icon, id) { console.log(\`  \${icon} \${id}\`) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f))[0].audience, "public_diagnostic",
    "não há audiência nova: a pergunta do canal é a mesma, e a resposta exige o mesmo entrypoint")
})

test("HOSTIL: sem entrypoint canônico, `interpolation_only` segue `unknown`", async (t) => {
  const f = fixture("  outro: (a) => cmd(a),", `
export function cmd() { return 1 }
export function avulsa(icon, id) { console.log(\`  \${icon} \${id}\`) }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.argForm === "interpolation_only")
  assert.equal(p.audience, "unknown", "ausência de moldura não afrouxa a exigência de canal")
})

test("HOSTIL: argumento sem moldura alguma continua `opaque`", async (t) => {
  const f = fixture("  x: (a) => cmd(a),", `
export function cmd(payload) { console.log(payload) }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f))[0]
  assert.equal(p.argForm, "opaque", "sem literais não há moldura — é investigação pendente, não ausência de texto")
  assert.equal(p.audience, "unknown")
})

test("provenance distingue AUSÊNCIA DE MOLDURA de ausência de prova", async (t) => {
  const f = fixture("  x: (a) => cmd(a),", `
export function cmd(icon, id) { console.log(\`  \${icon} \${id}\`) }
`)
  t.after(() => cleanupTmp(f.root))
  const { argumentProvenance } = await eng()
  const prov = argumentProvenance((await analisar(f))[0])

  assert.equal(prov.kind, "no_local_frame", "não há frame literal — `translate_literal_frame_…` não se aplica aqui")
  assert.equal(prov.resolved, false,
    "e ainda assim NÃO está resolvido: dado dinâmico exige prova estrutural ou decisão ancorada")
  assert.deepEqual(prov.ids, ["icon", "id"])
})

test("CENSO: monitor.js chega a 27/27 classificados, zero unknown", async () => {
  const { analyzeFile, createAnalyzer, argumentProvenance } = await eng()
  const a = createAnalyzer(["src/commands/monitor.js", "src/cli/index.js"])
  const pts = analyzeFile("src/commands/monitor.js", a)

  assert.equal(pts.length, 27)
  assert.equal(pts.filter((p) => p.audience === "unknown").length, 0, "24 -> 13 -> 1 -> 0")

  // A audiência está completa; a PROVENANCE não — e são decisões distintas.
  const pendentes = pts.filter((p) => !argumentProvenance(p).resolved)
  assert.equal(pendentes.length, 9, "8 molduras interpoladas + 1 sem moldura local")
  assert.equal(pendentes.filter((p) => argumentProvenance(p).kind === "no_local_frame").length, 1)
})
