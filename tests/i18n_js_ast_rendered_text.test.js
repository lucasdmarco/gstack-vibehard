import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Regra `console-project-rendered-text` — texto MONTADO pelo projeto, impresso
 * no canal humano.
 *
 * `visual.js:86` e `research.js:294` imprimem o retorno de uma funcao que monta
 * prosa a partir de dados. No callsite nao ha string alguma (forma `opaque`), e
 * era so isso que os mantinha `unknown`.
 *
 * A CORRECAO DE UMA HIPOTESE ERRADA. O levantamento anterior supunha DUPLA
 * CONTAGEM — as frases viveriam nos modulos chamados e seriam contadas la — e
 * concluia por `render_primitive` (fora de escopo). Medido, e falso: aqueles
 * modulos tem ZERO chamada de sink, logo ZERO ponto no inventario. Ha teste
 * abaixo fixando exatamente isso, para que a hipoteses nao volte.
 *
 * A porta que so a MEDICAO revelou e a do arquivo de projeto: `` `x`.trimEnd() ``
 * tambem tem retorno `string`, e resolve para `lib.es2019.string.d.ts`. "Retorna
 * string" sozinho nao separa codigo nosso de biblioteca padrao.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

/** Fixture com a cadeia canonica: DISPATCH -> handler -> arquivo alvo. */
function fixture(corpo, { render = "export function montar(d) { return `# titulo ${d.n}` }\n" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-render-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "commands"), { recursive: true })
  mkdirSync(path.join(root, "src", "skills"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  writeFileSync(path.join(root, "src", "skills", "render.js"), render)
  writeFileSync(path.join(root, "src", "cli", "index.js"), `
import { demoCommand } from "../commands/demo.js"
export function info(m) { console.log(m) }
const DISPATCH = { demo: (a) => demoCommand(a) }
export function run(c, a) { const h = DISPATCH[c]; return h ? h(a) : null }
`)
  const alvo = path.join(root, "src", "commands", "demo.js")
  writeFileSync(alvo, corpo)
  return { root, alvo, cli: path.join(root, "src", "cli", "index.js") }
}

const classificar = async (f) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.cli, f.alvo]), { repoRoot: f.root })
}
const naLinha = (pts, l) => pts.find((p) => p.line === l)

// ── POSITIVO ────────────────────────────────────────────────────────────────

test("POSITIVO: `console.log(fnDoProjeto(dados))` com retorno string entra na claim", async (t) => {
  const f = fixture(`
import { montar } from "../skills/render.js"
export function demoCommand(d) {
  console.log(montar(d))
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 4)
  assert.equal(p.rule, "console-project-rendered-text")
  assert.equal(p.audience, "public_diagnostic", "o canal e publico e o texto e do projeto")
  assert.equal(p.trigger, "project_rendered_text")
})

test("o ponto APONTA para o arquivo onde a frase mora", async (t) => {
  const f = fixture(`
import { montar } from "../skills/render.js"
export function demoCommand(d) {
  console.log(montar(d))
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 4)
  assert.equal(p.textOrigin, "src/skills/render.js",
    "sem o ponteiro, a Fase 2 procuraria a string num callsite que nao tem nenhuma")
  assert.ok(!path.isAbsolute(p.textOrigin), "caminho RELATIVO: absoluto vazaria o nome do usuario")
})

// ── NEGATIVOS: uma porta cada ───────────────────────────────────────────────

/**
 * A porta do ARQUIVO DE PROJETO nao e testavel por fixture — medido, nao suposto.
 *
 * Num programa montado sobre diretorio temporario o checker NAO resolve nem
 * metodo de lib (`.trimEnd()`) nem import de `node_modules`: `textOrigin` sai
 * `null` com a porta E sem ela. Um "negativo" escrito assim passaria por motivo
 * errado — foi o que aconteceu na primeira versao deste arquivo, e so o mutation
 * control revelou (M1 nao quebrava teste nenhum).
 *
 * O que da para afirmar, e e afirmado aqui contra o REPOSITORIO real: toda
 * origem detectada aponta para dentro do repo, nunca para `node_modules` nem
 * para `.d.ts`. A porta permanece no motor como fail-closed; que hoje nenhum
 * caso real a exercite esta dito por extenso, em vez de simulado por um teste
 * que nao a alcanca.
 */
test("REAL: toda origem detectada esta DENTRO do repo — nunca lib nem node_modules", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const { CONVERTED_FILES } = await import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href)
  const alvos = [...CONVERTED_FILES, "src/commands/visual.js", "src/commands/research.js"]
  const an = createAnalyzer(alvos.map((f) => path.join(repoRoot, f)))

  let vistos = 0
  for (const rel of alvos) {
    for (const p of analyzeFile(path.join(repoRoot, rel), an, { repoRoot })) {
      if (p.textOrigin === null) continue
      vistos += 1
      assert.ok(!/node_modules/.test(p.textOrigin), `${rel}:${p.line} aponta para node_modules`)
      assert.ok(!p.textOrigin.endsWith(".d.ts"), `${rel}:${p.line} aponta para declaracao de lib`)
      assert.ok(!path.isAbsolute(p.textOrigin), `${rel}:${p.line} deveria ser caminho relativo`)
    }
  }
  assert.ok(vistos > 0, "se nenhuma origem foi detectada, o teste nao esta medindo nada")
})

