import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Regras `console-lifecycle-diagnostic` e `stream-lifecycle-diagnostic`.
 *
 * `scripts/clean-pkg.mjs` e `scripts/sync-qg-version.mjs` nao sao comandos da
 * CLI e nao estao no `DISPATCH` — nenhuma regra de superficie de comando os
 * alcancava, e os tres pontos deles ficavam `unknown`. Mas o npm os executa
 * SOZINHO: `version` roda um, `prepack` roda o outro. Quem versiona ou publica
 * le aquela saida, e ela e do produto.
 *
 * DUAS REGRAS PORQUE SAO DOIS CANAIS. `console.error` nao tem sink e cai em
 * `JS_RULES`; `process.stderr.write` tem e cai em `SINK_RULES`. As duas
 * compartilham `ehDiagnosticoDeLifecycle`, para que as portas nao possam
 * divergir com o tempo.
 *
 * O QUE A REGRA NAO E: "script emitiu, logo classifica". A porta e o MANIFESTO
 * citar o arquivo numa chave de lifecycle do npm, e a forma ser FRASE. Um
 * `scripts.test` nao entra, e um payload `serializer` continua `unknown`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

/**
 * Fixture com MANIFESTO: é ele que decide, então ele faz parte do cenário e não
 * do teste. `scripts` é passado inteiro para que cada negativo troque só a chave.
 */
function fixture(corpo, { scripts = { version: "node scripts/tool.mjs" } } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-lifecycle-"))
  mkdirSync(path.join(root, "scripts"), { recursive: true })
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0", scripts }, null, 2))
  writeFileSync(path.join(root, "src", "cli", "index.js"), "export function info(m) { console.log(m) }\n")
  const alvo = path.join(root, "scripts", "tool.mjs")
  writeFileSync(alvo, corpo)
  return { root, alvo, cli: path.join(root, "src", "cli", "index.js") }
}

const classificar = async (f) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.cli, f.alvo]), { repoRoot: f.root })
}
const naLinha = (pts, l) => pts.find((p) => p.line === l)

const CORPO_CONSOLE = `const n = 3
console.error(\`tool: removidos \${n} artefato(s)\`)
`
const CORPO_STREAM = `const v = "1.0.0"
process.stderr.write(\`tool: versao = \${v}\\n\`)
`

// ── POSITIVOS: um por canal ─────────────────────────────────────────────────

test("POSITIVO: `console.error` em script de lifecycle entra na claim", async (t) => {
  const f = fixture(CORPO_CONSOLE)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 2)
  assert.equal(p.rule, "console-lifecycle-diagnostic")
  assert.equal(p.audience, "public_diagnostic")
  assert.equal(p.trigger, "lifecycle_diagnostic")
})

test("POSITIVO: `process.stderr.write` em script de lifecycle entra na claim", async (t) => {
  const f = fixture(CORPO_STREAM)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 2)
  assert.equal(p.rule, "stream-lifecycle-diagnostic")
  assert.equal(p.audience, "public_diagnostic")
})

test("as duas regras concordam: MESMA audiência e MESMO trigger nos dois canais", async (t) => {
  const a = fixture(CORPO_CONSOLE)
  const b = fixture(CORPO_STREAM)
  t.after(() => { cleanupTmp(a.root); cleanupTmp(b.root) })
  const pa = naLinha(await classificar(a), 2)
  const pb = naLinha(await classificar(b), 2)
  assert.equal(pa.audience, pb.audience, "o canal muda; o fato não")
  assert.equal(pa.trigger, pb.trigger)
})

// ── NEGATIVOS: uma porta cada ───────────────────────────────────────────────

test("NEGATIVO: script citado em `test` (não-lifecycle) NÃO entra", async (t) => {
  const f = fixture(CORPO_CONSOLE, { scripts: { test: "node scripts/tool.mjs" } })
  t.after(() => cleanupTmp(f.root))
  assert.equal(naLinha(await classificar(f), 2).audience, "unknown",
    "`test` é conveniência de desenvolvimento, invocada à mão — não acompanha o produto")
})

test("NEGATIVO: script NÃO citado em manifesto algum continua `unknown`", async (t) => {
  const f = fixture(CORPO_CONSOLE, { scripts: {} })
  t.after(() => cleanupTmp(f.root))
  assert.equal(naLinha(await classificar(f), 2).audience, "unknown",
    "a porta é o MANIFESTO citar, não o arquivo morar em `scripts/`")
})

test("NEGATIVO: payload `serializer` em script de lifecycle continua `unknown`", async (t) => {
  const f = fixture(`const o = { a: 1 }
console.error(JSON.stringify(o))
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal(naLinha(await classificar(f), 2).audience, "unknown",
    "quem emitiu não é licença para classificar qualquer forma — payload segue pergunta em aberto")
})

test("NEGATIVO: sob guarda de MÁQUINA não vira diagnóstico humano", async (t) => {
  const f = fixture(`const args = process.argv.slice(2)
if (args.includes("--json")) {
  console.error(\`tool: \${args.length} argumento(s)\`)
}
`)
  t.after(() => cleanupTmp(f.root))
  assert.notEqual(naLinha(await classificar(f), 3).rule, "console-lifecycle-diagnostic")
})

/**
 * A forma da guarda é a que o motor reconhece: LEITURA da variável, não
 * comparação. `requiresDebugEnv` devolve `false` para `=== "1"` de propósito
 * (comentário no próprio código), e escrever o fixture com comparação testaria
 * outra coisa — foi o que aconteceu na primeira versão deste teste.
 *
 * A asserção é sobre o RESULTADO, não sobre qual regra pegou: `debug-guarded` é
 * a primeira das duas listas e resolve antes, então a porta na regra de
 * lifecycle é defensiva. O que importa é que a saída não entre na claim.
 */
test("NEGATIVO: sob guarda de DEBUG continua fora da claim", async (t) => {
  const f = fixture(`const n = 1
if (process.env.DEBUG) {
  console.error(\`tool: interno \${n}\`)
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 3)
  assert.equal(p.audience, "internal_debug", "debug explícito tem audiência própria")
  assert.notEqual(p.audience, "public_diagnostic", "não é canal do produto")
})

test("NEGATIVO: `console` SOMBREADO não é o canal do runtime", async (t) => {
  const f = fixture(`const console = { error: () => {} }
console.error(\`tool: nada\`)
`)
  t.after(() => cleanupTmp(f.root))
  assert.notEqual(naLinha(await classificar(f), 2).rule, "console-lifecycle-diagnostic")
})

// ── O CASO REAL ─────────────────────────────────────────────────────────────

/**
 * Os dois scripts do repositório, pela derivação REAL do manifesto. Se algum
 * deixar de ser citado num lifecycle, este teste cai — que é o comportamento
 * desejado: a classificação deixa de valer junto.
 */
test("REAL: os dois scripts do repo são alcançados por lifecycle e ficam sem `unknown`", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvos = ["scripts/sync-qg-version.mjs", "scripts/clean-pkg.mjs"]
  const an = createAnalyzer(alvos.map((f) => path.join(repoRoot, f)))
  for (const rel of alvos) {
    const pts = analyzeFile(path.join(repoRoot, rel), an, { repoRoot })
    assert.ok(pts.length > 0, `${rel}: sem pontos — reancorar o teste`)
    assert.equal(pts.filter((p) => p.audience === "unknown").length, 0, `${rel} ainda tem unknown`)
    for (const p of pts) {
      assert.match(p.rule, /lifecycle-diagnostic$/, `${rel}:${p.line} classificado por outra regra`)
    }
  }
})
