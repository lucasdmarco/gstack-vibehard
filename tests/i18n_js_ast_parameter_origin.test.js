import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * ORIGEM DO PARÂMETRO DE UM ARROW, por TODOS os callsites elegíveis.
 *
 * `runtime-supervisor.js:381` e `:424` são a mesma forma — o seam de escrita:
 *
 *   const write = opts.write || ((s) => process.stdout.write(s))
 *   …
 *   write(readTail(logPath, offset, size))
 *
 * O valor impresso não está no callsite: está no PARÂMETRO. O engine derruba
 * `<anon>` na cadeia de alcance, e com razão — quem roda um callback depende de
 * quem o recebeu. Mas a pergunta aqui não é "quem roda", e sim "o que ele
 * recebe", e essa tem resposta quando TODOS os callsites do próprio arrow
 * concordam.
 *
 * O `||` não cria ambiguidade sobre o parâmetro: quando `opts.write` existe, o
 * nosso arrow não roda; quando roda, recebe o argumento daquela chamada. A
 * alternativa externa muda QUEM escreve, nunca O QUE este arrow recebe.
 *
 * NADA AQUI OLHA O NOME DO PARÂMETRO — há controle renomeando-o. O que decide é
 * a POSIÇÃO na assinatura e o argumento naquela posição. E não reusa a regra de
 * função-em-propriedade: lá a identidade vem da tabela que declara o handler;
 * aqui viria do CHAMADOR, que é outro domínio.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-param-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  const alvo = path.join(root, "src", "alvo.js")
  writeFileSync(alvo, corpo)
  return { root, alvo }
}

const origemDe = async (corpo, t) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture(corpo)
  t.after(() => cleanupTmp(f.root))
  const s = analyzeFile(f.alvo, createAnalyzer([f.alvo]), { repoRoot: f.root }).filter((p) => p.sink !== null)
  assert.equal(s.length, 1, `o fixture precisa ter um write em stream (tem ${s.length})`)
  return s[0].parameterOrigin
}

// ── POSITIVOS ───────────────────────────────────────────────────────────────

test("POSITIVO: arrow invocado direto, recebendo leitura de arquivo", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
export function mostrar(caminho, opts = {}) {
  ;(opts.write || ((s) => process.stdout.write(s)))(readFileSync(caminho, "utf-8"))
}
`, t), "file_read")
})

test("POSITIVO: arrow guardado em `const` local e chamado pelo nome", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
export function seguir(caminho, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write(readFileSync(caminho, "utf-8"))
}
`, t), "file_read")
})

test("POSITIVO: a leitura atravessa uma função local cujo RETORNO é a chamada de fs", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
function ler(p) { return readFileSync(p, "utf-8") }
export function mostrar(caminho, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write(ler(caminho))
}
`, t), "file_read")
})

/**
 * O NOME NÃO DECIDE NADA. Mesmo fixture, parâmetro renomeado: o resultado é
 * idêntico porque o que vale é a POSIÇÃO.
 */
test("POSITIVO: renomear o parâmetro não muda a resolução", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
export function mostrar(caminho, opts = {}) {
  const write = opts.write || ((conteudoQualquer) => process.stdout.write(conteudoQualquer))
  write(readFileSync(caminho, "utf-8"))
}
`, t), "file_read")
})

// ── NEGATIVOS: convergência universal e exaustividade ─────────────────────

test("NEGATIVO: dois callsites com origens DIFERENTES ⇒ mista", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
export function mostrar(caminho, texto, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write(readFileSync(caminho, "utf-8"))
  write(texto)
}
`, t), "mixed")
})

test("NEGATIVO: ZERO callsites não prova nada", async (t) => {
  assert.equal(await origemDe(`
export function mostrar(opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  return write
}
`, t), "unresolved")
})

/**
 * ARROW PASSADO ADIANTE: quem recebeu decide o que ele vai receber, e os
 * callsites visíveis deixam de esgotar os reais.
 */
test("NEGATIVO: arrow passado como VALOR não tem chamadores exaustivos", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
export function mostrar(caminho, lista, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  lista.forEach(write)
  write(readFileSync(caminho, "utf-8"))
}
`, t), "unresolved")
})

