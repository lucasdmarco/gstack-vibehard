import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeFileSync } from "node:fs"
import { buildInventory } from "../src/meta/i18n-inventory.js"
import { NONLINGUISTIC_VALUE_CATEGORIES, STRATEGY_BY_KIND, PROVENANCE_STRATEGIES } from "../src/meta/i18n-js-registry-loader.js"

/**
 * Conversão de `src/commands/monitor.js` — Fase 1B.
 *
 * Cada uma das 9 decisões de provenance foi escrita para UM callsite, com âncora
 * `file+line+column+expectedFileHash`, os identificadores que o gerador extraiu e
 * evidência específica. Não há override de audiência, de arquivo ou de diretório;
 * a audiência veio das regras estruturais do engine, e a provenance é a única
 * coisa decidida à mão.
 *
 * Os controles negativos abaixo mutilam a decisão real e exigem que o consumo
 * reprove. Um contrato de decisão humana sem eles é uma promessa: qualquer
 * afrouxamento passaria em silêncio, e o arquivo continuaria "convertido".
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ARQ = "src/commands/monitor.js"
const OVERRIDES = "src/meta/i18n-js-overrides.json"

const inventario = () => buildInventory({ root: repoRoot })
const overrides = () => JSON.parse(readFileSync(path.join(repoRoot, OVERRIDES), "utf8"))
const registry = () => JSON.parse(readFileSync(path.join(repoRoot, "src/meta/i18n-js-registry.json"), "utf8"))

const decisoesDe = (arquivo) => overrides().provenanceDecisions.filter((d) => d.file === arquivo)
const decisoesTodas = () => overrides().provenanceDecisions

/**
 * Consome um conjunto ADULTERADO de decisões pelo caminho REAL.
 *
 * O consumo acontece dentro de `buildInventory`, que lê do disco; testar por uma
 * função interna provaria a função, não o caminho que roda em produção. O arquivo
 * é restaurado no `finally`, sempre.
 */
const ABS_OVERRIDES = path.join(repoRoot, OVERRIDES)
async function consumirCom(decisoes) {
  const intacto = readFileSync(ABS_OVERRIDES, "utf8")
  try {
    writeFileSync(ABS_OVERRIDES, `${JSON.stringify({ ...overrides(), provenanceDecisions: decisoes }, null, 2)}\n`)
    return await buildInventory({ root: repoRoot })
  } finally {
    writeFileSync(ABS_OVERRIDES, intacto)
  }
}

// ── As quatro contagens do contrato ─────────────────────────────────────────

test("as quatro contagens do contrato conferem", async () => {
  const i = await inventario()
  // Global DERIVADO: o total cresce a cada arquivo do lote JS. O que este teste
  // guarda são as contagens DESTE arquivo (abaixo) e o invariante de que toda
  // decisão declarada é aplicada.
  assert.equal(i.jsRegistry.provenanceDecisionsApplied, decisoesTodas().length,
    "toda decisão declarada é aplicada — nenhuma anunciada sem efeito")
  assert.equal(decisoesDe(ARQ).length, 9, "declaradas para monitor.js")
  assert.equal(decisoesDe("src/cli/index.js").length, 1, "a decisão anterior segue declarada")
  assert.equal(i.provenance.count, 0, "`count` é a quantidade PENDENTE — zero é o alvo")
})

test("`monitor.js` está oficialmente em unknown:0 pelo inventário real", async () => {
  const i = await inventario()
  const pontos = i.points.filter((p) => String(p.file).replace(/\\/g, "/") === ARQ)
  assert.equal(i.blocked, false)
  assert.equal(pontos.length, 27)
  assert.equal(pontos.filter((p) => p.audience === "unknown").length, 0)
  assert.equal(i.provenance.missingProvenance, 0)
  assert.ok(registry().convertedFiles.includes(ARQ))
})

/**
 * A decisão anterior foi SOBRESCRITA durante a inserção das nove e recuperada do
 * HEAD. O episódio vira teste: ela precisa continuar byte a byte a que estava
 * versionada, senão a recuperação teria sido aproximada.
 */
test("a decisão preexistente de cli/index.js:304 permanece byte a byte", () => {
  const antiga = execFileSync("git", ["show", "HEAD:src/meta/i18n-js-overrides.json"], { cwd: repoRoot, encoding: "utf8" })
  const original = JSON.parse(antiga).provenanceDecisions.find((d) => d.file === "src/cli/index.js")
  const atual = decisoesDe("src/cli/index.js")[0]
  assert.deepEqual(atual, original, "a decisão anterior não pode ter sido reescrita nem normalizada")
})

// ── Spillover: o efeito fora de monitor.js é conhecido e benigno ────────────

