import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * C-4(a) — `external_passthrough`, a audiencia que o vocabulario declara desde
 * o inicio e que nenhuma regra alcancava.
 *
 * O QUE MUDOU. Antes havia um teste afirmando que a audiencia era inalcancavel
 * POR DESIGN. Um zero desses nao informa nada: nao distingue "o repositorio nao
 * tem repasse de ferramenta externa" de "ninguem foi olhar". Agora ha um
 * provador estrutural, a audiencia e alcancavel, e o zero e MEDIDO.
 *
 * O ONUS E INVERTIDO NESTA AUDIENCIA. Toda outra regra INCLUI um ponto na claim
 * English-first; esta EXCLUI. Um falso positivo aqui nao produz ruido: apaga do
 * inventario frases que o usuario le, e some com o problema em vez de resolve-lo.
 * Por isso cada porta falha FECHADA — origem ausente, dinamica, mista ou nao
 * resolvida continua `unknown`.
 *
 * O ACHADO QUE DECIDIU A FATIA, e ele veio da medicao, nao da leitura. Os unicos
 * candidatos de repasse cru do repositorio sao `context.js:249/260/278/280`
 * (`process.stdout.write(r.stdout)`). O subprocesso deles NAO e ferramenta de
 * terceiros: e `src/context-docs/py/context_db.py`, que viaja dentro do pacote
 * (`package.json#files` inclui `src/`) e imprime prosa escrita pelo GStack
 * ("(sem resultados)", "Entidade '…' nao encontrada."). Classifica-los como
 * externos tiraria da claim mensagens do proprio produto — reincidencia exata do
 * erro que fez `runtime-stack-passthrough` ser removida do prototipo.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

/** Arquivo unico, analisado sozinho: estas regras nao dependem do DISPATCH. */
function fixture(corpo) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-passthru-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }))
  const alvo = path.join(root, "src", "alvo.js")
  writeFileSync(alvo, corpo)
  return { root, alvo }
}

const pontos = async (f) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.alvo]), { repoRoot: f.root })
}

/** O unico ponto de escrita em stream do fixture. */
const oPonto = (pts) => {
  const s = pts.filter((p) => p.sink !== null)
  assert.equal(s.length, 1, `o fixture precisa ter exatamente um write em stream (tem ${s.length})`)
  return s[0]
}

const classificar = async (corpo, t) => {
  const f = fixture(corpo)
  t.after(() => cleanupTmp(f.root))
  return oPonto(await pontos(f))
}

const IMPORTA = 'import { execFileSync } from "child_process"\n'

// ── POSITIVOS: a audiencia E alcancavel ─────────────────────────────────────

test("POSITIVO: bytes de binario externo repassados crus sao `external_passthrough`", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar() {
  const bytes = execFileSync("git", ["log", "--oneline"], { encoding: "utf-8" })
  process.stdout.write(bytes)
}
`, t)
  assert.equal(p.byteOrigin, "external")
  assert.equal(p.audience, "external_passthrough")
  assert.equal(p.rule, "stream-external-passthrough")
  assert.equal(p.trigger, "subprocess_bytes")
})

/**
 * A forma dominante e o CAMPO de captura, nao o valor inteiro. Sem seguir por
 * `E.campo` a cadeia pararia no primeiro passo e a regra so alcancaria a forma
 * mais rara.
 */
test("POSITIVO: campo de captura (`r.stdout`) atravessa a cadeia", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar() {
  const r = execFileSync("rg", ["--json", "x"], { encoding: "utf-8" })
  process.stderr.write(r.stdout)
}
`, t)
  assert.equal(p.audience, "external_passthrough")
})

test("POSITIVO: campo devolvido por funcao local do arquivo atravessa", async (t) => {
  const p = await classificar(`${IMPORTA}
function rodar(args) {
  return { ok: true, saida: execFileSync("fallow", args, { encoding: "utf-8" }) }
}
export function mostrar() {
  process.stdout.write(rodar(["audit"]).saida)
}
`, t)
  assert.equal(p.audience, "external_passthrough")
})

/**
 * NOME NAO DECIDE NADA — as duas metades desta prova.
 *
 * O apelido local muda e a classificacao nao; o nome de origem e igual e, sem a
 * importacao, a classificacao muda. Uma regra que perguntasse "o callee se chama
 * `execFileSync`?" erraria nos DOIS casos.
 */
