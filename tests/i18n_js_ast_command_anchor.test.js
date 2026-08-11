import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * ANCORA FINA de consumidor — arquivo + comando + modo.
 *
 * O contrato anterior declarava consumidor por ARQUIVO. Isso e exato quando o
 * arquivo inteiro serve um comando so (`create.js`), e errado para modulo
 * COMPARTILHADO: `runtime-supervisor.js` e alcancado por `dev`, `stop`, `logs` e
 * `open`, e a prova de `--json` existe apenas para os dois primeiros. Declarar o
 * arquivo daria `machine_protocol` aos quatro — a mesma doenca da cobertura por
 * nome de sink, um nivel acima.
 *
 * A unidade de prova aqui identifica arquivo, comando canonico do DISPATCH,
 * modo/branch, consumidor e evidencia. O comando vem da cadeia de binding
 * (comando -> handler -> import -> arquivo), nunca do nome do arquivo.
 *
 * Cada regra vem com o caso hostil que precisa continuar `unknown`. Regra sem
 * homonimo nao esta provada — esta passando no caso que o autor imaginou.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const eng = () => import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs")).href)

/** Fixture com DISPATCH REAL: quatro comandos convergindo no mesmo arquivo. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-anchor-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  mkdirSync(path.join(root, "src", "commands"), { recursive: true })

  const canonical = path.join(root, "src", "cli", "index.js")
  writeFileSync(canonical, `
import { devCommand, stopCommand, logsCommand, openCommand } from "../commands/x.js"
export function info(msg) { console.log(msg) }
const DISPATCH = {
  dev: (a) => devCommand(a),
  stop: (a) => stopCommand(a),
  logs: (a) => logsCommand(a),
  open: (a) => openCommand(a),
}
`)

  const alvo = path.join(root, "src", "commands", "x.js")
  writeFileSync(alvo, `
export function devCommand(a) { emitirDev(a); emitirCompartilhado(a) }
export function stopCommand(a) { emitirStop(a) }
export function logsCommand(a) { emitirLogs(a); emitirCompartilhado(a) }
export function openCommand(a) { emitirOpen(a) }

function emitirDev(a) {
  if (a.includes("--json")) process.stdout.write(JSON.stringify({ ok: true }))
  else process.stdout.write("modo dev em texto\\n")
}
function emitirStop(a) {
  if (a.includes("--json")) process.stdout.write(JSON.stringify({ stopped: true }))
}
function emitirLogs(a) {
  if (a.includes("--json")) process.stdout.write(JSON.stringify({ logs: [] }))
}
function emitirOpen(a) {
  if (a.includes("--json")) process.stdout.write(JSON.stringify({ opened: true }))
}
function emitirCompartilhado(a) {
  if (a.includes("--json")) process.stdout.write(JSON.stringify({ shared: true }))
}
`)
  return { root, alvo, canonical }
}

const chave = (f) => String(f.alvo).replace(/\\/g, "/")

const analisar = async (f, ctx = {}) => {
  const { analyzeFile, createAnalyzer } = await eng()
  return analyzeFile(f.alvo, createAnalyzer([f.alvo, f.canonical]), ctx)
}

const prova = (command) => ({ command, mode: "--json", consumer: "json_purity_contract", evidence: "fixture: roda o CLI publico" })

/** Declaracao ancorada para `dev` e `stop` — e SO para eles. */
const ancorado = (f, commands) => ({ consumers: { [chave(f)]: { commands } } })

/** O ponto da funcao `nome`, no ramo indicado. */
const ponto = (pts, trecho) => pts.find((p) => p.__src?.includes(trecho))

/** Anexa o texto da linha para localizar o ponto sem depender de numero fixo. */
async function pontosAnotados(f, ctx) {
  const { readFileSync } = await import("node:fs")
  const linhas = readFileSync(f.alvo, "utf8").split("\n")
  return (await analisar(f, ctx)).map((p) => ({ ...p, __src: linhas[p.line - 1] ?? "" }))
}

// ── Derivacao: o comando sobrevive ao binding ────────────────────────────────

test("o comando canonico e derivado do DISPATCH por binding, nao pelo nome do arquivo", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const { entrypointsPorComando, createAnalyzer } = await eng()
  const a = createAnalyzer([f.alvo, f.canonical])
  const porArquivo = entrypointsPorComando(a.program, a.checker)
  const entradas = porArquivo.get(chave(f))
  assert.ok(entradas, "o arquivo alvo precisa ser alcancado pelo DISPATCH")
  assert.deepEqual(entradas.map((e) => e.command).sort(), ["dev", "logs", "open", "stop"])
  const dev = entradas.find((e) => e.command === "dev")
  assert.equal(dev.handler, "devCommand", "comando -> handler -> import -> arquivo")
})

test("REGRESSAO: `entrypointsCanonicos` continua devolvendo o mesmo Set de handlers", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const { entrypointsCanonicos, createAnalyzer } = await eng()
  const a = createAnalyzer([f.alvo, f.canonical])
  const set = entrypointsCanonicos(a.program, a.checker).get(chave(f))
  assert.deepEqual([...set].sort(), ["devCommand", "logsCommand", "openCommand", "stopCommand"])
})

test("cada ponto carrega os comandos que o alcancam", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const pts = await pontosAnotados(f, {})
  assert.deepEqual(ponto(pts, "{ ok: true }").commands, ["dev"])
  assert.deepEqual(ponto(pts, "{ stopped: true }").commands, ["stop"])
  assert.deepEqual(ponto(pts, "{ shared: true }").commands, ["dev", "logs"],
    "funcao compartilhada acumula as DUAS rotas")
})

