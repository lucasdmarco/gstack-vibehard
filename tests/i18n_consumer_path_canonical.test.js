import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * FRONTEIRA DE REPRESENTAÇÃO entre o ponto analisado e a tabela de consumidores.
 *
 * A divergência real: `analyzeFile` normaliza o caminho do ponto (`C:/…`), mas
 * `repoRoot` chega como o SO o entrega (`C:\…`). Com isso, o MESMO
 * `process.stdout.write(JSON.stringify(...))` de `create.js:1624` era
 * `machine_protocol` na análise direta e `unknown` no registry — o artefato
 * publicado divergia da medição, em silêncio.
 *
 * A correção canonicaliza UMA vez, na entrada, e mantém a comparação por
 * IGUALDADE. Afrouxar para sufixo ou basename resolveria o sintoma e abriria a
 * porta que os controles abaixo fecham: um arquivo homônimo fora do projeto
 * herdaria o consumidor declarado e viraria protocolo sem parser algum.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

const FONTE = `export function run(data) {
  process.stdout.write(JSON.stringify(data) + "\\n")
}
`

/** Projeto com o arquivo em `src/cli/create.js`, como no repositório real. */
function projeto() {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-canon-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  const alvo = path.join(root, "src", "cli", "create.js")
  writeFileSync(alvo, FONTE)
  return { root, alvo }
}

const analisar = async (abs, ctx) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(abs, createAnalyzer([abs]), ctx)
}

const CONSUMIDOR = { "src/cli/create.js": { consumer: "t", proof: "tests/x.test.js" } }

// ── A divergência, reproduzida ──────────────────────────────────────────────

test("REGRESSÃO: `repoRoot` com separador do Windows resolve igual ao normalizado", async (t) => {
  const p = projeto()
  t.after(() => cleanupTmp(p.root))

  // Exatamente o par que divergia: ponto normalizado, raiz como o SO entrega.
  const comBarraInvertida = p.root.split("/").join("\\")
  const r = await analisar(p.alvo, { consumers: CONSUMIDOR, repoRoot: comBarraInvertida })
  assert.equal(r[0].audience, "machine_protocol",
    "a representação da raiz não pode mudar a classificação do mesmo arquivo")

  const rNormalizado = await analisar(p.alvo, { consumers: CONSUMIDOR, repoRoot: p.root.split("\\").join("/") })
  assert.equal(rNormalizado[0].audience, "machine_protocol")
  assert.equal(r[0].audience, rNormalizado[0].audience, "Windows e POSIX chegam à MESMA chave canônica")
})

test("raiz com barra final não muda o resultado", async (t) => {
  const p = projeto()
  t.after(() => cleanupTmp(p.root))
  const r = await analisar(p.alvo, { consumers: CONSUMIDOR, repoRoot: `${p.root}/` })
  assert.equal(r[0].audience, "machine_protocol")
})

// ── Controles hostis: a segurança do consumidor declarado ───────────────────

test("HOSTIL: sem consumidor declarado continua `unknown`", async (t) => {
  const p = projeto()
  t.after(() => cleanupTmp(p.root))
  const r = await analisar(p.alvo, { consumers: {}, repoRoot: p.root })
  assert.equal(r[0].audience, "unknown", "serializador não prova que exista parser consumindo")
})

test("HOSTIL: arquivo HOMÔNIMO fora da raiz não herda o consumidor", async (t) => {
  const dentro = projeto()
  const fora = projeto() // outra raiz, mesmo caminho relativo
  t.after(() => { cleanupTmp(dentro.root); cleanupTmp(fora.root) })

  // A raiz declarada é a do primeiro projeto; o arquivo analisado é do segundo.
  const r = await analisar(fora.alvo, { consumers: CONSUMIDOR, repoRoot: dentro.root })
  assert.equal(r[0].audience, "unknown",
    "mesmo caminho relativo, projeto diferente — sufixo casaria e é justamente o que não pode")
})

test("HOSTIL: prefixo SEMELHANTE de raiz não casa", async (t) => {
  const p = projeto()
  t.after(() => cleanupTmp(p.root))
  // `…/gstack-canon-abc` versus `…/gstack-canon-ab`: um é prefixo textual do
  // outro, mas são diretórios distintos.
  const quase = p.root.slice(0, -1)
  const r = await analisar(p.alvo, { consumers: CONSUMIDOR, repoRoot: quase })
  assert.equal(r[0].audience, "unknown", "a fronteira é o separador, não o prefixo de string")
})

test("HOSTIL: caminho que ESCAPA da raiz não ganha consumidor", async (t) => {
  const p = projeto()
  t.after(() => cleanupTmp(p.root))
  // Raiz declarada é um subdiretório; o arquivo está acima dela.
  const subdir = path.join(p.root, "src", "cli", "nested")
  mkdirSync(subdir, { recursive: true })
  const r = await analisar(p.alvo, { consumers: CONSUMIDOR, repoRoot: subdir })
  assert.equal(r[0].audience, "unknown", "fora da raiz não existe chave canônica")
})

test("HOSTIL: sem `repoRoot`, só caminho já relativo casa", async (t) => {
  const p = projeto()
  t.after(() => cleanupTmp(p.root))
  const r = await analisar(p.alvo, { consumers: CONSUMIDOR })
  assert.equal(r[0].audience, "unknown",
    "caminho absoluto sem raiz declarada não vira chave — a comparação segue estrita")
})

// ── O arquivo real, pelo caminho oficial ────────────────────────────────────

test("REAL: o registry publicado e a análise direta CONCORDAM sobre create.js:1624", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer([
    path.join(repoRoot, "src/cli/create.js"),
    path.join(repoRoot, "src/cli/index.js"),
    path.join(repoRoot, "src/cli/diagnostic-logger.js"),
  ])
  const direto = analyzeFile(path.join(repoRoot, "src/cli/create.js"), a, { repoRoot })
    .find((p) => p.line === 1624)

  const registry = JSON.parse(
    (await import("node:fs")).readFileSync(path.join(repoRoot, "src/meta/i18n-js-registry.json"), "utf8"))
  const publicado = registry.files["src/cli/create.js"].entries.find((e) => e.line === 1624)

  assert.equal(direto.audience, "machine_protocol")
  assert.equal(publicado.audience, direto.audience,
    "medição e artefato publicado precisam concordar — divergir em silêncio é o defeito que este teste guarda")
})
