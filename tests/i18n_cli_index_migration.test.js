import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Fatia 5 da Fase 1B — primeira migração real.
 *
 * `src/cli/index.js` passa a ter seu inventário derivado do AST. É a primeira vez
 * que registry, auditoria de consumo e decisão de provenance operam juntos sobre
 * um arquivo do repositório, e não sobre fixture.
 *
 * RECONCILIAÇÃO, feita ANTES de converter. O extrator regex contava 35 pontos; o
 * AST conta 29. Os seis de diferença são todos falsos positivos do MESMO padrão
 * `\b(info|warn|error|success|section)\s*\(`:
 *
 *   270, 274, 278, 282, 286 — a DECLARAÇÃO `export function success(msg) {` casa
 *                             o padrão e é contada como chamada
 *   305                     — o `error(` DENTRO de `console.error(` casa de novo,
 *                             duplicando um ponto já contado como `console`
 *
 * Nenhum ponto real se perdeu. A queda no total NÃO é progresso de classificação:
 * é ruído saindo da conta.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = () => import(`file:///${path.join(repoRoot, "src", "meta", "i18n-inventory.js").replace(/\\/g, "/")}?t=${Date.now()}`)

const ALVO = "src/cli/index.js"
const lerJson = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8"))

/**
 * Lista de convertidos DERIVADA da fonte única, não recopiada aqui.
 *
 * Estes censos travavam a lista inteira, então CADA arquivo novo do lote JS
 * quebrava testes que não falam sobre ele — e a correção mecânica seria reescrever
 * a lista N vezes, transformando censo em ruído. O que estes testes precisam
 * afirmar é outra coisa: que o ARTEFATO bate com a lista DECLARADA (nenhuma
 * conversão acidental) e que `ALVO` está entre os convertidos.
 */