// ── CONTROLE 1 e 2: positivo dev/stop, negativo logs/open no MESMO arquivo ───

test("POSITIVO dev/stop e NEGATIVO logs/open — no mesmo arquivo, com a mesma tabela", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const pts = await pontosAnotados(f, ancorado(f, [prova("dev"), prova("stop")]))

  assert.equal(ponto(pts, "{ ok: true }").audience, "machine_protocol", "dev --json e provado")
  assert.equal(ponto(pts, "{ stopped: true }").audience, "machine_protocol", "stop --json e provado")

  assert.equal(ponto(pts, "{ logs: [] }").audience, "unknown",
    "logs nao tem consumidor provado — nao pode herdar o de dev/stop")
  assert.equal(ponto(pts, "{ opened: true }").audience, "unknown",
    "open tampouco: mesmo arquivo nao e mesma prova")
})

// ── CONTROLE 3: consumidor de OUTRO arquivo nao cobre ────────────────────────

test("CONTROLE NEGATIVO: consumidor declarado para OUTRO arquivo nao cobre este", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const outro = { consumers: { "src/commands/outro.js": { commands: [prova("dev"), prova("stop")] } } }
  const pts = await pontosAnotados(f, outro)
  assert.deepEqual([...new Set(pts.map((p) => p.audience))], ["unknown"],
    "a chave do arquivo faz parte da unidade de prova")
})

// ── CONTROLE 4: entrada sem `command` nao cobre ──────────────────────────────

test("CONTROLE NEGATIVO: entrada sem `command` nao cobre nada", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const semComando = [{ mode: "--json", consumer: "json_purity_contract", evidence: "fixture" }]
  const pts = await pontosAnotados(f, ancorado(f, semComando))
  assert.equal(ponto(pts, "{ ok: true }").audience, "unknown",
    "declaracao que nao diz QUAL comando prova nao prova nenhum")
})

test("CONTROLE NEGATIVO: entrada sem `consumer` ou sem `evidence` nao cobre", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const semConsumer = [{ command: "dev", mode: "--json", evidence: "fixture" }]
  const semEvidence = [{ command: "dev", mode: "--json", consumer: "json_purity_contract" }]
  for (const decl of [semConsumer, semEvidence]) {
    const pts = await pontosAnotados(f, ancorado(f, decl))
    assert.equal(ponto(pts, "{ ok: true }").audience, "unknown",
      "as cinco partes da unidade de prova sao obrigatorias")
  }
})

// ── CONTROLE 5: prova de `--json` nao cobre saida humana ─────────────────────

test("CONTROLE NEGATIVO: prova de `--json` NAO cobre a saida humana do mesmo comando", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const pts = await pontosAnotados(f, ancorado(f, [prova("dev"), prova("stop")]))
  const humano = ponto(pts, "modo dev em texto")
  assert.deepEqual(humano.commands, ["dev"], "e o mesmo comando provado")
  assert.notEqual(humano.audience, "machine_protocol",
    "o ramo `else` de `if (--json)` e o caminho humano: a prova de maquina nao fala sobre ele")
})

// ── CONTROLE 6: rotas convergentes cobrem so a intersecao provada ────────────

test("CONTROLE NEGATIVO: duas rotas convergentes cobrem so a intersecao realmente provada", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const soDev = await pontosAnotados(f, ancorado(f, [prova("dev"), prova("stop")]))
  assert.equal(ponto(soDev, "{ shared: true }").audience, "unknown",
    "`dev` provado e `logs` nao: rodar `logs` executa essa escrita sem consumidor que a leia")

  const ambos = await pontosAnotados(f, ancorado(f, [prova("dev"), prova("logs")]))
  assert.equal(ponto(ambos, "{ shared: true }").audience, "machine_protocol",
    "com as DUAS rotas provadas a convergencia esta coberta — o criterio e universal, e alcancavel")
})

// ── Fail-closed estrutural ───────────────────────────────────────────────────

test("CONTROLE NEGATIVO: ponto fora de qualquer handler do DISPATCH continua unknown", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  // Sem DISPATCH no modulo canonico nao ha comando derivado: `commands` fica vazio.
  writeFileSync(f.canonical, `export function info(msg) { console.log(msg) }\n`)
  const pts = await pontosAnotados(f, ancorado(f, [prova("dev"), prova("stop")]))
  assert.deepEqual([...new Set(pts.map((p) => p.audience))], ["unknown"])
  assert.deepEqual([...new Set(pts.map((p) => p.commands.length))], [0],
    "sem rota provada nao ha o que casar — ausencia de prova, nao permissao")
})

// ── Requisito 7: o contrato file-scoped existente segue intacto ──────────────

test("REGRESSAO: o contrato file-scoped `{consumer, proof}` continua valendo para o arquivo", async (t) => {
  const f = fixture()
  t.after(() => cleanupTmp(f.root))
  const legado = { consumers: { [chave(f)]: { consumer: "teste", proof: "fixture" } } }
  const pts = await pontosAnotados(f, legado)
  assert.equal(ponto(pts, "{ ok: true }").audience, "machine_protocol",
    "quem ja declarava por arquivo nao muda de comportamento (`create.js`)")
  assert.equal(ponto(pts, "{ logs: [] }").audience, "machine_protocol",
    "a forma file-scoped cobre o arquivo INTEIRO — por isso modulo compartilhado exige a ancorada")
})