test("POSITIVO: alias arbitrario no import continua sendo subprocesso", async (t) => {
  const p = await classificar(`
import { execFileSync as pmp } from "node:child_process"
export function mostrar() {
  process.stdout.write(pmp("git", ["status"], { encoding: "utf-8" }))
}
`, t)
  assert.equal(p.audience, "external_passthrough")
})

test("POSITIVO: import de NAMESPACE (`cp.execFileSync`) e reconhecido", async (t) => {
  const p = await classificar(`
import * as cp from "child_process"
export function mostrar() {
  process.stdout.write(cp.execFileSync("git", ["status"], { encoding: "utf-8" }))
}
`, t)
  assert.equal(p.audience, "external_passthrough")
})

test("NEGATIVO: funcao LOCAL homonima de `execFileSync` nao e subprocesso", async (t) => {
  const p = await classificar(`
function execFileSync(cmd, args) { return "saida simulada" }
export function mostrar() {
  process.stdout.write(execFileSync("git", ["status"]))
}
`, t)
  assert.notEqual(p.audience, "external_passthrough")
  assert.equal(p.byteOrigin, "none")
})

test("NEGATIVO: modulo homonimo do PROJETO nao abre subprocesso", async (t) => {
  const p = await classificar(`
import { execFileSync } from "./meu-child-process.js"
export function mostrar() {
  process.stdout.write(execFileSync("git", ["status"]))
}
`, t)
  assert.notEqual(p.audience, "external_passthrough")
})

// ── NEGATIVOS de ORIGEM: cada estado que precisa continuar `unknown` ────────

/**
 * ORIGEM DO PROJETO — a porta que decidiu a fatia inteira.
 *
 * O artefato montado a partir da localizacao do proprio modulo viaja com o
 * pacote. A saida dele e texto NOSSO, ainda que emitida por outro processo.
 */
test("NEGATIVO: artefato ancorado no proprio modulo e do PROJETO, nao externo", async (t) => {
  const p = await classificar(`${IMPORTA}
import { join, dirname } from "path"
import { fileURLToPath } from "url"
const AQUI = dirname(fileURLToPath(import.meta.url))
const ALVO = join(AQUI, "..", "py", "indexador.py")
export function mostrar() {
  process.stdout.write(execFileSync("python", [ALVO, "--x"], { encoding: "utf-8" }))
}
`, t)
  assert.equal(p.byteOrigin, "project")
  assert.equal(p.audience, "unknown", "texto do produto emitido por subprocesso NOSSO continua na fila")
})

test("NEGATIVO: `__dirname` global tambem ancora no modulo", async (t) => {
  const p = await classificar(`${IMPORTA}
import { join } from "path"
export function mostrar() {
  process.stdout.write(execFileSync("python", [join(__dirname, "s.py")], { encoding: "utf-8" }))
}
`, t)
  assert.equal(p.byteOrigin, "project")
})

/**
 * `__dirname` REDECLARADO no arquivo nao e o global do modulo — segue como
 * identificador comum. Sem esta porta bastaria criar uma variavel com aquele
 * nome para forjar procedencia de projeto.
 */
test("NEGATIVO: `__dirname` declarado localmente nao vale como ancora", async (t) => {
  const p = await classificar(`${IMPORTA}
const __dirname = "/opt/ferramentas"
export function mostrar() {
  process.stdout.write(execFileSync("python", [__dirname, "--x"], { encoding: "utf-8" }))
}
`, t)
  assert.equal(p.byteOrigin, "external", "sem ancora real, o alvo estatico e externo")
})

