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

// ── O arquivo está convertido, pelos artefatos oficiais ──────────────────────

test("o registry commitado declara src/cli/index.js convertido", () => {
  const r = lerJson("src/meta/i18n-js-registry.json")
  assert.deepEqual(r.convertedFiles, [ALVO])
  assert.ok(r.files[ALVO], "com entradas próprias")
  assert.match(r.files[ALVO].fileHash, /^sha256:[0-9a-f]{64}$/)
})

test("o inventário oficial consome o AST para o arquivo convertido", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.blocked, false)
  assert.deepEqual(inv.jsRegistry.convertedFiles, [ALVO])

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

test("o inventário global reflete a migração: 1918 pontos, 98 unknown", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })

  // 1924 − 6 falsos positivos que saíram da conta.
  assert.equal(inv.total, 1918)
  // 125 − 27 unknown que o arquivo tinha.
  assert.equal(inv.unknown, 98)
})

/**
 * SPILLOVER. A conversão de um arquivo não pode reclassificar ponto de outro. A
 * aritmética fechar não basta — dois erros opostos se cancelariam. Aqui a soma é
 * checada por arquivo, o que localiza qualquer deslocamento.
 */
test("SPILLOVER: os demais arquivos somam exatamente 1889 pontos", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  const outros = inv.points.filter((p) => p.file !== ALVO)

  assert.equal(outros.length, 1889, "nenhum ponto entrou ou saiu fora do alvo")
  assert.equal(outros.filter((p) => p.audience === "unknown").length, 98,
    "todos os `unknown` restantes estão FORA do arquivo migrado")
  assert.equal(outros.filter((p) => p.source === "ast_registry").length, 0,
    "nenhum outro arquivo foi convertido junto por acidente")
})

// ── Decisão de provenance: aplicada exatamente UMA vez ───────────────────────

test("a decisão de provenance é aplicada exatamente UMA vez, no callsite ancorado", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })

  assert.equal(inv.jsRegistry.provenanceDecisionsApplied, 1)

  const comDecisao = inv.points.filter((p) => p.provenanceDecision != null)
  assert.equal(comDecisao.length, 1, "uma decisão, um ponto")
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
  assert.deepEqual(overrides, [], "nenhum ponto exigiu decisão humana de audiência")
  assert.equal(inv.jsRegistry.overridesApplied, 0)
  assert.equal(inv.jsRegistry.overridesApplied, overrides.length,
    "o invariante vale nos dois lados, inclusive em zero")
})

// ── Gate ─────────────────────────────────────────────────────────────────────

test("o gate segue reprovando — pelos 98 unknown restantes, não por provenance", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const g = phase1Gate(buildInventory({ repoRoot }))

  assert.equal(g.ok, false)
  assert.equal(g.unknown, 98)
  assert.equal(g.provenanceOk, true, "a única pendência do arquivo migrado foi decidida")
  assert.equal(g.unresolvedProvenance, 0)
  assert.match(g.reason, /98 ponto/)
})

test("o registry commitado é EXATAMENTE o que o gerador emite (sem edição manual)", async () => {
  const gen = await import(`file:///${path.join(repoRoot, "scripts", "i18n-registry.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)
  const emDisco = readFileSync(path.join(repoRoot, "src/meta/i18n-js-registry.json"), "utf8").replace(/\r\n/g, "\n")
  const regerado = gen.serializar(gen.buildRegistry([...gen.CONVERTED_FILES], { root: repoRoot }))
  assert.equal(regerado, emDisco, "artefato gerado não pode divergir do gerador")
})
