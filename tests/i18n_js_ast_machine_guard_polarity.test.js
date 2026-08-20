import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * POLARIDADE DA GUARDA DE MAQUINA.
 *
 * `underMachineGuard` perguntava "a condicao MENCIONA a flag?" e olhava sempre o
 * ramo `then`. Com `if (!json) …` as duas metades ficam erradas de uma vez: o
 * `then` — que e o caminho HUMANO — era marcado como ramo de maquina, e o
 * `else` — que e o de maquina — ficava de fora.
 *
 * MEDIDO ANTES DE CORRIGIR: 11 pontos de FRASE em quatro arquivos ja convertidos
 * (`context.js`, `visual.js`, `orchestrate.js`) carregavam
 * `underMachineGuard: true` sendo texto que o usuario le. Nenhum estava mal
 * CLASSIFICADO — todos fecham por `render-via-canonical-helper`, que nao
 * consulta a guarda —, mas o FATO estava errado, e quatro consumidores o
 * consultam: `ehFraseHumana`, `console-blank-line`, `ehDiagnosticoDeLifecycle` e
 * `modoDoPonto`. Era falso positivo esperando uma regra passar por perto.
 *
 * A correcao e por POLARIDADE: `+1` quando a condicao e verdadeira com a flag
 * ligada, `-1` quando e verdadeira com ela desligada. O ramo de maquina e o
 * `then` no primeiro caso e o `else` no segundo.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-polar-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  const alvo = path.join(root, "src", "alvo.js")
  writeFileSync(alvo, corpo)
  return { root, alvo }
}

/** Mapa linha -> `underMachineGuard`, para todos os pontos do fixture. */
const guardas = async (corpo, t) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture(corpo)
  t.after(() => cleanupTmp(f.root))
  return new Map(analyzeFile(f.alvo, createAnalyzer([f.alvo]), { repoRoot: f.root })
    .map((p) => [p.line, p.underMachineGuard]))
}

// ── Polaridade POSITIVA: comportamento que ja existia, preservado ───────────

test("`if (json)`: o `then` e ramo de maquina, o `else` nao", async (t) => {
  const g = await guardas(`
export function a(json) {
  if (json) { process.stdout.write("{}") }
  else { process.stdout.write("humano") }
}
`, t)
  assert.equal(g.get(3), true, "then de `if (json)` roda com a flag ligada")
  assert.equal(g.get(4), false, "else de `if (json)` e o caminho humano")
})

test("`if (args.includes(\"--json\"))`: a flag vem pelo argumento da chamada", async (t) => {
  const g = await guardas(`
export function a(args) {
  if (args.includes("--json")) { process.stdout.write("{}") }
}
`, t)
  assert.equal(g.get(3), true)
})

// ── Polaridade NEGATIVA: as duas metades que estavam erradas ───────────────

/**
 * A METADE QUE PRODUZIA FALSO POSITIVO. Este e o caso de
 * `runtime-supervisor.js:277`, `context.js:245/256` e oito outros: frase humana
 * dentro do `then` de `if (!json)`.
 */
test("`if (!json)`: o `then` e o caminho HUMANO, e nao pode ser ramo de maquina", async (t) => {
  const g = await guardas(`
export function a(json) {
  if (!json) { process.stdout.write("nada rodando") }
}
`, t)
  assert.equal(g.get(3), false, "com `!json`, o `then` roda com a flag DESLIGADA")
})

/**
 * A METADE QUE PRODUZIA FALSO NEGATIVO. Caso real de
 * `runtime-supervisor.js:278`: o payload de maquina vive no `else` de
 * `if (!json)`, e ficava sem guarda nenhuma.
 */
test("`if (!json) … else …`: o `else` E o ramo de maquina", async (t) => {
  const g = await guardas(`
export function a(json) {
  if (!json) { process.stdout.write("nada rodando") }
  else { process.stdout.write('{"stopped":[]}') }
}
`, t)
  assert.equal(g.get(3), false)
  assert.equal(g.get(4), true, "com `!json`, quem roda com a flag ligada e o `else`")
})

test("negacao dupla volta a polaridade positiva", async (t) => {
  const g = await guardas(`
export function a(json) {
  if (!!json) { process.stdout.write("{}") }
  else { process.stdout.write("humano") }
}
`, t)
  assert.equal(g.get(3), true)
  assert.equal(g.get(4), false)
})

test("`if (!args.includes(\"--json\")) … else …`: o `else` e de maquina", async (t) => {
  const g = await guardas(`
export function a(args) {
  if (!args.includes("--json")) { process.stdout.write("humano") }
  else { process.stdout.write("{}") }
}
`, t)
  assert.equal(g.get(3), false)
  assert.equal(g.get(4), true)
})

// ── NEGATIVOS: condicao que nao fala da flag ───────────────────────────────

test("NEGATIVO: condicao sem flag de maquina nao cria guarda em ramo nenhum", async (t) => {
  const g = await guardas(`
export function a(config) {
  if (config) { process.stdout.write("um") }
  else { process.stdout.write("dois") }
}
`, t)
  assert.equal(g.get(3), false)
  assert.equal(g.get(4), false)
})

test("NEGATIVO: a guarda nao atravessa a fronteira da funcao", async (t) => {
  const g = await guardas(`
export function a(json) {
  if (json) {
    const f = () => { process.stdout.write("dentro de outra funcao") }
    f()
  }
}
`, t)
  assert.equal(g.get(4), false, "quem decide o que roda dentro de `f` e quem a chama")
})

// ── Ancorado no repositorio real ───────────────────────────────────────────

test("REPO: `runtime-supervisor.js` — a frase humana sai da guarda, o payload entra", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, "src", "commands", "runtime-supervisor.js")
  const pts = analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot })

  const humano = pts.find((p) => p.line === 278)
  assert.equal(humano.underMachineGuard, false, '"Nada rodando" roda quando `--json` NAO foi pedido')

  const maquina = pts.find((p) => p.line === 279)
  assert.equal(maquina.argForm, "json_document_literal")
  assert.equal(maquina.underMachineGuard, true, "o `{\"stopped\":[]}` vive no `else` de `if (!json)`")
})

/**
 * OS ONZE PONTOS MEDIDOS, agora com o fato certo. Ancorado por arquivo e linha
 * porque e a medicao que este teste protege — se um deles mudar de lugar, a
 * medicao mudou e alguem precisa reconferir.
 */
test("REPO: nenhum ponto de FRASE de arquivo convertido fica sob guarda de maquina", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const { CONVERTED_FILES } = await import(
    pathToFileURL(path.join(repoRoot, "scripts", "i18n-registry.mjs")).href
  )
  const alvos = CONVERTED_FILES.map((f) => path.join(repoRoot, f))
  const analyzer = createAnalyzer(alvos)
  const FRASE = new Set(["text_literal", "text", "interpolation_only"])

  const suspeitos = []
  for (const [i, abs] of alvos.entries()) {
    for (const p of analyzeFile(abs, analyzer, { repoRoot })) {
      if (p.underMachineGuard === true && FRASE.has(p.argForm)) suspeitos.push(`${CONVERTED_FILES[i]}:${p.line}`)
    }
  }
  assert.deepEqual(suspeitos, [],
    "frase redigida para alguem ler nao roda no ramo de `--json` — se aparecer aqui, ou a frase esta no lugar errado ou a polaridade quebrou")
})
