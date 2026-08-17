import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * ENTRYPOINT DE PLUGIN — a borda por onde um HOST entra no nosso código.
 *
 * Nem todo entrypoint canônico é o `DISPATCH` da CLI.
 * `src/plugins/opencode/gstack-session.js` não tem comando: o OpenCode importa o
 * módulo, chama a fábrica exportada e recebe uma TABELA DE HANDLERS DE EVENTO.
 * É o mesmo papel do `DISPATCH` — só que a chave é um evento, não um subcomando.
 *
 * SEM ISTO, três `console.warn` de moldura INTERPOLADA ficam `unknown` para
 * sempre: `ehFraseHumana` exige entrypoint canônico provado para a forma `text`,
 * e exige com razão — a alternativa ("export qualquer serve") foi o que já
 * classificou uma query SQL como saída do CLI.
 *
 * DUAS PORTAS, e a segunda existe para a declaração não poder mentir: o arquivo
 * precisa estar DECLARADO (que um harness carregue o módulo é fato de
 * instalação, não algo derivável do arquivo) E a FORMA precisa se confirmar no
 * código.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

/** Projeto com o arquivo NO caminho declarado, para a âncora casar. */
function fixture(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-plugin-"))
  const dir = path.join(root, "src", "plugins", "opencode")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  const alvo = path.join(dir, "gstack-session.js")
  writeFileSync(alvo, corpo)
  return { root, alvo }
}

const raizes = async (corpo, t) => {
  const { createAnalyzer, raizesDePlugin } = await eng()
  const f = fixture(corpo)
  t.after(() => cleanupTmp(f.root))
  const a = createAnalyzer([f.alvo])
  return raizesDePlugin(a.program.getSourceFile(f.alvo), f.root)
}

const TABELA = `
export const GstackSession = async ({ $ }) => {
  if (process.env.OFF === "1") return {}
  return {
    "session.created": async () => { console.warn("criou") },
    "session.deleted": async () => { console.warn("apagou") },
  }
}
`

// ── POSITIVOS ───────────────────────────────────────────────────────────────

test("POSITIVO: fábrica declarada que devolve tabela de handlers vira raiz", async (t) => {
  assert.deepEqual(await raizes(TABELA, t), ["GstackSession"])
})

/**
 * O KILL SWITCH não desqualifica. `return {}` na primeira linha desliga o
 * plugin, e uma versão anterior desta checagem procurava "o primeiro literal de
 * objeto devolvido" — achava justamente esse, via zero propriedades e reprovava
 * o arquivo inteiro.
 */
test("POSITIVO: `return {}` de kill switch convive com a tabela real", async (t) => {
  const r = await raizes(TABELA, t)
  assert.deepEqual(r, ["GstackSession"], "o vazio não é tabela, mas também não desqualifica")
})

/**
 * A FORMA CONCISA — `async () => ({ … })` — devolve uma ParenthesizedExpression,
 * não o literal. Sem desembrulhar, toda fábrica escrita assim reprovaria; e os
 * controles negativos abaixo passariam pelo MOTIVO ERRADO, provando a porta que
 * ninguém exercitou. O mutation control foi quem mostrou.
 */
test("POSITIVO: fábrica de corpo CONCISO também é reconhecida", async (t) => {
  assert.deepEqual(await raizes(`
export const GstackSession = async ({ $ }) => ({
  "session.created": async () => { console.warn("criou") },
})
`, t), ["GstackSession"])
})

// ── NEGATIVOS: a declaração não basta ──────────────────────────────────────

test("NEGATIVO: arquivo NÃO declarado não tem raiz, por mais que a forma bata", async (t) => {
  const { createAnalyzer, raizesDePlugin } = await eng()
  const root = mkdtempSync(path.join(tmpdir(), "gstack-plugin-"))
  t.after(() => cleanupTmp(root))
  mkdirSync(path.join(root, "src", "outro"), { recursive: true })
  const alvo = path.join(root, "src", "outro", "gstack-session.js")
  writeFileSync(alvo, TABELA)
  const a = createAnalyzer([alvo])
  assert.deepEqual(raizesDePlugin(a.program.getSourceFile(alvo), root), [],
    "carregar o módulo é fato de instalação — precisa estar declarado")
})

test("NEGATIVO: export declarado que não existe no arquivo não vira raiz", async (t) => {
  assert.deepEqual(await raizes(`
export const Outra = async () => ({ "session.created": async () => {} })
`, t), [])
})

/**
 * A PORTA DA FORMA. Se o arquivo deixar de ser tabela de handlers, a declaração
 * para de valer sozinha — é isso que impede a lista de envelhecer calada.
 */
