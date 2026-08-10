import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Os OITO residuais de `src/cli/create.js`, classificados por evidência
 * estrutural — nenhum override, nenhuma regra criada para zerar o censo.
 *
 * Eram quatro grupos com causas distintas, e agrupá-los por semelhança
 * superficial teria sido o erro:
 *
 *   A (4) métodos do próprio `defaultLogger` — implementam o canal;
 *   B (1) `write(JSON.stringify(...))` sob `--json` — protocolo com consumidor;
 *   C (2) receptor lido de campo (`c.logger`) em vez de parâmetro;
 *   D (1) receptor canônico local com argumento em `a || b`.
 *
 * Cada grupo abaixo tem o positivo e o homônimo hostil que precisa continuar
 * `unknown`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(src) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-resid-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  const canonical = path.join(root, "src", "cli", "index.js")
  writeFileSync(canonical, `
import createCommand from "./create.js"
export function info(msg) { console.log(msg) }
const DISPATCH = { create: (a) => createCommand(a) }
export default DISPATCH
`)
  const alvo = path.join(root, "src", "cli", "create.js")
  writeFileSync(alvo, src)
  return { root, alvo, canonical }
}

const analisar = async (f, ctx = {}) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.alvo, f.canonical]), ctx)
}

const LOGGER = `const defaultLogger = {
  info: (m) => console.log(\`  \${m}\`),
  success: (m) => console.log(\`  ok \${m}\`),
  warn: (m) => console.log(\`  ! \${m}\`),
  error: (m) => console.error(\`  x \${m}\`),
}
`

// ── Grupo A: métodos do logger canônico local ───────────────────────────────

test("A: `console.*` DENTRO do logger canônico local é `render_primitive`", async (t) => {
  const f = fixture(`${LOGGER}
export default function createCommand() { defaultLogger.info("oi") }
`)
  t.after(() => cleanupTmp(f.root))
  const dentro = (await analisar(f)).filter((p) => p.inLocalRenderPrimitive)
  assert.equal(dentro.length, 4, "os quatro métodos do objeto")
  for (const p of dentro) {
    assert.equal(p.audience, "render_primitive",
      "contar como público duplicaria a frase que já é contada no callsite")
  }
})

test("A HOSTIL: objeto que NÃO é logger puro não vira render_primitive", async (t) => {
  // `info` faz duas coisas; pelo predicado de emissão pura, o objeto inteiro cai.
  const f = fixture(`const quase = {
  info: (m) => { registrar(m); console.log(m) },
  success: (m) => console.log(m),
  warn: (m) => console.log(m),
  error: (m) => console.error(m),
}
export default function createCommand() { quase.info("oi") }
`)
  t.after(() => cleanupTmp(f.root))
  assert.equal((await analisar(f)).some((p) => p.inLocalRenderPrimitive), false,
    "um método impuro derruba o objeto inteiro — meio-logger não é logger")
})

// ── Grupo B: protocolo com consumidor declarado ─────────────────────────────

const COM_JSON = `${LOGGER}
export default function createCommand(args) { emitir(args) }
function emitir(args) {
  if (args.includes("--json")) process.stdout.write(JSON.stringify({ ok: true }) + "\\n")
}
`

test("B: payload de serializador COM consumidor declarado é `machine_protocol`", async (t) => {
  const f = fixture(COM_JSON)
  t.after(() => cleanupTmp(f.root))
  const alvo = String(f.alvo).replace(/\\/g, "/")
  const pts = await analisar(f, { consumers: { [alvo]: { consumer: "t", proof: "p" } } })
  const w = pts.find((p) => p.sink === "stdout")
  assert.equal(w.audience, "machine_protocol")
  assert.equal(w.argForm, "serializer")
})

test("B HOSTIL: sem consumidor declarado o mesmo payload fica `unknown`", async (t) => {
  const f = fixture(COM_JSON)
  t.after(() => cleanupTmp(f.root))
  const w = (await analisar(f)).find((p) => p.sink === "stdout")
  assert.equal(w.audience, "unknown",
    "serializador prova a forma do payload, não que exista parser consumindo")
})

test("B: o consumidor declarado de create.js aponta para um teste REAL", async () => {
  const { MACHINE_PROTOCOL_CONSUMERS } = await eng()
  const d = MACHINE_PROTOCOL_CONSUMERS["src/cli/create.js"]
  assert.ok(d, "o payload do `--dry-run --json` precisa de consumidor declarado")
  assert.match(d.proof, /json_purity_contract/, "e o consumidor executa o CLI de verdade")
})