/**
 * `interpolation_only` mudou `src/cli/index.js:287` de `interpolated` para
 * `no_local_frame`. O ponto NÃO é in_scope, então a mudança de kind não cria
 * pendência — mas ela precisa estar registrada, e nada além do kind pode variar.
 */
test("o spillover em cli/index.js:287 muda o kind e MAIS NADA", async () => {
  const i = await inventario()
  const p = i.points.find((x) => String(x.file).includes("cli/index.js") && x.line === 287)
  assert.ok(p, "o ponto precisa continuar existindo")
  assert.equal(p.audience, "render_primitive", "a audiência não muda")
  assert.equal(p.classification, "out_of_scope", "a classificação não muda")
  assert.equal(p.provenance.kind, "no_local_frame", "só o kind muda")

  const noPonto = overrides().provenanceDecisions.filter((d) => d.file === "src/cli/index.js" && d.line === 287)
  assert.equal(noPonto.length, 0, "nenhuma decisão nova foi aplicada nesse ponto")
})

test("nenhuma decisão ou override é aplicado fora dos arquivos convertidos", () => {
  const o = overrides()
  const convertidos = new Set(registry().convertedFiles)
  for (const d of o.provenanceDecisions) {
    assert.ok(convertidos.has(d.file), `decisão em arquivo não convertido: ${d.file}`)
  }
  assert.deepEqual(o.overrides ?? [], [], "nenhum override de audiência foi criado para cumprir contagem")
})

// ── Sete controles negativos ────────────────────────────────────────────────

const real = () => decisoesDe(ARQ)[0]
const realNaoLinguistica = () => decisoesDe(ARQ).find((d) => d.strategy === "preserve_nonlinguistic_dynamic_values")
const semAPrimeira = () => overrides().provenanceDecisions.filter((d) => d !== undefined && !(d.file === ARQ && d.line === real().line))

/**
 * DECISÃO AUSENTE bloqueia por `unresolvedProvenance`, não por `corrupt`: o
 * registry continua íntegro; o que falta é a decisão humana. Tratar isso como
 * corrupção diria que o artefato está quebrado quando o que falta é trabalho.
 */
test("CONTROLE 1: decisão AUSENTE bloqueia por unresolvedProvenance, não como corrupt", async () => {
  const r = await consumirCom(semAPrimeira())
  assert.notEqual(r.jsRegistry?.status, "corrupt", "o registry não está corrompido — falta decisão")
  assert.ok(r.provenance.count > 0 || r.provenance.missingProvenance > 0,
    "o ponto sem decisão precisa reaparecer como pendente")
  assert.ok(r.provenance.points.some((p) => p.line === real().line))
})

const corrompe = (mut) =>
  consumirCom(overrides().provenanceDecisions.map((d) => (d.file === ARQ && d.line === real().line ? mut({ ...d }) : d)))

test("CONTROLE 2: `expectedFileHash` errado bloqueia como corrupt", async () => {
  const r = await corrompe((d) => ({ ...d, expectedFileHash: `sha256:${"0".repeat(64)}` }))
  assert.equal(r.jsRegistry.status, "corrupt")
  assert.match(r.jsRegistry.reason, /expectedFileHash/)
})

test("CONTROLE 3: coluna errada bloqueia como corrupt", async () => {
  const r = await corrompe((d) => ({ ...d, column: d.column + 7 }))
  assert.equal(r.jsRegistry.status, "corrupt")
  assert.match(r.jsRegistry.reason, /nenhum callsite/,
    "âncora por linha só atingiria a chamada errada em silêncio; a coluna é parte da identidade")
})

test("CONTROLE 4: IDs divergentes bloqueiam como corrupt", async () => {
  const r = await corrompe((d) => ({ ...d, interpolations: [...d.interpolations, "idInventado"] }))
  assert.equal(r.jsRegistry.status, "corrupt")
  assert.match(r.jsRegistry.reason, /interpola/i,
    "se o código ganhar uma interpolação, a decisão deixa de cobrir a string inteira")
})

test("CONTROLE 5: estratégia incompatível com o `kind` bloqueia como corrupt", async () => {
  // O ponto real é `interpolated`; declarar a estratégia de "sem moldura" nele
  // seria dizer que a frase literal não existe.
  const r = await corrompe((d) => ({
    ...d,
    strategy: "preserve_nonlinguistic_dynamic_values",
    values: Object.fromEntries(d.interpolations.map((id) => [id, { category: "identifier", origin: "inventado" }])),
  }))
  assert.equal(r.jsRegistry.status, "corrupt")
  assert.match(r.jsRegistry.reason, /incompat|kind/i)
})

test("CONTROLE 6: decisão DUPLICADA para o mesmo callsite bloqueia como corrupt", async () => {
  const d = real()
  const r = await consumirCom([...overrides().provenanceDecisions, { ...d }])
  assert.equal(r.jsRegistry.status, "corrupt")
})

