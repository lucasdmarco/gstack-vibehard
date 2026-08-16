import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

/**
 * REGRAS DO PYTHON DE SUBPROCESSO DE CLI (`cli_subprocess`).
 *
 * A fronteira derivada trouxe `src/context-docs/py/context_db.py` para dentro do
 * inventario. Classifica-lo com `HOOK_RULES` teria sido o caminho curto e
 * errado: aquela lista diz, com todas as letras, que "stdout de hook e o canal
 * do protocolo com o harness". Aqui nao ha harness. Quem executa e o GStack, e
 * quem le o stdout e o usuario — `context.js` captura a saida do indexer e a
 * encaminha crua ou a reparseia.
 *
 * A INVERSAO E O CONTEUDO DESTA FATIA: em hook, stdout e protocolo por padrao;
 * em subprocesso de CLI, stdout e superficie de leitura por padrao. Duas listas
 * porque sao duas perguntas — e ha teste abaixo fixando que a MESMA entrada
 * recebe respostas OPOSTAS nas duas.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-inventory.js"))}?t=${Date.now()}`)

// ── A separacao entre as duas especies ─────────────────────────────────────

test("stdout: hook diz PROTOCOLO, subprocesso de CLI diz SUPERFICIE", async () => {
  const { classifyHookPoint, classifyCliSubprocessPoint } = await imp()
  assert.equal(classifyHookPoint({ sink: "stdout" }).audience, "machine_protocol")
  assert.equal(classifyCliSubprocessPoint({ sink: "print" }).audience, "public_diagnostic")
  // E o `print` de um hook continua sem regra la: a fatia nao mexeu naquela lista.
  assert.equal(classifyHookPoint({ sink: "print" }).audience, "unknown")
})

test("as duas listas sao disjuntas em identidade de regra", async () => {
  const { hookRules, cliSubprocessRules } = await imp()
  const ids = new Set(hookRules().map((r) => r.id))
  for (const r of cliSubprocessRules()) {
    assert.ok(!ids.has(r.id), `regra ${r.id} nao pode existir nas duas listas`)
  }
})

// ── As portas de `CLI_RULES` ───────────────────────────────────────────────

const cli = async (ctx) => (await imp()).classifyCliSubprocessPoint(ctx)

test("POSITIVO: `print` de prosa e superficie publica de leitura", async () => {
  const r = await cli({ sink: "print" })
  assert.equal(r.audience, "public_diagnostic")
  assert.equal(r.rule, "cli-stdout-surface")
})

test("POSITIVO: `print` de serializacao pura e contrato de maquina", async () => {
  const r = await cli({ sink: "print", payloadIsSerialized: true })
  assert.equal(r.audience, "machine_protocol")
  assert.equal(r.rule, "cli-stdout-serialized")
})

/**
 * A PORTA QUE DECIDE, e ela e sobre a forma CONDICIONAL da chamada.
 *
 * `print(json.dumps(out) if args.json else f"Indexados …")` emite payload OU uma
 * frase em portugues, conforme a flag. `payloadIsSerialized` so vale quando NAO
 * ha ramo humano na mesma chamada; sem isso, metade das vezes o usuario le uma
 * frase que a claim ja teria dado como contrato de maquina.
 */
test("NEGATIVO: serializacao COM ramo humano na mesma chamada fica na claim", async () => {
  const r = await cli({ sink: "print", payloadIsSerialized: false })
  assert.equal(r.audience, "public_diagnostic", "o ramo `else` e frase, e frase entra na claim")
})

test("POSITIVO: `json.dumps` como sink proprio e contrato, com consumidor ancorado", async () => {
  assert.equal((await cli({ sink: "json" })).rule, "cli-json-sink")
})

test("PORTA: guarda de debug vence a superficie de stdout", async () => {
  assert.equal((await cli({ sink: "print", guardedByDebug: true })).audience, "internal_debug")
})

test("PORTA: payload so de byte de controle nao e frase", async () => {
  assert.equal((await cli({ sink: "print", payloadIsControlChar: true })).audience, "terminal_control")
})

test("PORTA: stderr so entra com prefixo de canal ou em tratamento de falha", async () => {
  assert.equal((await cli({ sink: "stderr" })).audience, "unknown", "stderr solto nao se auto-declara")
  assert.equal((await cli({ sink: "stderr", channelPrefixed: true })).rule, "cli-stderr-prefixed")
  assert.equal((await cli({ sink: "stderr", insideExceptHandler: true })).rule, "cli-stderr-failure")
})