test("NEGATIVO: comando DINAMICO nao e comando externo — fica `unresolved`", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar(cmd, args) {
  process.stdout.write(execFileSync(cmd, args, { encoding: "utf-8" }))
}
`, t)
  assert.equal(p.byteOrigin, "unresolved")
  assert.equal(p.audience, "unknown")
})

/**
 * ORIGEM MISTA — universal, nao existencial.
 *
 * Um caminho de retorno vem do subprocesso e o outro nao. Provar so o caminho
 * feliz afirmaria sobre a metade que ninguem olhou; e exatamente a forma real de
 * `runIndexer`, cujo `catch` devolve o campo lido da excecao.
 */
test("NEGATIVO: origem MISTA entre caminhos de retorno bloqueia", async (t) => {
  const p = await classificar(`${IMPORTA}
function rodar(args) {
  if (args.length === 0) return { saida: "nenhum argumento" }
  return { saida: execFileSync("git", args, { encoding: "utf-8" }) }
}
export function mostrar(a) {
  process.stdout.write(rodar(a).saida)
}
`, t)
  assert.notEqual(p.audience, "external_passthrough")
})

/**
 * A MESMA MISTURA, na ORDEM INVERSA — e o mutation control pediu este caso.
 *
 * Trocar o join universal por "o primeiro retorno decide" sobrevivia ao teste
 * acima por acidente de ordem: la o primeiro `return` ja era o que nao vem de
 * subprocesso. Com o ramo do subprocesso em primeiro lugar, o mutante
 * classificaria — e a metade que ninguem olhou entraria como provada.
 */
test("NEGATIVO: origem MISTA com o subprocesso no PRIMEIRO retorno tambem bloqueia", async (t) => {
  const p = await classificar(`${IMPORTA}
function rodar(args) {
  if (args.length > 0) return { saida: execFileSync("git", args, { encoding: "utf-8" }) }
  return { saida: "nenhum argumento" }
}
export function mostrar(a) {
  process.stdout.write(rodar(a).saida)
}
`, t)
  assert.notEqual(p.audience, "external_passthrough",
    "um caminho provado nao prova o outro — o join e universal")
})

test("NEGATIVO: origem AUSENTE — string montada no proprio arquivo", async (t) => {
  const p = await classificar(`
const saida = "relatorio pronto"
export function mostrar() {
  process.stdout.write(saida)
}
`, t)
  assert.equal(p.byteOrigin, "none")
  assert.notEqual(p.audience, "external_passthrough")
})

/**
 * PARAMETRO — a forma real de `runtime-supervisor.js:346/389`
 * (`opts.write || ((s) => process.stdout.write(s))`). Quem decide o que `s` e
 * esta no chamador, e o callsite nao pode responder por ele.
 */
test("NEGATIVO: valor vindo de PARAMETRO nao tem origem provada", async (t) => {
  const p = await classificar(`
export function escrever(s) {
  process.stdout.write(s)
}
`, t)
  assert.notEqual(p.audience, "external_passthrough")
})

/**
 * `let` REATRIBUIDO — o inicializador deixa de descrever o valor lido.
 *
 * A porta e a declaracao ser `const`, e nao uma varredura por atribuicoes:
 * `sofreMutacao`, o helper compartilhado, so enxerga mutacao de PROPRIEDADE, e
 * este caso passava inteiro por ele. Sem este teste, trocar `const` por
 * "qualquer VariableDeclaration" nao quebraria nada.
 */
test("NEGATIVO: variavel REATRIBUIDA depois da declaracao invalida a leitura", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar(sujo) {
  let bytes = execFileSync("git", ["log"], { encoding: "utf-8" })
  bytes = sujo
  process.stdout.write(bytes)
}
`, t)
  assert.equal(p.byteOrigin, "unresolved")
  assert.notEqual(p.audience, "external_passthrough")
})

test("NEGATIVO: propriedade MUTADA de um `const` tambem invalida a leitura", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar(sujo) {
  const r = { saida: execFileSync("git", ["log"], { encoding: "utf-8" }) }
  r.saida = sujo
  process.stdout.write(r.saida)
}
`, t)
  assert.equal(p.byteOrigin, "unresolved")
  assert.notEqual(p.audience, "external_passthrough")
})

/**
 * O veredito exato IMPORTA aqui, e nao so "nao classificou".
 *
 * Sem a guarda de campo pendente, o segundo acesso sobrescreve o primeiro em
 * silencio e a cadeia passa a afirmar sobre um campo que ninguem seguiu. Hoje
 * isso nao chega a produzir `external` — literal de objeto nao e uma forma da
 * cadeia —, entao so a distincao `unresolved` x `none` derruba o mutante:
 * `unresolved` diz "parei aqui de proposito", `none` diz "nao havia nada".
 */
test("NEGATIVO: campo sobre campo (`r.a.b`) nao e seguido — nao se presume", async (t) => {
  const p = await classificar(`${IMPORTA}
function rodar() { return { r: { saida: execFileSync("git", ["log"], { encoding: "utf-8" }) } } }
export function mostrar() {
  process.stdout.write(rodar().r.saida)
}
`, t)
  assert.equal(p.byteOrigin, "unresolved", "a cadeia PARA no segundo campo, e diz que parou")
  assert.notEqual(p.audience, "external_passthrough")
})

// ── NEGATIVOS de TRANSPORTE e de AUDIENCIA VIZINHA ─────────────────────────

/**
 * MOLDURA DO PROJETO — a porta `argForm === "opaque"`.
 *
 * Assim que o GStack escreve uma palavra em volta, a frase e dele e o ponto
 * pertence a claim, por mais que o DADO venha de fora. E o que separa esta
 * audiencia de `public_diagnostic`, e o repositorio tem os dois casos lado a
 * lado (`research.js:76`, `tools.js:384`).
 */
test("NEGATIVO: moldura literal do projeto tira o ponto do repasse", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar() {
  const bytes = execFileSync("git", ["log"], { encoding: "utf-8" })
  process.stderr.write(\`falhou ao ler o historico: \${bytes}\`)
}
`, t)
  assert.notEqual(p.argForm, "opaque")
  assert.notEqual(p.audience, "external_passthrough")
})

