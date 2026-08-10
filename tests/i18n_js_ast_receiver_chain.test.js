import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Task 3.1b.1 — PROPAGAÇÃO FIELD-SENSITIVE, limitada e fail-closed.
 *
 * A 3.1b resolvia receptor por posição de argumento e devolveu `unresolved` para
 * as 26 funções de `create.js` que recebem `logger`. Concluí dali que faltava
 * análise cross-module. Estava ERRADO: a origem canônica está DENTRO do módulo,
 * em `create.js:63` (`defaultLogger`, objeto literal cujos métodos são
 * `console.*`). O que faltava era propagar por objeto, fallback e destructuring.
 *
 * A cadeia real, reproduzida nos fixtures abaixo:
 *
 *   DISPATCH.create → createCommand(args) → createProject({ args })
 *     → resolveCreateCtx(options) → createRuntime(options)
 *     → `logger: options.logger || defaultLogger` → `c.logger` → helpers(logger)
 *
 * O controle crítico é a diferença entre dois callsites que parecem iguais:
 * `createProject({ args })` prova `defaultLogger` porque a AUSÊNCIA da
 * propriedade `logger` no objeto literal é estruturalmente verificável;
 * `createProject({ args, logger: outro })` não prova nada sobre `outro`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

function fixture(src) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-chain-"))
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

const analisar = async (f) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.alvo, f.canonical]))
}

/** A cadeia de `create.js`, reduzida ao esqueleto que importa. */
const CADEIA = (chamada) => `
const defaultLogger = {
  info: (m) => console.log(\`  \${m}\`),
  warn: (m) => console.log(\`  ! \${m}\`),
}

function createRuntime(options) {
  return { logger: options.logger || defaultLogger }
}

function resolveCreateCtx(options) {
  const rt = createRuntime(options)
  return { logger: rt.logger, args: options.args || [] }
}

function emitir(logger) {
  logger.warn("Nada a fazer.")
}

function createProject(options) {
  const c = resolveCreateCtx(options)
  emitir(c.logger)
}

export default function createCommand(args) {
  ${chamada}
}
`

// ── A cadeia real ───────────────────────────────────────────────────────────

test("CADEIA REAL: o caminho do dispatcher resolve para `defaultLogger`", async (t) => {
  const f = fixture(CADEIA("createProject({ args })"))
  t.after(() => cleanupTmp(f.root))
  const pts = await analisar(f)
  const p = pts.find((x) => x.callee === "logger.warn")
  assert.ok(p, "o ponto `logger.warn` precisa ser extraído")
  assert.equal(p.audience, "public_diagnostic",
    "a ausência de `logger` no objeto literal é estruturalmente verificável, então o fallback é o único caminho")
})

/**
 * CONTROLE CRÍTICO. Os dois callsites têm a mesma forma sintática; o que os
 * separa é a presença da propriedade. Se este teste passasse, a análise estaria
 * provando canonicidade de um valor que veio de fora.
 */
test("CONTROLE: `logger` INJETADO no objeto não prova canonicidade", async (t) => {
  const f = fixture(`
import { outroLogger } from "../util/tel.js"
${CADEIA("createProject({ args, logger: outroLogger })")}
`)
  t.after(() => cleanupTmp(f.root))
  mkdirSync(path.join(f.root, "src", "util"), { recursive: true })
  writeFileSync(path.join(f.root, "src", "util", "tel.js"), "export const outroLogger = { warn(m) { return m } }\n")

  const pts = await analisar(f)
  const p = pts.find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "unknown",
    "a propriedade EXISTE e vem de outro módulo — o fallback nunca é alcançado")
})

test("CONTROLE: consumidor direto de createProject não contamina o caminho CLI", async (t) => {
  // `createProject` exportado significa que testes e terceiros podem injetar
  // qualquer logger. Só o caminho originado no DISPATCH constitui prova.
  const f = fixture(`
${CADEIA("createProject({ args })").replace("function createProject", "export function createProject")}
`)
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "unknown",
    "com `createProject` exportado, os callsites do módulo não esgotam os chamadores")
})

// ── Formas que permanecem `unresolved` ──────────────────────────────────────

test("CONTROLE: SPREAD no objeto de opções impede a prova de ausência", async (t) => {
  const f = fixture(CADEIA("createProject({ args, ...extras })"))
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "unknown",
    "`...extras` pode conter `logger`; ausência deixa de ser verificável")
})

test("CONTROLE: propriedade COMPUTADA impede a prova de ausência", async (t) => {
  const f = fixture(CADEIA("createProject({ args, [chave]: valor })"))
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "unknown", "a chave só existe em runtime")
})

