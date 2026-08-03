import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Fatia 1.1 — correcoes do AST engine.
 *
 * A revisao humana achou tres defeitos na Fatia 1, e um deles era um TESTE
 * VACUOUS: o caso de alias so fazia `assert.ok(Array.isArray(p))`, que passa com
 * qualquer coisa. Eu usei aquilo para afirmar suporte a alias que nao existia.
 * Este arquivo prova o comportamento de verdade.
 *
 *  1. **Alias arbitrario**: `info as say` nem chegava a ser extraido, porque o
 *     filtro usava o nome LOCAL contra SINK_NAMES. Agora resolve o simbolo
 *     PRIMEIRO e filtra pelo nome CANONICO (declarado).
 *  2. **Namespace import**: `ns.info()` resolvia o objeto namespace, nunca o
 *     membro.
 *  3. **Debug guard**: aceitava qualquer texto com "DEBUG" e classificava o ramo
 *     `else` como debug.
 *  4. **interactive-prompt**: pegava `select`/`prompt` de QUALQUER modulo.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const eng = () => import(`${pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs"))}?t=${Date.now()}`)

const CANONICAL = `
export function info(msg) { console.log(msg) }
export function warn(msg) { console.log(msg) }
export function select(q, options) { console.log(q) }
`

function fixture(files, canonical = CANONICAL) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-ast11-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "src", "cli", "index.js"), canonical)
  const alvos = []
  for (const [rel, src] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, src)
    alvos.push(abs)
  }
  return { root, alvos, canonical: path.join(root, "src", "cli", "index.js") }
}

const analisar = async (f, alvo) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer([...f.alvos, f.canonical])
  return analyzeFile(alvo ?? f.alvos[0], a)
}

// ── Alias arbitrario ─────────────────────────────────────────────────────────

test("ALIAS ARBITRARIO: `info as say` e extraido e classificado pelo nome CANONICO", async () => {
  const f = fixture({ "src/commands/x.js": `import { info as say } from "../cli/index.js"\nsay("oi")\n` })
  try {
    const p = await analisar(f)
    assert.equal(p.length, 1, "o alias precisa ser EXTRAIDO — antes nem chegava aqui")
    assert.equal(p[0].name, "say", "nome local preservado")
    assert.equal(p[0].canonicalName, "info", "nome DECLARADO e o que decide")
    assert.equal(p[0].audience, "public_diagnostic")
    assert.equal(p[0].rule, "render-via-canonical-helper")
  } finally { cleanupTmp(f.root) }
})