test("NEGATIVO: funcao do projeto que NAO retorna string nao entra", async (t) => {
  const f = fixture(`
import { montar } from "../skills/render.js"
export function demoCommand(d) {
  console.log(montar(d))
}
`, { render: "export function montar(d) { return { titulo: d.n } }\n" })
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 4)
  assert.equal(p.audience, "unknown",
    "objeto impresso e outra pergunta — `unknown` e a resposta correta para ela")
})

test("NEGATIVO: `console.log(identificador)` continua `unknown`", async (t) => {
  const f = fixture(`
export function demoCommand(config) {
  console.log(config)
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 3)
  assert.equal(p.audience, "unknown", "a regra exige CHAMADA, nao valor qualquer")
})

test("NEGATIVO: dentro do ramo de MAQUINA nao vira saida humana", async (t) => {
  const f = fixture(`
import { montar } from "../skills/render.js"
export function demoCommand(d, args = []) {
  if (args.includes("--json")) {
    console.log(montar(d))
  }
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 5)
  assert.notEqual(p.rule, "console-project-rendered-text",
    "sob --json o contrato e outro; chamar de diagnostico humano esconderia o problema")
})

test("NEGATIVO: fora de handler do DISPATCH nao entra", async (t) => {
  const f = fixture(`
import { montar } from "../skills/render.js"
function solta(d) {
  console.log(montar(d))
}
export function demoCommand() { return null }
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 4)
  assert.equal(p.audience, "unknown",
    "funcao que nenhum comando alcanca nao e superficie publica provada")
})

test("NEGATIVO: `console` SOMBREADO nao e o canal do runtime", async (t) => {
  const f = fixture(`
import { montar } from "../skills/render.js"
const console = { log: () => {} }
export function demoCommand(d) {
  console.log(montar(d))
}
`)
  t.after(() => cleanupTmp(f.root))
  const p = naLinha(await classificar(f), 5)
  assert.notEqual(p.rule, "console-project-rendered-text",
    "a decisao e pela DECLARACAO, nao pelo nome")
})

// ── O FATO QUE DERRUBOU A HIPOTESE DE DUPLA CONTAGEM ────────────────────────

/**
 * Fixa o fato MEDIDO que decidiu a audiencia. Se um dia esses modulos passarem a
 * emitir, a premissa muda e a classificacao precisa ser revista — e este teste e
 * quem avisa.
 */
/**
 * A ORDEM faz parte da regra.
 *
 * Colocada antes de `command-human-branch`, esta regra roubava 15 pontos de
 * `monitor.js` — arquivo ja convertido. A audiencia nao mudava
 * (`public_diagnostic` nos dois casos), mas o `rule` gravado no registry sim, o
 * que produz churn num artefato commitado sem corrigir classificacao alguma.
 * Ser a ULTIMA e o que a mantem estritamente aditiva.
 */
test("REGRESSAO: a regra nao rouba pontos que `command-human-branch` ja descreve", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, "src", "commands", "monitor.js")
  const an = createAnalyzer([alvo, path.join(repoRoot, "src", "cli", "index.js")])
  const pts = analyzeFile(alvo, an, { repoRoot })

  const roubados = pts.filter((p) => p.rule === "console-project-rendered-text")
  assert.equal(roubados.length, 0,
    `monitor.js ja e descrito por regras existentes; ${roubados.length} ponto(s) mudariam de rule no registry`)
  assert.ok(pts.some((p) => p.rule === "command-human-branch"),
    "controle do proprio controle: se nenhum ponto casasse a regra anterior, o teste acima passaria por vacuidade")
})

test("os modulos que MONTAM o texto nao tem ponto de emissao — nao ha dupla contagem", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvos = ["src/skills/design-feedback.js", "src/epistemic/render.js"]
  const abs = alvos.map((f) => path.join(repoRoot, f))
  const an = createAnalyzer(abs)
  for (const a of abs) {
    assert.equal(analyzeFile(a, an, { repoRoot }).length, 0,
      `${a}: so RETORNA string, nao emite — por isso o texto dele nao esta contado em lugar nenhum`)
  }
})