test("CONTROLE: objeto de opções OPACO não permite concluir nada", async (t) => {
  const f = fixture(CADEIA("createProject(opcoesDeOutroLugar)"))
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "unknown", "não é objeto literal — não há propriedades para inspecionar")
})

test("CONTROLE: MUTAÇÃO do objeto depois da criação invalida a prova", async (t) => {
  const f = fixture(CADEIA(`
  const o = { args }
  o.logger = algumOutro
  createProject(o)`))
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "unknown", "o objeto no callsite não é o mesmo que chega em `createProject`")
})

test("CONTROLE: fallback para valor NÃO canônico não resolve", async (t) => {
  const f = fixture(`
import { outro } from "../util/tel.js"
${CADEIA("createProject({ args })").replace("options.logger || defaultLogger", "options.logger || outro")}
`)
  t.after(() => cleanupTmp(f.root))
  mkdirSync(path.join(f.root, "src", "util"), { recursive: true })
  writeFileSync(path.join(f.root, "src", "util", "tel.js"), "export const outro = { warn(m) { return m } }\n")
  const p = (await analisar(f)).find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "unknown", "o fallback é alcançado, mas aponta para fora do módulo")
})

test("CONTROLE: DESTRUCTURING com renome continua rastreável, sem renome opaco", async (t) => {
  const f = fixture(CADEIA("createProject({ args })").replace(
    "const c = resolveCreateCtx(options)\n  emitir(c.logger)",
    "const { logger } = resolveCreateCtx(options)\n  emitir(logger)"))
  t.after(() => cleanupTmp(f.root))
  const p = (await analisar(f)).find((x) => x.callee === "logger.warn")
  assert.equal(p.audience, "public_diagnostic", "destructuring de propriedade estática é rastreável")
})

// ── O alvo, medido no arquivo real ──────────────────────────────────────────

/**
 * ALVO real, com o resultado que a análise de fato sustenta.
 *
 * 73 dos 78 pontos de `logger.*` resolvem. Os 5 restantes NÃO são lacuna da
 * capacidade: `safeDownloadAndRun` não tem um único chamador no arquivo — é
 * código inalcançável —, e `fetchRemoteScript` só é chamado por ela. Sem
 * chamador não há origem observada, e `unresolved` ali é o veredito correto.
 * Afirmar 78/78 exigiria inventar uma prova que não existe.
 */
test("ALVO: `create.js` real resolve 73 dos 78 pontos de `logger.*`", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer(["src/cli/create.js", "src/cli/index.js", "src/cli/diagnostic-logger.js"])
  const doLogger = analyzeFile("src/cli/create.js", a).filter((p) => String(p.callee).startsWith("logger."))
  const emUnknown = doLogger.filter((p) => p.audience === "unknown")

  assert.equal(doLogger.length, 78)
  assert.equal(emUnknown.length, 5, "73 resolvidos; os 5 restantes estão em código sem chamador")

  const funcoes = [...new Set(emUnknown.map((p) => p.functions[p.functions.length - 1]))].sort()
  assert.deepEqual(funcoes, ["fetchRemoteScript", "safeDownloadAndRun"],
    "os únicos abertos são os do ramo inalcançável — outra função aqui é regressão")
})

/**
 * A distinção que o adapter formaliza, verificada no arquivo real: o que resolve
 * os pontos é o BINDING do adapter canônico, não o nome `logger`. Cada perímetro
 * por onde um logger entra normaliza — e um helper que recebesse objeto sem
 * passar por ali continuaria aberto.
 */
test("ALVO: create.js cai para 13 unknown, e todo perímetro normaliza", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const a = createAnalyzer(["src/cli/create.js", "src/cli/index.js", "src/cli/diagnostic-logger.js"])
  assert.equal(analyzeFile("src/cli/create.js", a).filter((p) => p.audience === "unknown").length, 13)

  const fonte = readFileSync(path.join(repoRoot, "src", "cli", "create.js"), "utf8")
  for (const exportada of ["rotateCasdoorCredential", "startCasdoor", "scaffoldVerticalTemplate"]) {
    assert.match(fonte, new RegExp(`export function ${exportada}\\([^)]*rawLogger`),
      `${exportada} recebe logger de chamador arbitrário e precisa normalizá-lo na entrada`)
  }
  assert.equal((fonte.match(/normalizeDiagnosticLogger\(/g) || []).length, 4,
    "createRuntime mais as três exportadas — um por perímetro de entrada")
})