test("NEGATIVO: `machine_protocol` — serializador estrutural nao e repasse", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar() {
  const bytes = execFileSync("git", ["log"], { encoding: "utf-8" })
  process.stdout.write(JSON.stringify({ saida: bytes }) + "\\n")
}
`, t)
  assert.equal(p.argForm, "serializer")
  assert.notEqual(p.audience, "external_passthrough")
})

/**
 * `user_content` — conteudo do usuario NAO e conteudo externo. Bytes lidos de
 * um arquivo do usuario nunca passaram por subprocesso, e a distincao importa:
 * as duas audiencias saem da claim por razoes diferentes, e confundi-las faria
 * uma prova de subprocesso valer como prova de propriedade do dado.
 */
test("NEGATIVO: `user_content` lido de arquivo nao vira repasse externo", async (t) => {
  const p = await classificar(`
import { readFileSync } from "fs"
export function mostrar(caminho) {
  process.stdout.write(readFileSync(caminho, "utf-8"))
}
`, t)
  assert.equal(p.byteOrigin, "none")
  assert.notEqual(p.audience, "external_passthrough")
})

test("NEGATIVO: sob guarda de DEBUG a audiencia e `internal_debug`", async (t) => {
  const p = await classificar(`${IMPORTA}
export function mostrar() {
  const bytes = execFileSync("git", ["log"], { encoding: "utf-8" })
  if (process.env.GSTACK_DEBUG) process.stdout.write(bytes)
}
`, t)
  assert.equal(p.audience, "internal_debug")
})

// ── AS DUAS PORTAS DEFENSIVAS, exercitadas onde sao decidiveis ─────────────

/**
 * O MUTATION CONTROL MOSTROU o que os fixtures nao alcancam.
 *
 * Remover `argForm === "opaque"` ou `underDebugGuard !== true` da regra nao
 * quebrava teste nenhum, porque hoje NENHUM ponto real chega naquelas
 * combinacoes: uma moldura literal ja derruba a cadeia um nivel antes
 * (`origemDeRepasse` so segue identificador, campo e chamada — template e
 * concatenacao param em `none`), e a guarda de debug e a PRIMEIRA regra de
 * `SINK_RULES`, entao vence por ordem antes desta ser consultada.
 *
 * Duas saidas ruins existiam: apagar as portas, e ficar dependendo da ordem das
 * regras e do alcance atual do provador; ou deixa-las sem prova, que e
 * decoracao. A terceira e esta — exercitar o predicado DIRETO, no nivel em que a
 * combinacao e decidivel. Se amanha a cadeia aprender a atravessar moldura, a
 * porta ja esta la e ja esta provada.
 */
const predicado = async () => {
  const { SINK_RULES } = await eng()
  return SINK_RULES.find((r) => r.id === "stream-external-passthrough").when
}

const pontoSintetico = (extra) => ({
  byteOrigin: "external", argForm: "opaque", underDebugGuard: false, ...extra,
})

test("PORTA: com origem externa, forma opaca e fora de debug, a regra concede", async () => {
  assert.equal((await predicado())(pontoSintetico({})), true)
})

test("PORTA: moldura do projeto (`argForm` textual) recusa, mesmo com origem externa", async () => {
  const when = await predicado()
  for (const forma of ["text", "text_literal", "interpolation_only", "serializer"]) {
    assert.equal(when(pontoSintetico({ argForm: forma })), false, `${forma} nao pode virar repasse`)
  }
})

test("PORTA: guarda de debug recusa, sem depender da ordem das regras", async () => {
  assert.equal((await predicado())(pontoSintetico({ underDebugGuard: true })), false)
})

test("PORTA: toda origem que nao seja `external` recusa", async () => {
  const when = await predicado()
  for (const origem of ["project", "unresolved", "none"]) {
    assert.equal(when(pontoSintetico({ byteOrigin: origem })), false, `origem ${origem} nao concede`)
  }
})

// ── CONTROLES ANCORADOS NO REPOSITORIO REAL ────────────────────────────────

/** Todas as chamadas de subprocesso de um arquivo do repo, com seu veredito. */
async function spawnsDoArquivo(rel) {
  const { createAnalyzer, chamadaDeSubprocesso, artefatoDeSubprocesso, segmentosDeCaminho } = await eng()
  const alvo = path.join(repoRoot, rel)
  const a = createAnalyzer([alvo])
  const sf = a.program.getSourceFile(alvo)
  const ctx = { checker: a.checker, sf, repoRoot }
  // Desce nos literais de array: `execFileSync(py, [INDEXER, ...subArgs])` tem o
  // artefato num ELEMENTO, e o spread derruba a resolucao do array inteiro.
  const candidatos = (n) => (ts.isArrayLiteralExpression(n) ? [...n.elements] : [n])
  const achados = []
  const visitar = (n) => {
    const s = chamadaDeSubprocesso(n, a.checker)
    if (s) {
      achados.push({
        linha: sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1,
        artefato: artefatoDeSubprocesso(s, ctx),
        segmentos: s.arguments.flatMap(candidatos).flatMap((x) => segmentosDeCaminho(x, ctx) ?? []),
        argumentos: s.arguments.map((x) => segmentosDeCaminho(x, ctx)),
      })
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return achados
}

/**
 * O ACHADO, provado e nao lido. O indexer que alimenta `context search`,
 * `related` e `explain` e um script DO PACOTE, e a prova disso e estrutural: o
 * caminho dele se ancora em `import.meta.url` do proprio `context.js`.
 */
test("REPO: o subprocesso de `context.js` e um script DO PROJETO", async () => {
  const spawns = await spawnsDoArquivo("src/commands/context.js")
  const doIndexer = spawns.filter((s) => s.artefato === "project")
  assert.equal(doIndexer.length, 1, "ha exatamente um spawn de artefato proprio em context.js")
  assert.ok(
    doIndexer[0].segmentos.includes("context_db.py"),
    `o artefato precisa ser nomeado pela prova, e veio: ${JSON.stringify(doIndexer[0].segmentos)}`,
  )
})

/**
 * CONTROLE POSITIVO NO REPO REAL: o provador nao devolve `project` para tudo.
 * O probe de versao do Python (`context.js:16`) e ferramenta de fora, e o mesmo
 * provador diz `external` — o que separa este zero de um zero por construcao.
 */
test("REPO: o probe do interpretador Python e reconhecido como EXTERNO", async () => {
  const spawns = await spawnsDoArquivo("src/commands/context.js")
  const externos = spawns.filter((s) => s.artefato === "external")
  assert.equal(externos.length, 1)
  assert.deepEqual(externos[0].argumentos[0], ["python3"])
})

/**
 * E o veredito no SINK: nenhum dos quatro candidatos alcanca `external`, e
 * portanto nenhum sai da claim. Ancorado por linha porque e a medicao que este
 * teste protege, nao uma propriedade generica.
 */
test("REPO: os quatro candidatos de `context.js` NAO sao repasse externo", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const alvo = path.join(repoRoot, "src", "commands", "context.js")
  const pts = analyzeFile(alvo, createAnalyzer([alvo]), { repoRoot })
  for (const linha of [249, 260, 278, 280]) {
    const p = pts.find((x) => x.line === linha)
    assert.ok(p, `o ponto :${linha} precisa existir — se mudou de linha, a medicao mudou`)
    assert.equal(p.calleePath, "process.stdout.write")
    assert.notEqual(p.byteOrigin, "external", `:${linha} nao pode ser dado como externo`)
    assert.equal(p.audience, "unknown", `:${linha} continua na fila de investigacao`)
  }
})

/**
 * O ZERO, agora MEDIDO. Substitui a afirmacao anterior de que a audiencia era
 * inalcancavel por design — aquela nao distinguia "nao ha" de "ninguem olhou".
 */
test("REPO: `external_passthrough` esta em zero POR MEDICAO, nao por design", async () => {
  const { SINK_RULES, JS_RULES } = await eng()
  const alcanca = [...SINK_RULES, ...JS_RULES].filter((r) => r.audience === "external_passthrough")
  assert.equal(alcanca.length, 1, "existe UMA regra que alcanca a audiencia")
  assert.equal(alcanca[0].id, "stream-external-passthrough")

  const inv = await import(
    `${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`
  )
  assert.equal(inv.buildInventory({ repoRoot }).byAudience.external_passthrough || 0, 0,
    "nenhum ponto do repositorio repassa bytes de ferramenta de fora sem moldura")
})
