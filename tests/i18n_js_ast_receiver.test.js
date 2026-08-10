import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Task 3.1b — PROVENANCE DO RECEPTOR, domínio abstrato fail-closed.
 *
 * `create.js` tem 78 pontos na forma `logger.warn(...)`, e `logger` é SEMPRE
 * parâmetro: quem decide o que ele é são os chamadores. O checker resolve o
 * membro (`warn`), não o objeto, e por isso todos ficavam `unknown`.
 *
 * O domínio tem três estados e `unresolved` ABSORVE: um único callsite dinâmico,
 * externo ou irresolvível derruba a análise inteira, porque basta um caminho não
 * inspecionado para a conclusão ser falsa. Origens diferentes viram `conflict` —
 * não "a mais comum", que seria escolher por conveniência.
 *
 * O que nunca basta: o nome `logger`, o método ser `warn`/`info`/`error`, ou o
 * argumento ser literal. São os sinais que parecem prova e não são.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(src, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-recv-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  const canonical = path.join(root, "src", "cli", "index.js")
  writeFileSync(canonical, `
export function info(msg) { console.log(msg) }
export function warn(msg) { console.warn(msg) }
export const cli = { info, warn }
`)
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

/** Resolve o receptor de `param` na função `fn` do arquivo alvo. */
const receptor = async (f, fn, param) => {
  const { createAnalyzer, resolverReceptor, declaracoesDeFuncaoPublica } = await eng()
  const a = createAnalyzer([f.alvo, f.canonical, ...f.extras])
  const sf = a.program.getSourceFile(f.alvo)
  return resolverReceptor(fn, param, { sf, checker: a.checker, decls: declaracoesDeFuncaoPublica(sf) })
}

// ── Positivo ────────────────────────────────────────────────────────────────

test("todos os callsites convergindo para a MESMA origem canônica resolvem", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
function emitir(logger) { logger.warn("Aviso.") }
function a() { emitir(cli) }
function b() { emitir(cli) }
`)
  t.after(() => cleanupTmp(f.root))
  const r = await receptor(f, "emitir", "logger")
  assert.equal(r.state, "canonical")
  assert.match(r.origin, /cli\/index\.js$/)
})

test("REPASSE de parâmetro sobe um nível e ainda resolve", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
function fundo(logger) { logger.warn("Aviso.") }
function meio(logger) { fundo(logger) }
function topo() { meio(cli) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "fundo", "logger")).state, "canonical",
    "a pergunta sobe pela cadeia até um argumento com origem provada")
})

// ── Controles hostis: cada um precisa NÃO resolver ──────────────────────────

test("HOSTIL: ORIGENS MISTAS viram conflict, não a mais comum", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
import { telemetria } from "../util/tel.js"
function emitir(logger) { logger.warn("Aviso.") }
function a() { emitir(cli) }
function b() { emitir(cli) }
function c() { emitir(telemetria) }
`, { "src/util/tel.js": "export const telemetria = { warn(m) { return m } }\n" })
  t.after(() => cleanupTmp(f.root))
  const r = await receptor(f, "emitir", "logger")
  assert.notEqual(r.state, "canonical", "duas em três não é convergência")
  assert.ok(["conflict", "unresolved"].includes(r.state))
})

test("HOSTIL: função SEM callsite não tem o que provar", async (t) => {
  const f = fixture(`
function emitir(logger) { logger.warn("Aviso.") }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved",
    "sem chamador, nenhuma origem foi observada — ausência não é permissão")
})

test("HOSTIL: receptor de IMPORT EXTERNO não é canônico", async (t) => {
  const f = fixture(`
import { logger as externo } from "../util/tel.js"
function emitir(logger) { logger.warn("Aviso.") }
function a() { emitir(externo) }
`, { "src/util/tel.js": "export const logger = { warn(m) { return m } }\n" })
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved",
    "origem fora do módulo canônico não tem contrato de audiência comprovado")
})

test("HOSTIL: chamada DINÂMICA não contribui com origem", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
function emitir(logger) { logger.warn("Aviso.") }
function a(tabela, nome) { tabela[nome](cli) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved",
    "`tabela[nome]()` não é callsite resolvido de `emitir`")
})

test("HOSTIL: função usada como CALLBACK pode ser chamada por terceiros", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
function emitir(logger) { logger.warn("Aviso.") }
function a(lista) { lista.forEach(emitir) }
function b() { emitir(cli) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved",
    "quem recebeu o callback passa o argumento que quiser — o callsite visível não é o único")
})

test("HOSTIL: função EXPORTADA aceita chamadores de fora do módulo", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
export function emitir(logger) { logger.warn("Aviso.") }
function a() { emitir(cli) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved",
    "os callsites deste arquivo não esgotam os chamadores de uma função exportada")
})

test("HOSTIL: CICLO termina e não inventa origem", async (t) => {
  const f = fixture(`
function a(logger) { b(logger) }
function b(logger) { a(logger); logger.warn("Aviso.") }
`)
  t.after(() => cleanupTmp(f.root))
  const r = await receptor(f, "b", "logger")
  assert.ok(["unresolved", "conflict"].includes(r.state), "o laço não pode produzir `canonical` do nada")
})

test("HOSTIL: REST/destructuring torna a posição instável", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
function emitir(prefixo, ...resto) { resto[0].warn("Aviso.") }
function a() { emitir("p", cli) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "resto")).state, "unresolved")
})

test("HOSTIL: PARÂMETRO SOMBREANDO import canônico não é o import", async (t) => {
  const f = fixture(`
import { cli } from "../cli/index.js"
function emitir(logger) { logger.warn("Aviso.") }
function a(cli) { emitir(cli) }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved",
    "o `cli` passado é o parâmetro de `a`, e quem chama `a` não foi inspecionado")
})

test("HOSTIL: receptor HOMÔNIMO montado localmente não é canônico", async (t) => {
  const f = fixture(`
function emitir(logger) { logger.warn("Aviso.") }
function a() {
  const cli = { warn(m) { return m } }
  emitir(cli)
}
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved",
    "objeto literal com os mesmos métodos não herda o contrato do módulo canônico")
})

// ── O domínio em si ─────────────────────────────────────────────────────────

test("`unresolved` ABSORVE e origens diferentes viram `conflict`", async () => {
  const { joinReceptor, RECEPTOR_UNRESOLVED, RECEPTOR_CONFLICT, receptorCanonical, LIMITE_FIXPOINT } = await eng()
  const a = receptorCanonical("src/cli/index.js")
  assert.equal(joinReceptor(a, RECEPTOR_UNRESOLVED).state, "unresolved", "um caminho não provado derruba o conjunto")
  assert.equal(joinReceptor(a, receptorCanonical("outro.js")).state, "conflict")
  assert.equal(joinReceptor(a, a).state, "canonical")
  assert.equal(joinReceptor(RECEPTOR_CONFLICT, RECEPTOR_UNRESOLVED).state, "unresolved")
  assert.equal(joinReceptor(null, a), a, "neutro do join — usado para fechar ciclos sem inventar origem")
  assert.ok(Number.isInteger(LIMITE_FIXPOINT) && LIMITE_FIXPOINT > 0, "o limite é determinístico")
})

test("nome, método e literalidade NÃO são evidência", async (t) => {
  // Tudo aqui "parece" o canal oficial: variável `logger`, método `warn`,
  // argumento literal. Nada disso prova origem.
  const f = fixture(`
function emitir(logger) { logger.warn("Mensagem literal.") }
function a() {
  const logger = { warn(m) { return m } }
  emitir(logger)
}
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await receptor(f, "emitir", "logger")).state, "unresolved")
})
