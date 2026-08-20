import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * HELPER DE RENDER RESOLVIDO POR DESESTRUTURAÇÃO DE TABELA LOCAL.
 *
 * `install.js:361` é o caso real, e o callee lá é `log` — que NÃO é
 * `console.log`:
 *
 *   const groups = [
 *     ["Adicionados:", report.added, "+", info],
 *     ["Erros:",       report.errors, "",  warn],
 *   ]
 *   for (const [title, items, prefix, log] of groups) …
 *
 * A identidade vem de uma TABELA LOCAL, e por isso `render-via-canonical-helper`
 * não o alcança: `canonicalName` é `log` (nome do binding) e `declaredIn` é o
 * próprio arquivo. O ponto ficava `unknown` por falta de vocabulário, não por
 * dúvida — a linha `  + <arquivo>` do relatório de instalação é saída humana
 * como qualquer outra.
 *
 * MESMO ESPÍRITO DE C-3 (`tabelasDeDespacho`): quando a identidade vem de tabela
 * local, o que decide é o CONJUNTO de alternativas naquela posição. A regra é
 * UNIVERSAL — todas precisam ser helper canônico. Uma posição com qualquer outra
 * coisa derruba tudo, porque aí não se sabe qual canal roda.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

/** Fixture com o módulo canônico de render de verdade — a origem é conferida. */
function fixture(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-tabela-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "installer"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  // `select` está aqui de propósito: é export do módulo canônico e NÃO é
  // primitiva de render — serve de controle para a porta do nome.
  writeFileSync(path.join(root, "src", "cli", "index.js"), `
export function info(m) { console.log(m) }
export function warn(m) { console.log(m) }
export function error(m) { console.log(m) }
export function select(q, o) { console.log(q) }
`)
  const alvo = path.join(root, "src", "installer", "install.js")
  writeFileSync(alvo, corpo)
  return { root, alvo, cli: path.join(root, "src", "cli", "index.js") }
}

const pontoDaTabela = async (corpo, t, linha) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture(corpo)
  t.after(() => cleanupTmp(f.root))
  const pts = analyzeFile(f.alvo, createAnalyzer([f.cli, f.alvo]), { repoRoot: f.root })
  return pts.find((p) => p.line === linha)
}

const TABELA_OK = `
import { info, warn } from "../cli/index.js"
export function relatorio(report) {
  const groups = [
    ["Adicionados:", report.added, "+", info],
    ["Erros:", report.errors, "", warn],
  ]
  for (const [title, items, prefix, log] of groups) {
    info(title)
    items.forEach((item) => log(\`  \${prefix} \${item}\`.trimEnd()))
  }
}
`

// ── POSITIVO ────────────────────────────────────────────────────────────────

test("POSITIVO: todas as alternativas são helper canônico ⇒ canal sancionado", async (t) => {
  const p = await pontoDaTabela(TABELA_OK, t, 10)
  assert.ok(p, "o `log(...)` da linha 10 precisa existir")
  assert.equal(p.canonicalName, "log", "o nome LOCAL segue sendo `log` — o fato novo é outro")
  assert.equal(p.canonicalRenderViaTable, true)
  assert.equal(p.audience, "public_diagnostic")
  assert.equal(p.rule, "render-via-destructured-helper")
})

// ── NEGATIVOS: a universalidade e cada porta ──────────────────────────────

/**
 * UMA alternativa não canônica derruba TUDO. Se uma posição pode ser
 * `console.log`, não se sabe qual canal roda — e afirmar o canal sancionado
 * seria escolher a metade conveniente.
 */
test("NEGATIVO: UMA alternativa não canônica derruba a resolução", async (t) => {
  const p = await pontoDaTabela(`
import { info } from "../cli/index.js"
export function relatorio(report) {
  const groups = [
    ["Adicionados:", report.added, "+", info],
    ["Erros:", report.errors, "", console.log],
  ]
  for (const [title, items, prefix, log] of groups) {
    info(title)
    items.forEach((item) => log(\`  \${prefix} \${item}\`.trimEnd()))
  }
}
`, t, 10)
  assert.equal(p.canonicalRenderViaTable, false)
  assert.notEqual(p.rule, "render-via-destructured-helper")
})

test("NEGATIVO: helper LOCAL homônimo não vale — a origem é conferida", async (t) => {
  const p = await pontoDaTabela(`
function info(m) { console.log(m) }
function warn(m) { console.log(m) }
export function relatorio(report) {
  const groups = [["a", report.added, "+", info], ["b", report.errors, "", warn]]
  for (const [title, items, prefix, log] of groups) {
    items.forEach((item) => log(\`  \${prefix} \${item}\`.trimEnd()))
  }
}
`, t, 7)
  assert.equal(p.canonicalRenderViaTable, false,
    "mesmo nome, outra declaração: a origem precisa resolver no módulo canônico")
})

