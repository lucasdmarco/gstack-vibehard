import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * REPASSE DE SUBPROCESSO DO PROPRIO PACOTE, COM A ORIGEM JA CONTADA.
 *
 * `context.js:249/260/278/280` encaminham, sem uma moldura sequer, o stdout de
 * `src/context-docs/py/context_db.py`. Desde a fatia da fronteira Python aquele
 * arquivo tem PONTOS PROPRIOS no inventario — as frases dele estao contadas na
 * origem. Conta-las de novo no repasse duplicaria as mesmas mensagens.
 *
 * A ASSIMETRIA COM `external_passthrough` E O CONTEUDO DESTA FATIA. La a
 * exclusao diz "ninguem e dono deste texto", e errar APAGA frases da claim: por
 * isso exige cadeia de valor byte a byte. Aqui a exclusao diz "este texto e
 * nosso e ja esta contado na origem", e a porta decisiva nao e sintatica — e a
 * pergunta, feita ao inventario, de se aquele artefato entra no censo.
 *
 * FAIL-CLOSED POR CONSTRUCAO: sem a injecao de `countedOrigins` o campo fica
 * `null` e os pontos voltam para a fila. E o "somente porque a origem passou a
 * ser contada" escrito como codigo.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)
const inv = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)

const ORIGEM = "src/py/motor.py"

/** Arquivo que dispara um artefato do proprio modulo e repassa a saida dele. */
function fixture(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-contada-"))
  mkdirSync(path.join(root, "src", "cmd"), { recursive: true })
  mkdirSync(path.join(root, "src", "py"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  writeFileSync(path.join(root, "src", "py", "motor.py"), 'print("frase")\n')
  const alvo = path.join(root, "src", "cmd", "alvo.js")
  writeFileSync(alvo, corpo)
  return { root, alvo }
}

const PRELUDIO = `
import { execFileSync } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
const AQUI = dirname(fileURLToPath(import.meta.url))
const MOTOR = join(AQUI, "..", "py", "motor.py")
function rodar(args) {
  return { ok: true, stdout: execFileSync("python", [MOTOR, ...args], { encoding: "utf-8" }) }
}
`

const oPonto = async (corpo, t, { contadas = [ORIGEM] } = {}) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture(corpo)
  t.after(() => cleanupTmp(f.root))
  const pts = analyzeFile(f.alvo, createAnalyzer([f.alvo]), {
    repoRoot: f.root,
    countedOrigins: new Set(contadas),
  })
  const s = pts.filter((p) => p.sink !== null)
  assert.equal(s.length, 1, `o fixture precisa ter exatamente um write em stream (tem ${s.length})`)
  return s[0]
}

const REPASSE_DIRETO = `${PRELUDIO}
export function mostrar(args) {
  process.stdout.write(rodar(args).stdout)
}
`

// ── POSITIVOS ───────────────────────────────────────────────────────────────

test("POSITIVO: repasse cru de artefato do pacote, com origem contada, sai da claim", async (t) => {
  const p = await oPonto(REPASSE_DIRETO, t)
  assert.equal(p.subprocessOrigin, ORIGEM, "a regra NOMEIA a origem, nao so afirma que existe")
  assert.equal(p.audience, "render_primitive")
  assert.equal(p.rule, "stream-counted-subprocess-origin")
  assert.equal(p.trigger, "counted_subprocess_origin")
})

test("POSITIVO: a cadeia atravessa um `const` local ate a funcao que dispara", async (t) => {
  const p = await oPonto(`${PRELUDIO}
export function mostrar(args) {
  const r = rodar(args)
  process.stdout.write(r.stdout)
}
`, t)
  assert.equal(p.audience, "render_primitive")
})

// ── A PORTA DECISIVA: a origem precisa estar mesmo no censo ────────────────

/**
 * SEM INJECAO, os pontos voltam para a fila. E o unico jeito honesto de escrever
 * "somente porque a origem passou a ser contada": se amanha aquele arquivo sair
 * da fronteira, estes pontos NAO somem da claim — voltam a ser pergunta aberta.
 */
test("NEGATIVO: sem `countedOrigins`, o mesmo ponto continua `unknown`", async (t) => {
  const p = await oPonto(REPASSE_DIRETO, t, { contadas: [] })
  assert.equal(p.subprocessOrigin, null)
  assert.equal(p.audience, "unknown")
})

test("NEGATIVO: origem que existe mas NAO e contada nao tira o ponto da claim", async (t) => {
  const p = await oPonto(REPASSE_DIRETO, t, { contadas: ["src/py/outro.py"] })
  assert.equal(p.audience, "unknown", "contar OUTRO arquivo nao diz nada sobre este")
})

/**
 * A cadeia precisa alcancar a funcao QUE DISPARA. "Ha um spawn no arquivo" nao
 * basta: aqui o spawn existe e e do proprio modulo, mas o valor impresso vem de
 * outra funcao, que nao dispara nada.
 */
test("NEGATIVO: spawn no arquivo, mas fora da cadeia do argumento, nao vale", async (t) => {
  const p = await oPonto(`${PRELUDIO}
function outra() { return { stdout: "texto montado aqui" } }
export function mostrar() {
  process.stdout.write(outra().stdout)
}
`, t)
  assert.equal(p.subprocessOrigin, null)
  assert.notEqual(p.audience, "render_primitive")
})

// ── NEGATIVOS de forma e de ramo ───────────────────────────────────────────

test("NEGATIVO: moldura literal do projeto mantem o ponto na claim", async (t) => {
  const p = await oPonto(`${PRELUDIO}
export function mostrar(args) {
  process.stdout.write(\`indice: \${rodar(args).stdout}\`)
}
`, t)
  assert.notEqual(p.argForm, "opaque")
  assert.notEqual(p.audience, "render_primitive")
})

test("NEGATIVO: no ramo de maquina o repasse e outra pergunta, nao duplicata", async (t) => {
  const p = await oPonto(`${PRELUDIO}
export function mostrar(args) {
  const json = args.includes("--json")
  if (json) process.stdout.write(rodar(args).stdout)
}
`, t)
  assert.equal(p.underMachineGuard, true)
  assert.notEqual(p.audience, "render_primitive")
})

/**
 * ARTEFATO EXTERNO nao passa por aqui: sem ancora de modulo o veredito e
 * `external`, e quem responde por ele e C-4(a). As duas regras descrevem coisas
 * diferentes e nao podem se sobrepor.
 */
test("NEGATIVO: artefato EXTERNO nao vira origem contada", async (t) => {
  const p = await oPonto(`
import { execFileSync } from "child_process"
function rodar(args) { return { stdout: execFileSync("git", args, { encoding: "utf-8" }) } }
export function mostrar(args) {
  process.stdout.write(rodar(args).stdout)
}
`, t)
  assert.equal(p.subprocessOrigin, null)
  assert.notEqual(p.rule, "stream-counted-subprocess-origin")
})

// ── Ancorado no repositorio real ───────────────────────────────────────────

const pontosDoContext = async (contadas) => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, "src", "commands", "context.js")
  return analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot, countedOrigins: contadas })
}