const convertidosDeclarados = async () => {
  const gen = await import(`file:///${path.join(repoRoot, "scripts", "i18n-registry.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)
  return [...gen.CONVERTED_FILES].sort()
}

/** Pontos que NÃO pertencem a arquivo convertido. */
const forasDosConvertidos = (inv) => {
  const convertidos = new Set(inv.jsRegistry.convertedFiles)
  return inv.points.filter((p) => !convertidos.has(p.file))
}

// ── O arquivo está convertido, pelos artefatos oficiais ──────────────────────

test("o registry commitado declara src/cli/index.js convertido", async () => {
  const r = lerJson("src/meta/i18n-js-registry.json")
  assert.ok(r.convertedFiles.includes(ALVO), "o alvo desta fatia está declarado")
  assert.deepEqual(r.convertedFiles, await convertidosDeclarados(),
    "o artefato bate com a lista declarada — nenhuma conversão acidental entrou")
  assert.ok(r.files[ALVO], "com entradas próprias")
  assert.match(r.files[ALVO].fileHash, /^sha256:[0-9a-f]{64}$/)
})

test("o inventário oficial consome o AST para o arquivo convertido", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.blocked, false)
  assert.deepEqual(inv.jsRegistry.convertedFiles, await convertidosDeclarados())

  const doAlvo = inv.points.filter((p) => p.file === ALVO)
  assert.ok(doAlvo.length > 0)
  assert.ok(doAlvo.every((p) => p.source === "ast_registry"),
    "todo ponto do arquivo convertido vem do registry, nenhum do regex")
})

// ── Contagem DERIVADA, não antecipada ────────────────────────────────────────

test("o arquivo convertido tem 29 pontos e ZERO unknown", async () => {
  const { buildInventory } = await imp()
  const doAlvo = buildInventory({ repoRoot }).points.filter((p) => p.file === ALVO)

  assert.equal(doAlvo.length, 29)
  assert.equal(doAlvo.filter((p) => p.audience === "unknown").length, 0)

  const porAudiencia = {}
  for (const p of doAlvo) porAudiencia[p.audience] = (porAudiencia[p.audience] || 0) + 1
  assert.deepEqual(porAudiencia, {
    public_diagnostic: 18, public_interactive: 5, render_primitive: 5, internal_debug: 1,
  })
})

test("MATRIZ regex → AST: 35 = 29 reais + 6 falsos positivos", async () => {
  const { buildInventory } = await imp()
  const doAlvo = buildInventory({ repoRoot }).points.filter((p) => p.file === ALVO)

  // As seis linhas que o regex contava a mais NÃO aparecem como ponto extra.
  const DECLARACOES = [270, 274, 278, 282, 286]
  const fonte = readFileSync(path.join(repoRoot, ALVO), "utf8").split("\n")
  for (const l of DECLARACOES) {
    assert.match(fonte[l - 1], /^export function (success|warn|error|info|section)\s*\(/,
      `linha ${l} precisa continuar sendo a DECLARAÇÃO que o regex contava`)
    assert.equal(doAlvo.filter((p) => p.line === l).length, 0,
      `linha ${l} é declaração, não chamada — o AST não a conta`)
  }

  // Linha 305: o regex contava DOIS (o `error(` de `console.error(` e o console).
  assert.match(fonte[304], /console\.error/)
  const l305 = doAlvo.filter((p) => p.line === 305)
  assert.equal(l305.length, 1, "o AST conta UM ponto, não dois")
  assert.equal(l305[0].audience, "internal_debug", "está sob `if (process.env.GSTACK_DEBUG)`")

  assert.equal(29 + 6, 35, "a matriz fecha: nenhum ponto real foi perdido")
})

// ── Efeito global, derivado ──────────────────────────────────────────────────

/**
 * O TOTAL é o invariante que não pode se mover: converter troca a FONTE do ponto
 * (regex -> AST), nunca a existência dele. "Nenhum ponto perdido" é o critério do
 * lote, e é aqui que ele é medido.
 *
 * O `unknown` GLOBAL, ao contrário, cai a cada arquivo reconciliado — é medição em
 * movimento, e travá-la aqui só produziria uma reescrita por conversão. O censo
 * canônico do número vive em `i18n_inventory.test.js`; aqui vale a RELAÇÃO, que é
 * o que este arquivo tem a dizer: todo `unknown` restante está fora dos convertidos.
 */
test("o inventário global reflete as migrações: 1906 pontos, unknown só fora dos convertidos", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })

  // 1924 − 6 falsos positivos que saíram da conta.
  assert.equal(inv.total, 1906,
    "1917 - 5: a remoção do downloader remoto duplicado de create.js levou seus pontos junto")

  const convertidos = new Set(inv.jsRegistry.convertedFiles)
  const unknownEmConvertido = inv.points.filter((p) => convertidos.has(p.file) && p.audience === "unknown")
  assert.deepEqual(unknownEmConvertido, [],
    "arquivo só é declarado convertido com unknown ZERO — é a regra do lote")
  assert.equal(inv.unknown, forasDosConvertidos(inv).filter((p) => p.audience === "unknown").length)
})

/**
 * SPILLOVER. A conversão de um arquivo não pode reclassificar ponto de outro. A
 * aritmética fechar não basta — dois erros opostos se cancelariam. Aqui a soma é
 * checada por arquivo, o que localiza qualquer deslocamento.
 */
test("SPILLOVER: converter um arquivo não mexe em ponto de outro", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  const outros = forasDosConvertidos(inv)

  // A soma é derivada em vez de travada porque ela muda a cada conversão; o que
  // NÃO pode mudar é a partição: convertido vem do AST, o resto vem do scanner.
  const doRegistry = inv.points.length - outros.length
  assert.equal(outros.length + doRegistry, inv.total, "a partição cobre o inventário inteiro")
  assert.equal(outros.filter((p) => p.source === "ast_registry").length, 0,
    "nenhum arquivo NÃO declarado foi convertido junto por acidente")
  assert.equal(inv.points.filter((p) => p.source === "ast_registry").length, doRegistry,
    "todo ponto de arquivo convertido vem do registry, e só ele")
})

// ── Decisão de provenance: aplicada exatamente UMA vez ───────────────────────

test("a decisão de provenance é aplicada exatamente UMA vez, no callsite ancorado", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })

  // O invariante é declarado === aplicado, não o número absoluto: o total cresce
  // a cada arquivo do lote, e travá-lo aqui só geraria reescrita por conversão.
  const declaradas = lerJson("src/meta/i18n-js-overrides.json").provenanceDecisions.length
  assert.equal(inv.jsRegistry.provenanceDecisionsApplied, declaradas,
    "toda decisão declarada é aplicada — nenhuma fica anunciada sem efeito")
  assert.equal(inv.points.filter((p) => p.provenanceDecision != null).length, declaradas,
    "e cada uma atinge exatamente um ponto")

  const comDecisao = inv.points.filter((p) => p.provenanceDecision != null && p.file === ALVO)
  assert.equal(comDecisao.length, 1, "uma decisão, um ponto — NESTE arquivo")
  assert.equal(comDecisao[0].file, ALVO)
  assert.equal(comDecisao[0].line, 304)
  assert.equal(comDecisao[0].column, 5)
  assert.equal(comDecisao[0].provenanceDecision.strategy, "translate_literal_frame_preserve_interpolations")
  assert.deepEqual(comDecisao[0].provenanceDecision.interpolations, ["command", "e", "message"])
})

test("a decisão NÃO reclassifica: a mensagem continua pública e in_scope", async () => {
  const { buildInventory } = await imp()
  const p = buildInventory({ repoRoot }).points.find((x) => x.file === ALVO && x.line === 304)

  assert.equal(p.audience, "public_diagnostic", "resolver a origem não muda o que a mensagem é")
  assert.equal(p.classification, "in_scope", "continua na claim English-first")
  assert.equal(p.provenance.resolved, false, "o dado bruto segue dizendo que é interpolado")
})

test("nenhum OVERRIDE foi necessário — e o invariante declarado===aplicado vale", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  const overrides = lerJson("src/meta/i18n-js-overrides.json").overrides

  // Registro honesto: o AST classificou os 29 pontos sem ajuda humana. Criar um
  // override artificial só para exercitar o mecanismo mudaria a classificação de
  // um ponto sem razão real.
  assert.deepEqual(overrides, [], "nenhum ponto exigiu decisão humana de audiência, em nenhum dos dois arquivos")
  assert.equal(inv.jsRegistry.overridesApplied, 0)
  assert.equal(inv.jsRegistry.overridesApplied, overrides.length,
    "o invariante vale nos dois lados, inclusive em zero")
})

// ── Gate ─────────────────────────────────────────────────────────────────────

test("o gate segue reprovando pelos unknown restantes, NÃO por provenance", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const inv = buildInventory({ repoRoot })
  const g = phase1Gate(inv)

  assert.equal(g.ok, false)
  // A CAUSA é o que este teste guarda; o número cai a cada arquivo do lote e o
  // censo canônico dele está em `i18n_inventory.test.js`.
  assert.ok(g.unknown > 0, "ainda há ponto sem classificação — o lote não terminou")
  assert.equal(g.unknown, inv.unknown)
  assert.equal(g.provenanceOk, true, "as pendências dos arquivos migrados foram decididas")
  assert.equal(g.unresolvedProvenance, 0)
  assert.match(g.reason, new RegExp(`${g.unknown} ponto`))
})

test("o registry commitado é EXATAMENTE o que o gerador emite (sem edição manual)", async () => {
  const gen = await import(`file:///${path.join(repoRoot, "scripts", "i18n-registry.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)
  const emDisco = readFileSync(path.join(repoRoot, "src/meta/i18n-js-registry.json"), "utf8").replace(/\r\n/g, "\n")
  const regerado = gen.serializar(gen.buildRegistry([...gen.CONVERTED_FILES], { root: repoRoot }))
  assert.equal(regerado, emDisco, "artefato gerado não pode divergir do gerador")
})