// ── Ancorado no repositorio real ───────────────────────────────────────────

const doIndexer = async () => {
  const { buildInventory } = await imp()
  return buildInventory({ repoRoot }).points
    .filter((p) => p.file.endsWith("context_db.py"))
    .sort((a, b) => a.line - b.line || a.sink.localeCompare(b.sink))
}

test("REPO: os 19 pontos do indexer estao TODOS classificados", async () => {
  const pts = await doIndexer()
  assert.equal(pts.length, 19)
  assert.equal(pts.filter((p) => p.audience === "unknown").length, 0)
})

/**
 * As frases que abriram a fatia, ancoradas por linha. Sao o motivo de o indexer
 * ter entrado no inventario: prosa escrita pelo GStack, que o usuario le, e que
 * nao era contada em lugar nenhum.
 */
test("REPO: a prosa do indexer entra na claim, e por linha", async () => {
  const pts = await doIndexer()
  for (const linha of [540, 542, 577, 579, 581, 605]) {
    const p = pts.find((x) => x.line === linha && x.sink === "print")
    assert.ok(p, `o ponto :${linha} precisa existir`)
    assert.equal(p.audience, "public_diagnostic", `:${linha} e frase que o usuario le`)
    assert.equal(p.classification, "in_scope")
  }
})

/**
 * As DUAS linhas ternarias do indexer, que sao o caso real da porta condicional.
 * Se a porta cair, elas viram contrato de maquina e o texto em portugues sai da
 * claim sem que ninguem perceba.
 */
test("REPO: as chamadas ternarias do indexer ficam na claim, nao viram protocolo", async () => {
  const pts = await doIndexer()
  for (const linha of [330, 552]) {
    const p = pts.find((x) => x.line === linha && x.sink === "print")
    assert.equal(p.audience, "public_diagnostic", `:${linha} tem ramo humano e pertence a claim`)
  }
})

test("REPO: as chamadas de serializacao pura do indexer sao protocolo", async () => {
  const pts = await doIndexer()
  for (const linha of [456, 537, 575, 602]) {
    const p = pts.find((x) => x.line === linha && x.sink === "print")
    assert.equal(p.audience, "machine_protocol", `:${linha} nao tem ramo humano`)
  }
})

/**
 * O aviso do graphify e stderr com prefixo de canal — mesma convencao dos hooks,
 * e a unica regra que as duas listas descrevem do mesmo jeito, porque o fato e o
 * mesmo nos dois casos.
 */
test("REPO: o aviso em stderr do indexer e diagnostico publico", async () => {
  const p = (await doIndexer()).find((x) => x.line === 324)
  assert.equal(p.sink, "stderr")
  assert.equal(p.rule, "cli-stderr-prefixed")
})

/**
 * O EFEITO NO CENSO, dito por inteiro: a cobertura cresceu 19 pontos REAIS e a
 * fila de investigacao NAO cresceu. Subir o total e descoberta; subir o unknown
 * seria divida — e nao houve.
 */
test("REPO: os 19 pontos novos entraram sem deixar residuo `unknown`", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  const doPy = inv.points.filter((p) => p.file.endsWith("context_db.py"))
  assert.equal(doPy.length, 19)
  assert.equal(inv.points.filter((p) => p.audience === "unknown" && p.file.endsWith(".py") && !p.file.startsWith("hooks/")).length, 0,
    "nenhum unknown novo veio do Python de CLI")
})

/**
 * DIVIDA DA FASE 2, declarada e nao disfarcada: as frases do indexer estao em
 * portugues. Contadas nao e traduzidas, e a distincao precisa sobreviver a
 * leitura do censo.
 */
test("REPO: a prosa contada do indexer segue em PT-BR — divida da Fase 2", async () => {
  const { readFileSync } = await import("node:fs")
  const linhas = readFileSync(path.join(repoRoot, "src/context-docs/py/context_db.py"), "utf-8").split(/\r?\n/)
  assert.match(linhas[539], /sem resultados/, "linha 540 e a frase que abriu a fatia")
  assert.match(linhas[551], /n[aã]o encontrada/, "linha 552 idem")
})