/**
 * ORIGEM CANÔNICA NÃO BASTA: precisa ser PRIMITIVA DE RENDER. `select` vem do
 * mesmo módulo e é outra coisa — prompt interativo, audiência própria. Sem esta
 * porta, qualquer export do módulo canônico viraria canal de diagnóstico, e o
 * mutation control mostrou que nenhum outro caso a exercitava.
 */
test("NEGATIVO: export canônico que NÃO é primitiva de render não vale", async (t) => {
  const p = await pontoDaTabela(`
import { info, select } from "../cli/index.js"
export function relatorio(report) {
  const groups = [["a", report.added, "+", info], ["b", report.errors, "", select]]
  for (const [title, items, prefix, log] of groups) {
    items.forEach((item) => log(\`  \${prefix} \${item}\`.trimEnd()))
  }
}
`, t, 6)
  assert.equal(p.canonicalRenderViaTable, false,
    "`select` é prompt, não render — a coluna deixa de ser homogênea")
})

test("NEGATIVO: tabela que não é literal local não resolve", async (t) => {
  const p = await pontoDaTabela(`
import { info, warn } from "../cli/index.js"
export function relatorio(report, groups) {
  for (const [title, items, prefix, log] of groups) {
    items.forEach((item) => log(\`  \${prefix} \${item}\`.trimEnd()))
  }
}
`, t, 5)
  assert.equal(p.canonicalRenderViaTable, false, "quem passa a tabela decide o canal")
})

test("NEGATIVO: linha que não é tupla derruba a coluna inteira", async (t) => {
  const p = await pontoDaTabela(`
import { info, warn } from "../cli/index.js"
export function relatorio(report) {
  const groups = [["a", report.added, "+", info], report.extra]
  for (const [title, items, prefix, log] of groups) {
    items.forEach((item) => log(\`  \${prefix} \${item}\`.trimEnd()))
  }
}
`, t, 6)
  assert.equal(p.canonicalRenderViaTable, false)
})

/**
 * A POSIÇÃO importa. Desestruturar a mesma tabela noutra posição pega outra
 * coluna — e as colunas de título e prefixo são strings, não helpers.
 */
test("NEGATIVO: outra POSIÇÃO da mesma tabela não é helper", async (t) => {
  const { analyzeFile, createAnalyzer, helperCanonicoPorTabela } = await eng()
  const f = fixture(TABELA_OK)
  t.after(() => cleanupTmp(f.root))
  const a = createAnalyzer([f.cli, f.alvo])
  const sf = a.program.getSourceFile(f.alvo)
  const ctx = { checker: a.checker, sf }

  // `title` é a coluna 0 — string literal, não helper.
  const ts2 = (await import("typescript")).default
  let titulo = null
  const visitar = (n) => {
    if (ts2.isIdentifier(n) && n.text === "title" && ts2.isCallExpression(n.parent)) titulo = n
    ts2.forEachChild(n, visitar)
  }
  visitar(sf)
  assert.ok(titulo, "o fixture usa `title` como argumento de `info`")
  assert.equal(helperCanonicoPorTabela(titulo, ctx), false, "coluna de string não é helper")
})

// ── Ancorado no repositório real ───────────────────────────────────────────

test("REPO: `install.js:361` fecha, e é o único ponto que a regra alcança ali", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, "src", "installer", "install.js")
  const pts = analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot })

  const p = pts.find((x) => x.line === 361)
  assert.ok(p, "se o ponto mudou de linha, a medição mudou")
  assert.equal(p.rule, "render-via-destructured-helper")
  assert.equal(p.audience, "public_diagnostic")

  assert.deepEqual(pts.filter((x) => x.canonicalRenderViaTable).map((x) => x.line), [361],
    "a regra é estreita: uma tabela, um ponto")
})

test("REPO: nenhum arquivo já convertido muda de classificação", async () => {
  const { buildRegistry, serializar, CONVERTED_FILES } = await import(
    pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href
  )
  const { readFileSync } = await import("node:fs")
  const emDisco = readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry.json"), "utf-8")
  const gerado = serializar(buildRegistry(CONVERTED_FILES, { root: repoRoot }))
  assert.equal(gerado.replace(/\r\n/g, "\n"), emDisco.replace(/\r\n/g, "\n"))
})
