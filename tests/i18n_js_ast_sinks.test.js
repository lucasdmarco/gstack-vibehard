import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Fatia 1.2 — dois gaps que a Fatia 1.1 deixou.
 *
 *  1. **Polaridade do debug guard.** A 1.1 so perguntava se a condicao MENCIONA
 *     `process.env.DEBUG`. Mencionar nao basta: em `!DEBUG` e `DEBUG || outra`
 *     o ramo THEN roda com debug DESLIGADO. Classificar como `internal_debug`
 *     afirmaria que a saida esta fora do fluxo padrao quando esta dentro dele —
 *     a mesma inversao ja corrigida no `else`, com outra roupa.
 *
 *  2. **Sinks de stream sumiam.** `process.stdout.write` / `process.stderr.write`
 *     nao eram extraidos: `write` nao esta em SINK_NAMES e `process.stdout` nao e
 *     identificador simples. Sao mais de cem ocorrencias distribuidas por dezenas
 *     de arquivos. Se o registry
 *     fosse definido assim, cada arquivo migrado PERDERIA seus sinks.
 *
 * Extrair e obrigatorio; classificar sem evidencia, nao. Por isso a audiencia
 * fica `unknown` — visivel e pendente, nunca ausente.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const eng = () => import(`${pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs"))}?t=${Date.now()}`)

function fixture(src) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-sink-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "src", "cli", "index.js"), `
export function info(msg) { console.log(msg) }
`)
  const abs = path.join(root, "src", "commands", "x.js")
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, src)
  return { root, alvo: abs, canonical: path.join(root, "src", "cli", "index.js") }
}

const analisar = async (f, alvo) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer([f.alvo, f.canonical])
  return analyzeFile(alvo ?? f.alvo, a)
}

// ── Polaridade do debug guard ────────────────────────────────────────────────