test("ALIAS `info as log`: classificado, nao mais unknown", async () => {
  const f = fixture({ "src/commands/x.js": `import { info as log } from "../cli/index.js"\nlog("oi")\n` })
  try {
    const p = await analisar(f)
    assert.equal(p[0].canonicalName, "info")
    assert.equal(p[0].audience, "public_diagnostic")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: alias de funcao NAO-sink continua fora do inventario", async () => {
  const f = fixture({
    "src/outro/m.js": `export function helper(x) { return x }\n`,
    "src/commands/x.js": `import { helper as info } from "../outro/m.js"\ninfo("oi")\n`,
  })
  try {
    const p = await analisar(f, f.alvos.find((x) => x.endsWith("x.js")))
    assert.equal(p.length, 0, "chamar-se `info` localmente nao torna `helper` um ponto de saida")
  } finally { cleanupTmp(f.root) }
})

// ── Namespace import ─────────────────────────────────────────────────────────

test("NAMESPACE: `import * as cli` resolve o MEMBRO, nao o objeto namespace", async () => {
  const f = fixture({ "src/commands/x.js": `import * as cli from "../cli/index.js"\ncli.info("oi")\n` })
  try {
    const p = await analisar(f)
    assert.equal(p.length, 1)
    assert.equal(p[0].canonicalName, "info", "resolveu o membro")
    assert.ok(p[0].binding.declaredIn.endsWith("src/cli/index.js"), "origem canonica pelo membro")
    assert.equal(p[0].audience, "public_diagnostic")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO (namespace de outro modulo): `outro.info()` NAO e canal canonico", async () => {
  const f = fixture({
    "src/outro/logger.js": `export function info(m) { console.log(m) }\n`,
    "src/commands/x.js": `import * as outro from "../outro/logger.js"\noutro.info("oi")\n`,
  })
  try {
    const p = await analisar(f, f.alvos.find((x) => x.endsWith("x.js")))
    assert.equal(p.length, 1)
    assert.ok(!p[0].binding.declaredIn.endsWith("src/cli/index.js"))
    assert.equal(p[0].audience, "unknown")
  } finally { cleanupTmp(f.root) }
})

// ── Default import ───────────────────────────────────────────────────────────

test("DEFAULT IMPORT: resolve a declaracao real do default", async () => {
  const f = fixture({
    "src/outro/d.js": `export default function info(m) { console.log(m) }\n`,
    "src/commands/x.js": `import info from "../outro/d.js"\ninfo("oi")\n`,
  })
  try {
    const p = await analisar(f, f.alvos.find((x) => x.endsWith("x.js")))
    assert.equal(p.length, 1, "default import e extraido")
    assert.ok(!p[0].binding.declaredIn.endsWith("src/cli/index.js"), "origem NAO canonica")
    assert.equal(p[0].audience, "unknown", "default de outro modulo nao e canal oficial")
  } finally { cleanupTmp(f.root) }
})

// ── Debug guard estrutural ───────────────────────────────────────────────────

test("POSITIVO: `process.env.GSTACK_DEBUG` no ramo THEN classifica internal_debug", async () => {
  const f = fixture({
    "src/commands/x.js": `import { info } from "../cli/index.js"
export function run() { if (process.env.GSTACK_DEBUG) info("d") }
`,
  })
  try {
    const p = await analisar(f)
    assert.equal(p[0].underDebugGuard, true)
    assert.equal(p[0].audience, "internal_debug")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: ramo ELSE do guard NAO e debug — roda com debug DESLIGADO", async () => {
  const f = fixture({
    "src/commands/x.js": `import { info } from "../cli/index.js"
export function run() {
  if (process.env.GSTACK_DEBUG) { info("dentro") } else { info("fora") }
}
`,
  })
  try {
    const p = await analisar(f)
    const dentro = p.find((x) => x.underDebugGuard === true)
    const fora = p.find((x) => x.underDebugGuard === false)
    assert.ok(dentro, "o THEN e reconhecido")
    assert.ok(fora, "o ELSE NAO e debug")
    assert.equal(fora.audience, "public_diagnostic", "o else e caminho normal")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: `options.DEBUG` NAO e ativacao de env — heuristica textual eliminada", async () => {
  const f = fixture({
    "src/commands/x.js": `import { info } from "../cli/index.js"
export function run(options) { if (options.DEBUG) info("nao e env") }
`,
  })
  try {
    const p = await analisar(f)
    assert.equal(p[0].underDebugGuard, false, "so `process.env.<VAR>` conta")
    assert.notEqual(p[0].audience, "internal_debug")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: string contendo 'DEBUG' na condicao nao classifica", async () => {
  const f = fixture({
    "src/commands/x.js": `import { info } from "../cli/index.js"
export function run(mode) { if (mode === "DEBUG") info("texto") }
`,
  })
  try {
    const p = await analisar(f)
    assert.equal(p[0].underDebugGuard, false)
  } finally { cleanupTmp(f.root) }
})

// ── interactive-prompt restrito ao modulo canonico ───────────────────────────

test("POSITIVO: `select` DENTRO do modulo canonico e prompt publico", async () => {
  const f = fixture({}, `export function select(q) { console.log(q) }\n`)
  try {
    const { analyzeFile, createAnalyzer } = await eng()
    const a = createAnalyzer([f.canonical])
    const p = analyzeFile(f.canonical, a)
    assert.equal(p[0].audience, "public_interactive")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: funcao `select` HOMONIMA noutro modulo NAO e prompt", async () => {
  const f = fixture({
    "src/db/query.js": `export function select(tabela) { console.log("SELECT * FROM " + tabela) }\n`,
  })
  try {
    const p = await analisar(f)
    assert.equal(p.length, 1)
    assert.notEqual(p[0].audience, "public_interactive",
      "um `select` de SQL noutro modulo nao e interface de prompt")
    assert.equal(p[0].audience, "unknown")
  } finally { cleanupTmp(f.root) }
})

test("requiresDebugEnv: exige forma estrutural E polaridade positiva necessaria", async () => {
  const { requiresDebugEnv } = await eng()
  const ts = (await import("typescript")).default

  /** Parseia `if (<cond>) {}` e devolve a expressao da condicao. */
  const cond = (texto) => {
    const sf = ts.createSourceFile("t.js", `if (${texto}) {}`, ts.ScriptTarget.Latest, true)
    return sf.statements[0].expression
  }

  const aceitos = [
    "process.env.GSTACK_DEBUG",
    "process.env.DEBUG",
    "process.env.VERBOSE",
    "(process.env.GSTACK_DEBUG)",
    "process.env.GSTACK_DEBUG && outra",       // debug continua NECESSARIO
    "outra && process.env.GSTACK_DEBUG",
  ]
  for (const t of aceitos) assert.equal(requiresDebugEnv(cond(t)), true, `deveria aceitar: ${t}`)

  const recusados = [
    // Polaridade — a Fatia 1.1 aceitava estes dois, e ambos rodam com debug OFF
    "!process.env.GSTACK_DEBUG",
    "process.env.DEBUG || outra",
    "outra || process.env.DEBUG",
    "process.env.DEBUG !== \"1\"",  // comparacao negativa
    "process.env.DEBUG === \"1\"",  // comparacao: nao inferimos semantica do valor
    // Forma — ja recusados desde a 1.1
    "options.DEBUG",                 // propriedade de objeto qualquer
    "cfg.env.DEBUG",                 // `env` que nao vem de `process`
    "process.argv.DEBUG",            // `process`, mas nao `env`
    "process.env.OUTRA",             // env var fora da lista aprovada
    "DEBUG",                         // identificador solto
    "\"DEBUG\"",                     // string com o texto
    "isDebugMode",                   // nome parecido — o caso que o regex aceitava
  ]
  for (const t of recusados) assert.equal(requiresDebugEnv(cond(t)), false, `deveria recusar: ${t}`)
})