// ── Grupo C: receptor lido de CAMPO ─────────────────────────────────────────

test("C: `c.logger.info(...)` resolve pelo campo do objeto do runtime", async (t) => {
  const f = fixture(`${LOGGER}
function createRuntime(o) { return { logger: o.logger || defaultLogger } }
function usar(c) { c.logger.info(\`Projeto \${c.nome}\`) }
export default function createCommand(args) { usar(createRuntime({ args })) }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.calleePath === "info" && x.line > 6)
  assert.ok(p, "o ponto precisa ser extraído")
  assert.ok(p.receiverOrigin, "o campo carrega o logger provado; ler de campo não desfaz a prova")
  assert.equal(p.audience, "public_diagnostic")
})

test("C HOSTIL: campo de objeto NÃO provado continua `unknown`", async (t) => {
  const f = fixture(`${LOGGER}
function usar(c) { c.logger.info("texto") }
export default function createCommand(opaco) { usar(opaco) }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.calleePath === "info")
  assert.equal(p.receiverOrigin, null, "`opaco` não é objeto conhecido — o campo não prova nada")
  assert.equal(p.audience, "unknown")
})

// ── Grupo D: receptor canônico local + `a || b` ─────────────────────────────

test("D: `defaultLogger.error(a || \"literal\")` resolve, e a forma vê o literal", async (t) => {
  const f = fixture(`${LOGGER}
export default function createCommand(err) { defaultLogger.error(err?.message || "create failed") }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.calleePath === "defaultLogger.error")
  assert.ok(p.receiverOrigin, "o receptor É o logger canônico local, por binding")
  assert.equal(p.argForm, "text", "`||` entrega um dos lados; o lado literal traz texto a traduzir")
  assert.equal(p.audience, "public_diagnostic")
})

test("D HOSTIL: receptor homônimo de outro objeto não é canônico", async (t) => {
  const f = fixture(`${LOGGER}
const defaultLoggerFalso = { error: (m) => enviar(m) }
export default function createCommand(err) { defaultLoggerFalso.error(err?.message || "falhou") }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.calleePath === "defaultLoggerFalso.error")
  assert.equal(p.receiverOrigin, null, "nome parecido, objeto que não emite pelo console")
  assert.equal(p.audience, "unknown")
})

test("D HOSTIL: logger canônico MUTADO deixa de provar", async (t) => {
  const f = fixture(`${LOGGER}
defaultLogger.error = (m) => enviar(m)
export default function createCommand(err) { defaultLogger.error(err?.message || "falhou") }
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.calleePath === "defaultLogger.error")
  assert.equal(p.receiverOrigin, null, "o objeto lido no callsite não é mais o que o literal descrevia")
})

// ── Resultado no arquivo real ───────────────────────────────────────────────

test("REAL: `create.js` chega a unknown ZERO, sem override algum", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer(["src/cli/create.js", "src/cli/index.js", "src/cli/diagnostic-logger.js"])
  const pts = analyzeFile("src/cli/create.js", a)

  assert.equal(pts.length, 91)
  assert.equal(pts.filter((p) => p.audience === "unknown").length, 0)

  const porAud = {}
  for (const p of pts) porAud[p.audience] = (porAud[p.audience] ?? 0) + 1
  assert.deepEqual(porAud, { render_primitive: 4, public_diagnostic: 85, machine_protocol: 1, terminal_control: 1 })

  const overrides = JSON.parse(
    (await import("node:fs")).readFileSync(path.join(repoRoot, "src/meta/i18n-js-overrides.json"), "utf8")).overrides
  assert.deepEqual(overrides ?? [], [], "nenhuma classificação precisou de decisão humana por âncora")
})

test("REAL: nenhum ponto público foi rebaixado para fora do escopo", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const { isInScope } = await import(pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-audiences.js")).href)
  const a = createAnalyzer(["src/cli/create.js", "src/cli/index.js", "src/cli/diagnostic-logger.js"])
  const pts = analyzeFile("src/cli/create.js", a)

  const inScope = pts.filter((p) => isInScope(p.audience)).length
  assert.ok(inScope >= 85, `esperado o grosso do arquivo em escopo; veio ${inScope}`)
  assert.equal(pts.filter((p) => p.audience === "user_content" || p.audience === "external_passthrough").length, 0,
    "nenhuma audiência de fuga foi usada para tirar ponto público da claim")
})