/**
 * O controle mais importante da estratégia nova. Prosa não basta: sem metadado
 * por valor, `preserve_nonlinguistic_dynamic_values` seria a porta para declarar
 * qualquer coisa não-traduzível com um parágrafo convincente.
 */
test("CONTROLE 7: valor potencialmente LINGUÍSTICO não pode usar a estratégia", async () => {
  const alvo = realNaoLinguistica()
  const trocar = (values) => consumirCom(
    overrides().provenanceDecisions.map((d) => (d.line === alvo.line && d.file === ARQ ? { ...d, values } : d)))

  const comHumano = await trocar({ ...alvo.values, id: { category: "human_text", origin: "texto do usuário" } })
  assert.equal(comHumano.jsRegistry.status, "corrupt")
  assert.match(comHumano.jsRegistry.reason, /category/i, "`human_text` não está na lista fechada")

  const comUnknown = await trocar({ ...alvo.values, id: { category: "unknown", origin: "não sei" } })
  assert.equal(comUnknown.jsRegistry.status, "corrupt", "`unknown` tampouco: não saber é motivo para NÃO preservar")

  const semCampo = await trocar({ ...alvo.values, id: { origin: "sem categoria" } })
  assert.equal(semCampo.jsRegistry.status, "corrupt", "campo ausente reprova")

  const semOrigem = await trocar({ ...alvo.values, id: { category: "identifier", origin: "" } })
  assert.equal(semOrigem.jsRegistry.status, "corrupt", "origem vazia é prosa ausente, não prova")

  const incompleto = { ...alvo.values }
  delete incompleto.id
  assert.equal((await trocar(incompleto)).jsRegistry.status, "corrupt", "id sem entrada reprova — cobertura é comparada id a id")
})

// ── Contrato da estratégia nova ─────────────────────────────────────────────

test("a estratégia não-linguística tem lista FECHADA e mapeamento por kind", () => {
  assert.deepEqual([...NONLINGUISTIC_VALUE_CATEGORIES], ["glyph", "identifier", "control"])
  for (const proibida of ["human_text", "unknown", "text", "any"]) {
    assert.ok(!NONLINGUISTIC_VALUE_CATEGORIES.includes(proibida), `\`${proibida}\` não pode ser categoria preservável`)
  }
  assert.deepEqual([...STRATEGY_BY_KIND.interpolated], ["translate_literal_frame_preserve_interpolations"],
    "havendo moldura literal a tradução é do próprio callsite — não há segunda opção")
  // `no_local_frame` passou a aceitar DUAS por decisão humana explícita: o caso
  // "não tem moldura E o valor é prosa" não cabia em nenhuma das anteriores sem
  // mentir na categoria. As duas se excluem pelo que a decisão consegue provar —
  // categoria fechada por valor, ou origem ancorada — e nunca por preferência.
  assert.deepEqual([...STRATEGY_BY_KIND.no_local_frame].sort(),
    ["preserve_nonlinguistic_dynamic_values", "translate_at_value_origin"])
  assert.equal(PROVENANCE_STRATEGIES.length, 3,
    "três estratégias; uma quarta exigiria decisão explícita, como esta terceira exigiu")
})

test("só UM ponto usa a estratégia não-linguística, e ele tem values completo", () => {
  const usos = decisoesDe(ARQ).filter((d) => d.strategy === "preserve_nonlinguistic_dynamic_values")
  assert.equal(usos.length, 1, "a estratégia é exceção provada, não regime")
  const d = usos[0]
  assert.deepEqual(Object.keys(d.values).sort(), [...d.interpolations].sort())
  for (const [id, v] of Object.entries(d.values)) {
    assert.ok(NONLINGUISTIC_VALUE_CATEGORIES.includes(v.category), `\`${id}\` com categoria fora da lista`)
    assert.ok(v.origin.includes("monitor.js"), `\`${id}\` sem origem ancorada em arquivo:linha`)
  }
})

test("as 9 decisões são ancoradas, distintas e específicas", () => {
  const ds = decisoesDe(ARQ)
  const hash = registry().files[ARQ].fileHash
  const chaves = new Set()
  for (const d of ds) {
    assert.equal(d.expectedFileHash, hash, "toda decisão ancora no hash congelado do arquivo")
    assert.ok(d.reason.length > 60 && d.evidence.includes("monitor.js"), "razão e evidência precisam ser específicas do callsite")
    const k = `${d.line}:${d.column}`
    assert.ok(!chaves.has(k), `âncora duplicada: ${k}`)
    chaves.add(k)
  }
  assert.equal(ds.filter((d) => d.strategy === "translate_literal_frame_preserve_interpolations").length, 8)
})