const origensReais = async () => new Set((await inv()).distributedPythonFiles(repoRoot).keys())

test("REPO: os quatro repasses de `context.js` saem da fila, nomeando o indexer", async () => {
  const pts = await pontosDoContext(await origensReais())
  for (const linha of [249, 260, 278, 280]) {
    const p = pts.find((x) => x.line === linha)
    assert.ok(p, `o ponto :${linha} precisa existir`)
    assert.equal(p.rule, "stream-counted-subprocess-origin", `:${linha}`)
    assert.equal(p.subprocessOrigin, "src/context-docs/py/context_db.py", `:${linha}`)
    assert.equal(p.audience, "render_primitive", `:${linha}`)
  }
})

test("REPO: tirar o indexer da fronteira devolve os quatro pontos para a fila", async () => {
  const semIndexer = new Set([...(await origensReais())].filter((f) => !f.endsWith("context_db.py")))
  const pts = await pontosDoContext(semIndexer)
  for (const linha of [249, 260, 278, 280]) {
    assert.equal(pts.find((x) => x.line === linha).audience, "unknown",
      `:${linha} nao pode sumir da claim quando a origem deixa de ser contada`)
  }
})

/**
 * NENHUMA MENSAGEM SE PERDE — a condicao que autoriza a exclusao. As frases que
 * estes quatro pontos encaminham tem ponto proprio no inventario, na origem, e
 * entram na claim la.
 */
test("REPO: as frases encaminhadas estao contadas NA ORIGEM, e em escopo", async () => {
  const { buildInventory } = await inv()
  const naOrigem = buildInventory({ repoRoot }).points.filter((p) => p.file.endsWith("context_db.py"))
  assert.equal(naOrigem.length, 19)
  assert.ok(naOrigem.filter((p) => p.classification === "in_scope").length >= 6,
    "as frases de prosa do indexer precisam estar DENTRO da claim na origem")
})