test("NEGATIVO: `!process.env.GSTACK_DEBUG` — o THEN roda com debug DESLIGADO", async () => {
  const f = fixture(`import { info } from "../cli/index.js"
export function run() { if (!process.env.GSTACK_DEBUG) info("roda sem debug") }
`)
  try {
    const p = await analisar(f)
    assert.equal(p[0].underDebugGuard, false, "negacao inverte a guarda")
    assert.equal(p[0].audience, "public_diagnostic", "e saida normal, nao interna")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: `process.env.DEBUG || outra` — debug nao e NECESSARIO", async () => {
  const f = fixture(`import { info } from "../cli/index.js"
export function run(outra) { if (process.env.DEBUG || outra) info("roda por outra") }
`)
  try {
    const p = await analisar(f)
    assert.equal(p[0].underDebugGuard, false,
      "com `outra` verdadeira o THEN executa sem debug algum")
    assert.equal(p[0].audience, "public_diagnostic")
  } finally { cleanupTmp(f.root) }
})

test("POSITIVO: `process.env.GSTACK_DEBUG && outra` — debug segue necessario", async () => {
  const f = fixture(`import { info } from "../cli/index.js"
export function run(outra) { if (process.env.GSTACK_DEBUG && outra) info("so com debug") }
`)
  try {
    const p = await analisar(f)
    assert.equal(p[0].underDebugGuard, true, "`&&` preserva a necessidade do debug")
    assert.equal(p[0].audience, "internal_debug")
  } finally { cleanupTmp(f.root) }
})

test("POSITIVO: guarda simples continua funcionando apos a mudanca de polaridade", async () => {
  const f = fixture(`import { info } from "../cli/index.js"
export function run() { if (process.env.GSTACK_DEBUG) info("d") }
`)
  try {
    const p = await analisar(f)
    assert.equal(p[0].audience, "internal_debug")
  } finally { cleanupTmp(f.root) }
})

// ── Sinks de stream ──────────────────────────────────────────────────────────

test("process.stdout.write e EXTRAIDO com calleePath e sink", async () => {
  const f = fixture(`export function run() { process.stdout.write("linha\\n") }\n`)
  try {
    const p = await analisar(f)
    assert.equal(p.length, 1, "antes da 1.2 este ponto simplesmente nao existia")
    assert.equal(p[0].calleePath, "process.stdout.write")
    assert.equal(p[0].sink, "stdout")
  } finally { cleanupTmp(f.root) }
})

test("process.stderr.write e EXTRAIDO e distinguido de stdout", async () => {
  const f = fixture(`export function run() { process.stderr.write("erro\\n") }\n`)
  try {
    const p = await analisar(f)
    assert.equal(p[0].calleePath, "process.stderr.write")
    assert.equal(p[0].sink, "stderr")
  } finally { cleanupTmp(f.root) }
})

test("sinks de stream NAO sao classificados sem evidencia", async () => {
  const f = fixture(`export function run() { process.stdout.write("x") }\n`)
  try {
    const p = await analisar(f)
    assert.equal(p[0].audience, "unknown", "extrair sim, classificar nao")
    assert.equal(p[0].rule, null, "nenhuma regra pode reivindicar um stream write")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: nem a identidade do modulo de render classifica um stream write", async () => {
  // `render-module-literal-output` daria `public_diagnostic` a QUALQUER saida
  // global no modulo canonico. Um `write` de payload JSON viraria "texto que o
  // usuario le" so por estar no arquivo certo.
  const f = fixture("")
  try {
    writeFileSync(f.canonical, `export function emit(j) { process.stdout.write(JSON.stringify(j)) }\n`)
    const { analyzeFile, createAnalyzer } = await eng()
    const a = createAnalyzer([f.canonical])
    const p = analyzeFile(f.canonical, a)
    assert.equal(p.length, 1)
    assert.equal(p[0].sink, "stdout")
    assert.equal(p[0].audience, "unknown", "identidade do arquivo nao e evidencia sobre o payload")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: `write` em objeto que NAO e process nao vira sink de stream", async () => {
  const f = fixture(`export function run(fluxo, socket) {
  fluxo.write("a")
  socket.stdout.write("b")
}
`)
  try {
    const p = await analisar(f)
    assert.deepEqual(p.filter((x) => x.sink !== null), [],
      "so `process.stdout`/`process.stderr` sao streams do processo")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: `process.stdin.read` e `process.stdout.columns` nao sao sinks", async () => {
  const f = fixture(`export function run() {
  process.stdin.read()
  const c = process.stdout.columns
  return c
}
`)
  try {
    const p = await analisar(f)
    assert.deepEqual(p.filter((x) => x.sink !== null), [])
  } finally { cleanupTmp(f.root) }
})

test("pontos que NAO sao stream carregam sink null e calleePath coerente", async () => {
  const f = fixture(`import { info } from "../cli/index.js"\ninfo("oi")\n`)
  try {
    const p = await analisar(f)
    assert.equal(p[0].sink, null)
    assert.equal(p[0].calleePath, "info")
    assert.equal(p[0].audience, "public_diagnostic", "o caminho normal nao regrediu")
  } finally { cleanupTmp(f.root) }
})

// ── Controle: arquivo convertido nao perde sinks ─────────────────────────────

/**
 * O controle que importa de verdade. Roda o engine contra ARQUIVOS REAIS do
 * repositorio e confronta com uma varredura textual independente. Se o AST
 * encontrar menos, a migracao para o registry apagaria pontos existentes —
 * exatamente o falso negativo que esta fatia existe para impedir.
 */
const ARQUIVOS_REAIS = [
  "src/commands/monitor.js",
  "src/cli/create.js",
  "src/commands/task.js",
  "src/commands/visual.js",
]

test("CONTROLE: arquivos reais nao perdem nenhum process.*.write na conversao", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const abs = ARQUIVOS_REAIS.map((r) => path.join(repoRoot, r))
  const a = createAnalyzer(abs)

  for (const [i, arquivo] of abs.entries()) {
    const texto = readFileSync(arquivo, "utf8")
    const esperado = (texto.match(/process\.(stdout|stderr)\.write\s*\(/g) || []).length
    const achados = analyzeFile(arquivo, a).filter((p) => p.sink !== null)

    assert.ok(esperado > 0, `${ARQUIVOS_REAIS[i]} deveria ter sinks para o controle valer`)
    assert.equal(achados.length, esperado,
      `${ARQUIVOS_REAIS[i]}: AST achou ${achados.length}, varredura textual achou ${esperado}`)
    for (const p of achados) {
      assert.match(p.calleePath, /^process\.(stdout|stderr)\.write$/)
      assert.ok(["stdout", "stderr"].includes(p.sink))
    }
  }
})

/**
 * O teste acima compara AST com varredura textual, e a varredura textual e
 * justamente o metodo que esta fase existe para abandonar. Onde os dois divergem
 * no repositorio real, quem erra e o texto: `src/meta/i18n-inventory.js` CITA
 * `process.stdout.write(JSON.stringify(...))` dentro de um comentario JSDoc.
 * O grep conta 1; o AST conta 0, e o AST esta certo.
 *
 * Registrar isso impede duas leituras erradas no futuro: que o AST "perdeu" um
 * ponto, e que a paridade com grep seja tratada como o criterio de verdade.
 */
test("CONTROLE INVERSO: citacao em comentario nao vira ponto de saida", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const arquivo = path.join(repoRoot, "src", "meta", "i18n-inventory.js")
  const texto = readFileSync(arquivo, "utf8")

  const linhasCitadas = texto.split("\n")
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => /process\.(stdout|stderr)\.write\s*\(/.test(l))

  assert.ok(linhasCitadas.length > 0, "o arquivo cita o padrao — sem isso o controle nao vale")
  assert.ok(linhasCitadas.every(({ l }) => /^\s*(\/\/|\*|\/\*)/.test(l)),
    "toda citacao neste arquivo esta em comentario")

  const a = createAnalyzer([arquivo])
  const ast = analyzeFile(arquivo, a).filter((p) => p.sink !== null)

  assert.deepEqual(ast, [], "o AST nao extrai nenhuma delas — grep contaria 1")
})