/**
 * ARQUIVO DO PRÓPRIO PACOTE não é conteúdo de fora. Reusa a âncora de módulo de
 * C-4(a): caminho montado a partir da posição do próprio fonte é NOSSO.
 */
test("NEGATIVO: leitura de arquivo ANCORADO no módulo não é origem de fora", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
const AQUI = dirname(fileURLToPath(import.meta.url))
export function mostrar(opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write(readFileSync(join(AQUI, "banner.txt"), "utf-8"))
}
`, t), "unresolved")
})

test("NEGATIVO: argumento literal não é leitura de arquivo", async (t) => {
  assert.equal(await origemDe(`
export function mostrar(opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write("texto do produto")
}
`, t), "unresolved")
})

test("NEGATIVO: argumento que não é parâmetro de arrow ⇒ `none`", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "fs"
export function mostrar(caminho) {
  process.stdout.write(readFileSync(caminho, "utf-8"))
}
`, t), "none")
})

test("NEGATIVO: `fs` de módulo homônimo do projeto não conta", async (t) => {
  assert.equal(await origemDe(`
import { readFileSync } from "./meu-fs.js"
export function mostrar(caminho, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write(readFileSync(caminho, "utf-8"))
}
`, t), "unresolved")
})

// ── As portas da regra, exercitadas onde são decidíveis ───────────────────

/**
 * O MUTATION CONTROL MOSTROU o que os fixtures não alcançam: nenhum ponto real
 * chega com `parameterOrigin: file_read` E moldura textual, ou dentro do ramo de
 * máquina — a cadeia simplesmente não produz essas combinações hoje. Sem
 * exercitar o predicado direto, remover qualquer das duas portas não quebraria
 * teste algum, e elas viram decoração.
 */
const predicado = async () => {
  const { SINK_RULES } = await eng()
  return SINK_RULES.find((r) => r.id === "stream-supervised-process-log").when
}

const sintetico = (extra) => ({
  parameterOrigin: "file_read", argForm: "opaque", underMachineGuard: false, ...extra,
})

test("PORTA: origem de arquivo, forma opaca e fora de máquina ⇒ a regra concede", async () => {
  assert.equal((await predicado())(sintetico({})), true)
})

test("PORTA: moldura do projeto recusa — a frase passa a ser nossa", async () => {
  const when = await predicado()
  for (const forma of ["text", "text_literal", "interpolation_only", "serializer"]) {
    assert.equal(when(sintetico({ argForm: forma })), false, `${forma} não pode virar conteúdo do usuário`)
  }
})

test("PORTA: no ramo de máquina o repasse é outra pergunta", async () => {
  assert.equal((await predicado())(sintetico({ underMachineGuard: true })), false)
})

test("PORTA: qualquer origem que não seja `file_read` recusa", async () => {
  const when = await predicado()
  for (const o of ["mixed", "unresolved", "none"]) {
    assert.equal(when(sintetico({ parameterOrigin: o })), false, `origem ${o} não concede`)
  }
})

// ── Ancorado no repositório real ───────────────────────────────────────────

test("REPO: `logsCommand` resolve para leitura de arquivo; `followLog` NÃO", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, "src", "commands", "runtime-supervisor.js")
  const pts = analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot })

  assert.equal(pts.find((p) => p.line === 424).parameterOrigin, "file_read",
    "`logsCommand` passa `acumulado`, que é `readFileSync(target.log)` — cadeia inteira visível")

  // `followLog` chama `write(readTail(...))`, e `readTail` devolve
  // `buf.subarray(...).toString(...)`: o `readSync` preenche o buffer por EFEITO
  // COLATERAL, e o retorno não guarda vínculo sintático com a leitura. Provar
  // exigiria análise de aliasing que este engine não faz — e não fazer é a
  // decisão certa: fail-closed.
  assert.equal(pts.find((p) => p.line === 381).parameterOrigin, "unresolved",
    "efeito colateral em buffer não é cadeia de valor — o ponto continua na fila")
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