test("NEGATIVO: retorno com valor que NÃO é função não é tabela de handlers", async (t) => {
  assert.deepEqual(await raizes(`
export const GstackSession = async () => ({ "session.created": async () => {}, versao: 3 })
`, t), [])
})

test("NEGATIVO: retorno sem literal de objeto não é tabela", async (t) => {
  assert.deepEqual(await raizes(`
export const GstackSession = async () => "nada"
`, t), [])
})

test("NEGATIVO: só o kill switch, sem tabela real, não vira raiz", async (t) => {
  assert.deepEqual(await raizes(`
export const GstackSession = async () => { return {} }
`, t), [])
})

test("NEGATIVO: fábrica NÃO exportada não vira raiz", async (t) => {
  assert.deepEqual(await raizes(`
const GstackSession = async () => ({ "session.created": async () => {} })
`, t), [])
})

// ── Nome de função que é valor de propriedade ─────────────────────────────

/**
 * Um arrow que É valor de propriedade TEM nome: a chave. Quem o invoca o
 * encontra por ela, como um handler do `DISPATCH`. Chamá-lo de `<anon>` fazia
 * `alcancavelDaqui` derrubá-lo por uma razão que não é a dele — aquela guarda
 * existe contra callback passado adiante, onde quem roda depende de quem
 * recebeu.
 */
test("a cadeia de ancestralidade nomeia o handler pela CHAVE, não `<anon>`", async (t) => {
  const { createAnalyzer, analyzeFile } = await eng()
  const f = fixture(TABELA)
  t.after(() => cleanupTmp(f.root))
  const pts = analyzeFile(f.alvo, createAnalyzer([f.alvo]), { repoRoot: f.root })
  const p = pts.find((x) => x.line === 5)
  assert.ok(p, "o handler `session.created` emite na linha 5")
  assert.deepEqual(p.functions, ["session.created", "GstackSession"])
})

/**
 * CONTROLE NEGATIVO do mesmo mecanismo: callback passado adiante continua
 * anônimo, e continua sendo derrubado. Sem este caso, nomear propriedades
 * poderia parecer licença para aprovar qualquer arrow.
 */
test("NEGATIVO: callback passado adiante segue `<anon>` e segue derrubando", async (t) => {
  const { createAnalyzer, analyzeFile } = await eng()
  const f = fixture(`
export function correr(lista) {
  lista.forEach(() => { console.warn(\`item \${lista.length}\`) })
}
`)
  t.after(() => cleanupTmp(f.root))
  const pts = analyzeFile(f.alvo, createAnalyzer([f.alvo]), { repoRoot: f.root })
  const p = pts.find((x) => x.line === 3)
  assert.ok(p.functions.includes("<anon>"), "quem roda depende de quem recebeu o callback")
  assert.equal(p.reachableFromEntrypoint, false)
})

// ── Ancorado no repositório real ───────────────────────────────────────────

test("REPO: o plugin do OpenCode chega a `unknown` ZERO", async () => {
  const { createAnalyzer, analyzeFile } = await eng()
  const alvo = path.join(repoRoot, "src", "plugins", "opencode", "gstack-session.js")
  const pts = analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot })
  assert.equal(pts.filter((p) => p.audience === "unknown").length, 0)
  assert.equal(pts.length, 4)
})

test("REPO: a declaração nomeia host e evidência, e a forma confere", async () => {
  const { PLUGIN_ENTRYPOINTS, createAnalyzer, raizesDePlugin } = await eng()
  const chave = "src/plugins/opencode/gstack-session.js"
  const d = PLUGIN_ENTRYPOINTS[chave]
  assert.equal(d.host, "opencode")
  assert.ok(d.evidence.length > 40, "a declaração precisa dizer QUEM carrega o módulo")

  const alvo = path.join(repoRoot, chave)
  const a = createAnalyzer([alvo])
  assert.deepEqual(raizesDePlugin(a.program.getSourceFile(alvo), repoRoot), [d.export])
})

/**
 * A capacidade não pode mexer no que já foi reconciliado: o registry dos
 * arquivos convertidos precisa continuar byte a byte igual.
 */
test("REPO: nenhum arquivo já convertido muda de classificação", async () => {
  const { buildRegistry, serializar, CONVERTED_FILES } = await import(
    pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href
  )
  const { readFileSync } = await import("node:fs")
  const emDisco = readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry.json"), "utf-8")
  const gerado = serializar(buildRegistry(CONVERTED_FILES, { root: repoRoot }))
  assert.equal(gerado.replace(/\r\n/g, "\n"), emDisco.replace(/\r\n/g, "\n"))
})
