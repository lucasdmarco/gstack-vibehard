import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * CÓDIGO GERADO — a mensagem não é do GStack, é do app do usuário.
 *
 * `templates/**` não é produto nosso rodando: é o que o `create` COPIA para
 * dentro do projeto do usuário. Um `console.error('Unhandled error:', err)` ali
 * não é diagnóstico público do GStack — é a superfície de log do servidor que o
 * usuário passa a manter.
 *
 * SEM A REGRA A CLASSIFICAÇÃO FICA ERRADA, e não apenas ausente:
 * `command-human-branch` alcança `error.ts:61` (console global, exportado, frase
 * literal) e devolve `public_diagnostic` — colocando na claim English-first uma
 * mensagem que pertence ao código gerado. Há teste fixando exatamente isso.
 *
 * A SEGUNDA PORTA É O QUE SEPARA dev surface de copy do app: console não chega à
 * tela do usuário final. Copy — texto que o usuário final lê — chega por
 * renderização ou corpo de resposta, e continua `unknown`, que é o estado certo
 * para uma pergunta que exige outra prova.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

const RAIZ = "templates/templates/fullstack-monorepo"

/** Projeto com o arquivo DENTRO ou FORA da raiz declarada, à escolha. */
function fixture(corpo, { dentro = true, caminho = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-tmpl-"))
  const rel = caminho ?? (dentro ? `${RAIZ}/apps/api/src/x.ts` : "src/commands/x.ts")
  const alvo = path.join(root, ...rel.split("/"))
  mkdirSync(path.dirname(alvo), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  writeFileSync(alvo, corpo)
  return { root, alvo }
}

const pontos = async (corpo, t, opts) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture(corpo, opts)
  t.after(() => cleanupTmp(f.root))
  return analyzeFile(f.alvo, createAnalyzer([f.alvo]), { repoRoot: f.root })
}

const CONSOLE_LITERAL = `export function errorHandler(err: unknown) {
  console.error('Unhandled error:', err)
}
`

// ── POSITIVOS ───────────────────────────────────────────────────────────────

test("POSITIVO: `console.*` em raiz de template é superfície do projeto GERADO", async (t) => {
  const [p] = await pontos(CONSOLE_LITERAL, t)
  assert.equal(p.audience, "generated_dev_surface")
  assert.equal(p.rule, "generated-dev-console")
})

test("POSITIVO: vale para `log`, `warn` e `error`, e com interpolação", async (t) => {
  const pts = await pontos(`const port = 3000
console.log(\`API running on http://localhost:\${port}\`)
console.warn('deprecated')
console.error('falhou')
`, t)
  assert.equal(pts.length, 3)
  for (const p of pts) assert.equal(p.audience, "generated_dev_surface", `linha ${p.line}`)
})

// ── NEGATIVOS: as duas portas ─────────────────────────────────────────────

/**
 * A PORTA DA RAIZ. O MESMO arquivo fora do template volta a ser produto nosso —
 * e é por isso que a decisão não pode ser "está em `templates/`": o critério é a
 * raiz DECLARADA, com evidência de que o `create` a copia.
 */
test("NEGATIVO: o mesmo código FORA da raiz de template não é código gerado", async (t) => {
  const [p] = await pontos(CONSOLE_LITERAL, t, { dentro: false })
  assert.notEqual(p.audience, "generated_dev_surface")
  assert.notEqual(p.rule, "generated-dev-console")
})

/**
 * ESTAR EM `templates/` NÃO BASTA — e é este caso que impede a regra de virar
 * classificação por diretório. Um template NÃO DECLARADO não tem evidência de
 * que o `create` o copia, e portanto não se sabe se aquele código chega ao
 * projeto do usuário. O mutation control mostrou: sem este caso, trocar a raiz
 * declarada por um `includes("templates/")` não quebrava teste algum.
 */
test("NEGATIVO: diretório de template NÃO DECLARADO não vale como código gerado", async (t) => {
  const [p] = await pontos(CONSOLE_LITERAL, t,
    { caminho: "templates/templates/outro-template/src/x.ts" })
  assert.notEqual(p.rule, "generated-dev-console",
    "sem declaração não há evidência de que o `create` copia aquele diretório")
})

/**
 * A PORTA DO CANAL. Emissão que NÃO é console pode ser copy do app — texto que o
 * usuário final lê — e isso exige outra prova. Fica `unknown`, que é o estado
 * certo.
 */
test("NEGATIVO: emissão que não é `console.*` continua `unknown` em template", async (t) => {
  const pts = await pontos(`import { logger } from './logger'
export function h(err: unknown) {
  logger.error(err)
}
`, t)
  const p = pts.find((x) => x.line === 3)
  if (p) {
    assert.notEqual(p.rule, "generated-dev-console",
      "logger de framework não é `console` — pode ser outro canal, e exige outra prova")
  }
})

test("NEGATIVO: `console` SOMBREADO localmente não é o do runtime", async (t) => {
  const pts = await pontos(`const console = { error: (..._a: unknown[]) => {} }
export function h() { console.error('nada') }
`, t)
  const p = pts.find((x) => x.line === 2)
  assert.notEqual(p?.rule, "generated-dev-console",
    "um objeto local com o mesmo nome não escreve no canal do runtime")
})

// ── O logger de framework: `app.log.error(err)` ────────────────────────────

/**
 * O MESMO canal por outra porta. `app.log.error(err)` não é `console`, e o
 * módulo não é local — é uma cadeia inteiramente estática dentro do arquivo até
 * um import de PACOTE. Um logger de terceiros escreve no log do servidor, não na
 * tela de quem usa o app.
 *
 * NÃO foi fechado por decisão ancorada de propósito: `anchored_human_review`
 * existe para limitação do motor, e declarar `structuralResolution: unresolved`
 * para uma cadeia que resolve seria falso.
 */
const FASTIFY = `import Fastify from 'fastify'
const app = Fastify({ logger: true })
export function h(e: unknown) { app.log.error(e) }
`
const trocando = (corpo, de, para) => corpo.replace(de, para)

test("POSITIVO: logger de pacote em template é superfície do projeto gerado", async (t) => {
  const [p] = await pontos(FASTIFY, t)
  assert.equal(p.loggerPackage, "fastify")
  assert.equal(p.audience, "generated_dev_surface")
  assert.equal(p.rule, "generated-framework-logger")
})

test("POSITIVO: vale sem o nível intermediário — `const logger = pino()`", async (t) => {
  const [p] = await pontos(`import pino from 'pino'
const logger = pino()
export function h(e: unknown) { logger.error(e) }
`, t)
  assert.equal(p.rule, "generated-framework-logger",
    "a prova é a cadeia até o pacote, não o formato `x.y.metodo`")
})

/**
 * As quatro portas da CADEIA. Cada uma recusa por um motivo diferente, e o
 * resultado de todas é `unknown` — o estado certo quando a origem do canal não
 * ficou provada.
 */
for (const [nome, corpo, porque] of [
  ["`let` no lugar de `const`", trocando(FASTIFY, "const app", "let app"),
    "reatribuível: o inicializador deixa de descrever o valor lido no callsite"],
  ["módulo RELATIVO do próprio template", `import { makeApp } from './app'
const app = makeApp()
export function h(e: unknown) { app.log.error(e) }
`, "um módulo local do template pode ser qualquer coisa, inclusive render"],
  ["builtin do Node", `import { createServer } from 'node:http'
const s = createServer()
export function h(e: unknown) { s.log.error(e) }
`, "builtin não é framework de terceiros"],
  ["receptor que não nasce de chamada", `import { cfg } from 'x'
const app = cfg
export function h(e: unknown) { app.log.error(e) }
`, "sem chamada não há prova de quem produziu o valor"],
]) {
  test(`NEGATIVO: ${nome} não fecha o logger de framework`, async (t) => {
    const [p] = await pontos(corpo, t)
    assert.equal(p.loggerPackage, null, porque)
    assert.equal(p.audience, "unknown")
  })
}

/**
 * A PORTA DO MÉTODO. `success` é coletado pelo extrator e NÃO é método de log —
 * é o que impede a regra de valer para qualquer chamada num objeto de pacote.
 */
test("NEGATIVO: método que não é de log não descreve emissão", async (t) => {
  const [p] = await pontos(trocando(FASTIFY, "app.log.error", "app.log.success"), t)
  assert.equal(p.loggerPackage, null)
  assert.notEqual(p.rule, "generated-framework-logger")
})

test("NEGATIVO: logger de framework FORA da raiz de template não é código gerado", async (t) => {
  const [p] = await pontos(FASTIFY, t, { dentro: false })
  assert.equal(p.loggerPackage, "fastify", "o fato do canal continua verdadeiro")
  assert.notEqual(p.audience, "generated_dev_surface",
    "mas fora do template a mensagem é nossa, e a audiência é outra pergunta")
})

// ── Ancorado no repositório real ───────────────────────────────────────────

/**
 * A EVIDÊNCIA DA RAIZ, conferida contra o fonte: se o `create` deixar de copiar
 * aquele diretório, a declaração para de valer e este teste avisa.
 */
test("REPO: a raiz declarada é a que o `create` realmente copia", async () => {
  const { TEMPLATE_ROOTS } = await eng()
  assert.equal(TEMPLATE_ROOTS.length, 1)
  const [r] = TEMPLATE_ROOTS

  const create = readFileSync(path.join(repoRoot, "src", "cli", "create.js"), "utf-8")
  const linha = create.split(/\r?\n/).find((l) => l.includes("copyRecursive") && l.includes(r.template))
  assert.ok(linha, `o \`create\` precisa copiar \`${r.template}\` — a declaração ficou órfã`)
  assert.match(linha, /"templates",\s*"templates",\s*"fullstack-monorepo"/,
    "o caminho copiado precisa ser o declarado em TEMPLATE_ROOTS")
})

test("REPO: os 16 pontos de console dos templates fecham como projeto gerado", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const inv = await import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)
  const arquivos = [...new Set(inv.buildInventory({ repoRoot }).points
    .filter((p) => p.file.startsWith("templates/")).map((p) => p.file))].sort()

  const a = createAnalyzer(arquivos.map((f) => path.join(repoRoot, f)))
  const todos = arquivos.flatMap((f) => analyzeFile(path.join(repoRoot, f), a, { repoRoot }))

  const doConsole = todos.filter((p) => String(p.callee).startsWith("console."))
  assert.equal(doConsole.length, 16, "se este número mudou, a auditoria precisa ser refeita")
  for (const p of doConsole) {
    assert.equal(p.audience, "generated_dev_surface", `${p.file}:${p.line}`)
  }

  // O 17o ponto é `app.log.error(err)` — logger do framework, NÃO console.
  // Fecha pela outra regra, e é isso que zera o TypeScript.
  const fora = todos.filter((p) => !String(p.callee).startsWith("console."))
  assert.deepEqual(fora.map((p) => p.calleePath), ["error"])
  assert.equal(fora[0].rule, "generated-framework-logger")
  assert.equal(todos.filter((p) => p.audience === "unknown").length, 0,
    "os 17 pontos de template fecham: nenhum TypeScript aberto")
})

/**
 * O QUE A REGRA CORRIGE, e não só o que ela acrescenta: sem ela,
 * `error.ts:61` era classificado como diagnóstico público do GStack.
 */
test("REPO: `error.ts:61` deixa de ser diagnóstico público do GStack", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, RAIZ, "apps", "api", "src", "middleware", "error.ts")
  const [p] = analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot })
  assert.equal(p.line, 61)
  assert.equal(p.audience, "generated_dev_surface")
  assert.notEqual(p.audience, "public_diagnostic",
    "a mensagem é do app do usuário, e colocá-la na claim do GStack seria reivindicar texto alheio")
})

test("REPO: nenhum arquivo já convertido muda de classificação", async () => {
  const { buildRegistry, serializar, CONVERTED_FILES } = await import(
    pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href
  )
  const emDisco = readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry.json"), "utf-8")
  const gerado = serializar(buildRegistry(CONVERTED_FILES, { root: repoRoot }))
  assert.equal(gerado.replace(/\r\n/g, "\n"), emDisco.replace(/\r\n/g, "\n"))
})
