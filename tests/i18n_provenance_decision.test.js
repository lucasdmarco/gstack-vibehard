import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Fatia 4.2 — decisão de provenance, separada da audiência.
 *
 * O PROBLEMA QUE ISTO RESOLVE. A medição real de `src/cli/index.js` achou
 * exatamente 1 ponto `in_scope` com provenance não resolvida (linha 304):
 *
 *     error(`Falha ao executar '${command}': ${e.message}`)
 *
 * Não havia mecanismo legítimo para resolvê-lo. Um override muda O QUE a
 * mensagem é; não diz DE ONDE vem o argumento dela. Sem esta fatia, a única
 * saída seria reclassificar uma mensagem pública como `out_of_scope` só para o
 * gate ficar verde — comprando um verde falso.
 *
 * A decisão declara: a MOLDURA literal é traduzível, os valores interpolados
 * permanecem dinâmicos. E precisa provar que descreve ESTE callsite, com ESTE
 * conteúdo e EXATAMENTE estas interpolações.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = () => import(`file:///${path.join(repoRoot, "src", "meta", "i18n-inventory.js").replace(/\\/g, "/")}?t=${Date.now()}`)
const loader = () => import(`file:///${path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js").replace(/\\/g, "/")}?t=${Date.now()}`)
const gen = () => import(`file:///${path.join(repoRoot, "scripts", "i18n-registry.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)

const REG = "src/meta/i18n-js-registry.json"
const OVR = "src/meta/i18n-js-overrides.json"

/** Projeto com um arquivo convertido de verdade e decisões configuráveis. */
async function projeto(fonte, decisoes = [], overrides = []) {
  const { buildRegistry, serializar } = await gen()
  const root = mkdtempSync(path.join(tmpdir(), "gstack-decisao-"))
  mkdirSync(path.join(root, "src", "meta"), { recursive: true })
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "src", "cli", "index.js"), fonte)

  const reg = buildRegistry(["src/cli/index.js"], { root })
  writeFileSync(path.join(root, REG), serializar(reg))
  writeFileSync(path.join(root, OVR), JSON.stringify({
    schema: "gstack.i18n-js-overrides.v1", overrides, provenanceDecisions: decisoes,
  }, null, 2))

  const dados = reg.files["src/cli/index.js"]
  return { root, reg, hash: dados.fileHash, entries: dados.entries }
}

/** Fonte com um `error(...)` interpolado — o mesmo formato da linha 304 real. */
const FONTE = `export function error(m) { console.log(m) }
export function run(command, e) {
  error(\`Falha ao executar '\${command}': \${e.message}\`)
}
`

/** A entrada in_scope com provenance não resolvida do fixture. */
const pendenteDe = async (ctx) => {
  const { isInScope } = await imp()
  return ctx.entries.find((e) => isInScope(e.audience) && e.provenance.resolved === false)
}

const decisaoPara = (ctx, alvo, extra = {}) => ({
  file: "src/cli/index.js", line: alvo.line, column: alvo.column,
  expectedFileHash: ctx.hash,
  strategy: "translate_literal_frame_preserve_interpolations",
  interpolations: [...alvo.provenance.ids],
  reason: "A moldura literal é traduzível; os valores interpolados são de runtime.",
  owner: "lucas",
  evidence: "tests/i18n_provenance_decision.test.js",
  ...extra,
})

// ── O caso que motivou a fatia ───────────────────────────────────────────────

test("SEM decisão: ponto in_scope interpolado bloqueia o gate", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const ctx = await projeto(FONTE)
  try {
    const inv = buildInventory({ repoRoot: ctx.root })
    assert.equal(inv.provenance.ok, false)
    assert.equal(inv.provenance.count, 1)
    assert.equal(phase1Gate(inv).ok, false, "é a pendência real que a Fatia 5 precisa resolver")
  } finally { cleanupTmp(ctx.root) }
})

test("COM decisão validada: a pendência é resolvida SEM tocar na audiência", async () => {
  const { buildInventory } = await imp()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const ctx = await projeto(FONTE, [decisaoPara({ hash: base.hash }, alvo)])
  try {
    const inv = buildInventory({ repoRoot: ctx.root })
    assert.equal(inv.provenance.ok, true, "a decisão resolve")
    assert.equal(inv.jsRegistry.provenanceDecisionsApplied, 1)

    const p = inv.points.find((x) => x.line === alvo.line && x.column === alvo.column)
    assert.equal(p.audience, alvo.audience, "audiência INALTERADA — decisão de provenance não é override")
    assert.equal(p.classification, "in_scope", "continua na claim; nada foi comprado com reclassificação")
  } finally { cleanupTmp(ctx.root) }
})

test("a provenance ORIGINAL é preservada — a decisão fica ao lado, nunca por cima", async () => {
  const { buildInventory } = await imp()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const ctx = await projeto(FONTE, [decisaoPara({ hash: base.hash }, alvo)])
  try {
    const p = buildInventory({ repoRoot: ctx.root }).points
      .find((x) => x.line === alvo.line && x.column === alvo.column)

    assert.equal(p.provenance.resolved, false,
      "sobrescrever apagaria a evidência de que o argumento É interpolado")
    assert.equal(p.provenance.kind, "interpolated")
    assert.deepEqual(p.provenance.ids, alvo.provenance.ids)

    assert.equal(p.provenanceDecision.strategy, "translate_literal_frame_preserve_interpolations")
    assert.deepEqual(p.provenanceDecision.interpolations, alvo.provenance.ids)
    assert.equal(p.provenanceDecision.owner, "lucas")
    assert.ok(p.provenanceDecision.reason && p.provenanceDecision.evidence)
  } finally { cleanupTmp(ctx.root) }
})

/**
 * A primeira versão deste teste NÃO injetava `provenanceDecision` — afirmava que
 * "objeto solto não conta" e testava um ponto sem decisão nenhuma. Passava por
 * vacuidade, exatamente como o teste de alias que a Fatia 1.1 corrigiu.
 *
 * A revisão reproduziu o buraco real: qualquer objeto naquela propriedade fazia o
 * gate dar a pendência por resolvida.
 */
test("o gate só aceita resolução VALIDADA — decisão FORJADA no ponto é recusada", async () => {
  const { unresolvedProvenance } = await imp()
  const pontoBase = {
    file: "a.js", line: 1, column: 1, classification: "in_scope", source: "ast_registry",
    provenance: { resolved: false, kind: "interpolated", ids: ["x"] },
  }

  // Objeto forjado com a MESMA forma de uma decisão legítima.
  const forjada = {
    strategy: "translate_literal_frame_preserve_interpolations",
    interpolations: ["x"], reason: "r", owner: "o", evidence: "e",
  }
  const comForjada = unresolvedProvenance({ points: [{ ...pontoBase, provenanceDecision: forjada }] })
  assert.equal(comForjada.ok, false, "forma correta não é prova de validação")
  assert.equal(comForjada.points[0].reason, "unvalidated_decision")

  // Nem uma flag textual imitando a marca funciona: a marca é um Symbol privado.
  const comFlag = unresolvedProvenance({
    points: [{ ...pontoBase, provenanceDecision: { ...forjada, validated: true, __validated: true } }],
  })
  assert.equal(comFlag.ok, false, "flag copiável seria tão forjável quanto a presença da propriedade")

  // Sem decisão nenhuma continua sendo pendência comum.
  const semDecisao = unresolvedProvenance({ points: [pontoBase] })
  assert.equal(semDecisao.ok, false)
  assert.equal(semDecisao.points[0].reason, "interpolated")
})

test("decisão que passou pelo loader carrega a marca; a serializada por JSON perde", async () => {
  const { buildInventory, decisaoValidada } = await imp()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const ctx = await projeto(FONTE, [decisaoPara(base, alvo)])
  try {
    const p = buildInventory({ repoRoot: ctx.root }).points
      .find((x) => x.line === alvo.line && x.column === alvo.column)
    assert.equal(decisaoValidada(p), true, "veio do loader")

    // Round-trip por JSON: a marca não sobrevive, e o ponto volta a bloquear.
    const reconstruido = JSON.parse(JSON.stringify(p))
    assert.equal(decisaoValidada(reconstruido), false, "fail-closed por construção")
  } finally { cleanupTmp(ctx.root) }
})

// ── P0: provenance HOSTIL no registry não pode derrubar o loader ─────────────

test("NEGATIVO: provenance malformada no REGISTRY vira veredito, nunca crash", async () => {
  const { loadJsRegistry } = await loader()
  const { buildRegistry, serializar } = await gen()

  const hostis = [
    ["ids: 42", { resolved: false, kind: "interpolated", ids: 42 }],
    ["ids com número", { resolved: false, kind: "interpolated", ids: ["ok", 7] }],
    ["ids com vazio", { resolved: false, kind: "interpolated", ids: ["ok", "  "] }],
    ["resolved textual", { resolved: "false", kind: "interpolated", ids: [] }],
    ["kind inválido", { resolved: false, kind: "chutado", ids: [] }],
    ["provenance escalar", 42],
    ["provenance nula", null],
  ]

  for (const [rotulo, prov] of hostis) {
    const root = mkdtempSync(path.join(tmpdir(), "gstack-hostil-"))
    try {
      mkdirSync(path.join(root, "src", "meta"), { recursive: true })
      mkdirSync(path.join(root, "src", "cli"), { recursive: true })
      writeFileSync(path.join(root, "src/cli/index.js"), FONTE)

      const reg = buildRegistry(["src/cli/index.js"], { root })
      const dados = reg.files["src/cli/index.js"]
      dados.entries[0].provenance = prov
      writeFileSync(path.join(root, REG), serializar(reg))
      writeFileSync(path.join(root, OVR), JSON.stringify({
        schema: "gstack.i18n-js-overrides.v1", overrides: [],
        // Uma decisão presente é o que fazia o crash acontecer, em `[...ids]`.
        provenanceDecisions: [{
          file: "src/cli/index.js", line: dados.entries[0].line, column: dados.entries[0].column,
          expectedFileHash: dados.fileHash,
          strategy: "translate_literal_frame_preserve_interpolations",
          interpolations: ["x"], reason: "r", owner: "o", evidence: "e",
        }],
      }))

      let v
      assert.doesNotThrow(() => { v = loadJsRegistry({ repoRoot: root }) }, `${rotulo} NÃO pode lançar`)
      assert.equal(v.ok, false, `${rotulo} precisa bloquear`)
      assert.equal(v.status, "corrupt")
      assert.ok(v.reason.length > 10, `${rotulo}: motivo legível`)
    } finally { cleanupTmp(root) }
  }
})

// ── P0: declarado precisa ser CONSUMIDO ──────────────────────────────────────

test("NEGATIVO: convertedFile que o coletor não varre BLOQUEIA", async () => {
  const { buildInventory } = await imp()
  const { buildRegistry, serializar } = await gen()

  const root = mkdtempSync(path.join(tmpdir(), "gstack-naovarrido-"))
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    // `fora/` não está em src/, templates/ nem nos scripts alcançáveis.
    mkdirSync(path.join(root, "fora"), { recursive: true })
    writeFileSync(path.join(root, "fora/x.js"), FONTE)

    const reg = buildRegistry(["fora/x.js"], { root })
    writeFileSync(path.join(root, REG), serializar(reg))
    writeFileSync(path.join(root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1", overrides: [], provenanceDecisions: [],
    }))

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.blocked, true, "cobertura anunciada e não exercida é mentira do artefato")
    assert.equal(inv.jsRegistry.status, "corrupt")
    assert.match(inv.jsRegistry.reason, /não são varridos pelo inventário/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: decisão declarada e NÃO aplicada BLOQUEIA (era verde por ausência dos dois lados)", async () => {
  const { buildInventory } = await imp()
  const { buildRegistry, serializar } = await gen()

  const root = mkdtempSync(path.join(tmpdir(), "gstack-inerte-"))
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    mkdirSync(path.join(root, "fora"), { recursive: true })
    writeFileSync(path.join(root, "fora/x.js"), FONTE)

    const reg = buildRegistry(["fora/x.js"], { root })
    const dados = reg.files["fora/x.js"]
    const alvo = dados.entries.find((e) => e.provenance.resolved === false)
    writeFileSync(path.join(root, REG), serializar(reg))
    writeFileSync(path.join(root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1", overrides: [],
      provenanceDecisions: [{
        file: "fora/x.js", line: alvo.line, column: alvo.column,
        expectedFileHash: dados.fileHash,
        strategy: "translate_literal_frame_preserve_interpolations",
        interpolations: [...alvo.provenance.ids], reason: "r", owner: "o", evidence: "e",
      }],
    }))

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.blocked, true,
      "antes: declared 1, applied 0, provenance.ok true — verde porque nem a pendência nem a decisão foram vistas")
    assert.match(inv.jsRegistry.reason, /não são varridos|divergem das aplicadas/)
  } finally { cleanupTmp(root) }
})

// ── A marca nasce no LOADER, não em quem consome ─────────────────────────────

/**
 * A versão anterior criava o `Symbol` no INVENTÁRIO e o aplicava a qualquer
 * decisão recebida. Como `buildInventory` aceita `jsRegistry` por parâmetro, uma
 * decisão injetada — com estratégia inválida e campos vazios — ganhava a marca,
 * resolvia a provenance e liberava o gate. A marca provava "passei por esta
 * função", não "fui validada".
 */
/**
 * O bypass que sobrou depois de fechar as decisões: os OVERRIDES passavam pela
 * MESMA porta. Um veredito fabricado, com override ancorado num callsite público
 * real, reclassificava a mensagem para `user_content`, mudava `in_scope` para
 * `out_of_scope`, dava `provenance.ok:true` e liberava o gate — sem `expectedFileHash`
 * válido e com `reason`/`owner`/`evidence` vazios.
 *
 * A prova de procedência agora é do VEREDITO INTEIRO, então uma verificação
 * cobre `byFile`, `overrides` e `provenanceDecisions`.
 */
test("NEGATIVO: OVERRIDE injetado e ancorado não reclassifica — veredito sem procedência", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const forjado = {
    ok: true, status: "fresh", convertedFiles: [], byFile: new Map(),
    overrides: [{
      file: "src/cli/index.js", line: 304, column: 5, audience: "user_content",
      reason: "", owner: "", evidence: "", expectedFileHash: "invalido",
    }],
    provenanceDecisions: [],
  }
  const inv = buildInventory({ repoRoot, jsRegistry: forjado })
  assert.equal(inv.blocked, true, "override que não passou pelo loader não pode reclassificar")
  assert.equal(inv.jsRegistry.status, "corrupt")
  assert.match(inv.jsRegistry.reason, /sem procedência de `loadJsRegistry`/)
  assert.deepEqual(inv.points, [], "nada é aplicado a partir de veredito sem procedência")
  assert.equal(phase1Gate(inv).ok, false)
})

test("NEGATIVO: DECISÃO injetada e ancorada não resolve a provenance", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const forjado = {
    ok: true, status: "fresh", convertedFiles: [], byFile: new Map(), overrides: [],
    provenanceDecisions: [{
      file: "src/cli/index.js", line: 304, column: 5,
      strategy: "inventada", interpolations: [], reason: "", owner: "", evidence: "",
    }],
  }
  const inv = buildInventory({ repoRoot, jsRegistry: forjado })
  assert.equal(inv.blocked, true)
  assert.match(inv.jsRegistry.reason, /sem procedência de `loadJsRegistry`/)
  assert.equal(phase1Gate(inv).ok, false)
})

test("NEGATIVO: CÓPIA do veredito legítimo perde a marca", async () => {
  const { buildInventory } = await imp()
  const { loadJsRegistry, isValidatedRegistry } = await loaderCanonico()
  const ctx = await projeto(FONTE)
  try {
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(isValidatedRegistry(v), true, "o original tem procedência")

    // Spread preserva todos os campos — e nenhum deles carrega a prova.
    const copia = { ...v }
    assert.equal(isValidatedRegistry(copia), false,
      "a associação vive FORA do objeto: não há o que copiar")

    const inv = buildInventory({ repoRoot: ctx.root, jsRegistry: copia })
    assert.equal(inv.blocked, true, "cópia idêntica não herda confiança")
    assert.match(inv.jsRegistry.reason, /sem procedência/)
  } finally { cleanupTmp(ctx.root) }
})

/**
 * Usa o loader CANÔNICO, sem cache-busting. `loader()` com `?t=` cria outra
 * instância do módulo, com outro `WeakSet` — e o inventário importa sempre a
 * canônica. Cruzar as duas faria o veredito legítimo parecer sem procedência,
 * que é ruído do teste, não do código. Em produção há uma instância só.
 */
const loaderCanonico = () => import(`file:///${path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js").replace(/\\/g, "/")}`)

test("POSITIVO: o veredito ORIGINAL do loader aplica override e decisão normalmente", async () => {
  const { buildInventory } = await imp()
  const { loadJsRegistry } = await loaderCanonico()

  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  const outro = base.entries.find((e) => e.line !== alvo.line || e.column !== alvo.column)
  cleanupTmp(base.root)

  const ctx = await projeto(
    FONTE,
    [decisaoPara(base, alvo)],
    [{
      file: "src/cli/index.js", line: outro.line, column: outro.column,
      audience: "internal_debug", reason: "decisão real", owner: "lucas",
      evidence: "tests/i18n_provenance_decision.test.js", expectedFileHash: base.hash,
    }],
  )
  try {
    // Caminho normal: `buildInventory` chama o loader por dentro.
    const inv = buildInventory({ repoRoot: ctx.root })
    assert.equal(inv.blocked, false, "o caminho legítimo continua funcionando")
    assert.equal(inv.jsRegistry.overridesApplied, 1)
    assert.equal(inv.jsRegistry.provenanceDecisionsApplied, 1)
    assert.equal(inv.provenance.ok, true)

    // E o veredito do loader, passado explicitamente, é aceito por ser o MESMO objeto.
    const v = loadJsRegistry({ repoRoot: ctx.root })
    const comVeredito = buildInventory({ repoRoot: ctx.root, jsRegistry: v })
    assert.equal(comVeredito.blocked, false, "a referência original tem procedência")
    assert.equal(comVeredito.jsRegistry.overridesApplied, 1)
  } finally { cleanupTmp(ctx.root) }
})

// ── Arquivo VISITADO, não "sem pontos" ───────────────────────────────────────

/**
 * `semPontos` tratava qualquer `convertedFile` com `entries: []` como consumido.
 * Mas "zero pontos" tem duas causas indistinguíveis pelo resultado: varrido e
 * sem saída, ou nunca varrido. Só o conjunto de visitados as separa.
 */
test("NEGATIVO: arquivo VAZIO fora da coleta BLOQUEIA (era aceito por ter zero entradas)", async () => {
  const { buildInventory } = await imp()
  const { buildRegistry, serializar } = await gen()

  const root = mkdtempSync(path.join(tmpdir(), "gstack-otheremptyjs-"))
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    mkdirSync(path.join(root, "other"), { recursive: true })
    // Zero pontos E fora de src/, templates/ e scripts alcançáveis.
    writeFileSync(path.join(root, "other/empty.js"), `export const x = 1\n`)

    const reg = buildRegistry(["other/empty.js"], { root })
    assert.equal(reg.files["other/empty.js"].entries.length, 0, "o fixture precisa ter zero pontos")
    writeFileSync(path.join(root, REG), serializar(reg))
    writeFileSync(path.join(root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1", overrides: [], provenanceDecisions: [],
    }))

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.blocked, true, "zero pontos não prova visita")
    assert.match(inv.jsRegistry.reason, /não são varridos pelo inventário/)
    assert.deepEqual(inv.jsRegistry.details.files, ["other/empty.js"])
  } finally { cleanupTmp(root) }
})

// ── overrides também: declarado precisa ser aplicado ─────────────────────────

/**
 * Override declarado que nunca casa é tão enganoso quanto decisão inerte. Aqui o
 * arquivo é convertido e o override é legítimo, mas o arquivo vive FORA da coleta
 * — então nada é aplicado. Passa pelo loader REAL, sem injeção.
 */
test("NEGATIVO: override em arquivo fora da coleta BLOQUEIA (via loader real)", async () => {
  const { buildInventory } = await imp()
  const { buildRegistry, serializar } = await gen()

  const root = mkdtempSync(path.join(tmpdir(), "gstack-ovinerte-"))
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    mkdirSync(path.join(root, "fora"), { recursive: true })
    writeFileSync(path.join(root, "fora/x.js"), FONTE)

    const reg = buildRegistry(["fora/x.js"], { root })
    const dados = reg.files["fora/x.js"]
    writeFileSync(path.join(root, REG), serializar(reg))
    writeFileSync(path.join(root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1",
      overrides: [{
        file: "fora/x.js", line: dados.entries[0].line, column: dados.entries[0].column,
        audience: "internal_debug", reason: "r", owner: "o", evidence: "e",
        expectedFileHash: dados.fileHash,
      }],
      provenanceDecisions: [],
    }))

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.blocked, true)
    assert.match(inv.jsRegistry.reason, /não são varridos pelo inventário|divergem d/)
  } finally { cleanupTmp(root) }
})

// ── Coerência semântica da provenance ────────────────────────────────────────

test("NEGATIVO: provenance semanticamente INCOERENTE BLOQUEIA", async () => {
  const { loadJsRegistry } = await loader()
  const { buildRegistry, serializar } = await gen()

  const incoerentes = [
    ["literal_only com resolved:false", { resolved: false, kind: "literal_only", ids: [] }, /literal_only.*resolved:true/],
    ["literal_only com ids", { resolved: true, kind: "literal_only", ids: ["x"] }, /literal_only.*ids` vazio/],
    ["interpolated com resolved:true", { resolved: true, kind: "interpolated", ids: ["x"] }, /interpolated.*resolved:false/],
    ["interpolated sem ids", { resolved: false, kind: "interpolated", ids: [] }, /interpolated.*ao menos um id/],
  ]

  for (const [rotulo, prov, re] of incoerentes) {
    const root = mkdtempSync(path.join(tmpdir(), "gstack-incoerente-"))
    try {
      mkdirSync(path.join(root, "src", "meta"), { recursive: true })
      mkdirSync(path.join(root, "src", "cli"), { recursive: true })
      writeFileSync(path.join(root, "src/cli/index.js"), FONTE)

      const reg = buildRegistry(["src/cli/index.js"], { root })
      reg.files["src/cli/index.js"].entries[0].provenance = prov
      writeFileSync(path.join(root, REG), serializar(reg))
      writeFileSync(path.join(root, OVR), JSON.stringify({
        schema: "gstack.i18n-js-overrides.v1", overrides: [], provenanceDecisions: [],
      }))

      const v = loadJsRegistry({ repoRoot: root })
      assert.equal(v.status, "corrupt", `${rotulo} precisa bloquear`)
      assert.match(v.reason, re, `${rotulo}: motivo`)
    } finally { cleanupTmp(root) }
  }
})

test("POSITIVO: as duas formas COERENTES são aceitas", async () => {
  const { loadJsRegistry } = await loader()
  const ctx = await projeto(FONTE)
  try {
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(v.ok, true, "o gerador real produz as duas formas e ambas precisam passar")
    const kinds = new Set(v.byFile.get("src/cli/index.js").map((e) => e.provenance.kind))
    assert.ok(kinds.has("literal_only") && kinds.has("interpolated"), `formas presentes: ${[...kinds]}`)
  } finally { cleanupTmp(ctx.root) }
})

test("CONTROLE POSITIVO: arquivo convertido SEM pontos não é falso não-consumido", async () => {
  const { buildInventory } = await imp()
  const { buildRegistry, serializar } = await gen()

  const root = mkdtempSync(path.join(tmpdir(), "gstack-vazio-"))
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    mkdirSync(path.join(root, "src", "util"), { recursive: true })
    writeFileSync(path.join(root, "src/util/puro.js"), `export const soma = (a, b) => a + b\n`)

    const reg = buildRegistry(["src/util/puro.js"], { root })
    assert.equal(reg.files["src/util/puro.js"].entries.length, 0, "o fixture precisa ter zero pontos")
    writeFileSync(path.join(root, REG), serializar(reg))
    writeFileSync(path.join(root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1", overrides: [], provenanceDecisions: [],
    }))

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.blocked, false, "zero pontos é resultado legítimo, não ausência de varredura")
  } finally { cleanupTmp(root) }
})

// ── Controles negativos: hash, âncora, identificadores ───────────────────────

test("NEGATIVO: `expectedFileHash` que não confere BLOQUEIA", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const ctx = await projeto(FONTE, [decisaoPara(base, alvo, { expectedFileHash: `sha256:${"0".repeat(64)}` })])
  try {
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /não confere — o arquivo mudou desde a decisão/)
  } finally { cleanupTmp(ctx.root) }
})

test("NEGATIVO: `expectedFileHash` malformado BLOQUEIA", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const ctx = await projeto(FONTE, [decisaoPara(base, alvo, { expectedFileHash: "nao-e-hash" })])
  try {
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /`expectedFileHash` malformado/)
  } finally { cleanupTmp(ctx.root) }
})

test("NEGATIVO: âncora inexistente BLOQUEIA (linha e coluna)", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  for (const extra of [{ line: 999 }, { column: 999 }]) {
    const ctx = await projeto(FONTE, [decisaoPara(base, alvo, extra)])
    try {
      const v = loadJsRegistry({ repoRoot: ctx.root })
      assert.equal(v.status, "corrupt", `${JSON.stringify(extra)} precisa bloquear`)
      assert.match(v.reason, /nenhum callsite em/)
    } finally { cleanupTmp(ctx.root) }
  }
})

/**
 * O controle mais importante da fatia: se o código ganhar uma interpolação nova,
 * a decisão humana deixa de cobrir a string inteira. Aceitar em silêncio faria
 * uma mensagem PARCIALMENTE analisada passar como decidida.
 */
test("NEGATIVO: identificadores DIVERGENTES do gerado BLOQUEIAM", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const divergentes = [
    ["faltando um", alvo.provenance.ids.slice(1)],
    ["sobrando um", [...alvo.provenance.ids, "inventado"]],
    ["trocado", alvo.provenance.ids.map((x, i) => (i === 0 ? "outro" : x))],
    ["vazio", []],
  ]
  for (const [rotulo, ids] of divergentes) {
    const ctx = await projeto(FONTE, [decisaoPara(base, alvo, { interpolations: ids })])
    try {
      const v = loadJsRegistry({ repoRoot: ctx.root })
      assert.equal(v.status, "corrupt", `${rotulo} precisa bloquear`)
      assert.match(v.reason, /interpolações divergem do gerado/)
    } finally { cleanupTmp(ctx.root) }
  }
})

test("POSITIVO: ordem diferente dos MESMOS identificadores é aceita", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const ctx = await projeto(FONTE, [decisaoPara(base, alvo, { interpolations: [...alvo.provenance.ids].reverse() })])
  try {
    assert.equal(loadJsRegistry({ repoRoot: ctx.root }).ok, true, "é conjunto, não sequência")
  } finally { cleanupTmp(ctx.root) }
})

// ── Forma, campos e estratégia ───────────────────────────────────────────────

test("NEGATIVO: estratégia desconhecida BLOQUEIA", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const ctx = await projeto(FONTE, [decisaoPara(base, alvo, { strategy: "traduz_tudo" })])
  try {
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /estratégia desconhecida/)
  } finally { cleanupTmp(ctx.root) }
})

test("NEGATIVO: reason, owner ou evidence vazios BLOQUEIAM", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  for (const campo of ["reason", "owner", "evidence"]) {
    const ctx = await projeto(FONTE, [decisaoPara(base, alvo, { [campo]: "   " })])
    try {
      const v = loadJsRegistry({ repoRoot: ctx.root })
      assert.equal(v.status, "corrupt", `${campo} vazio precisa bloquear`)
      assert.match(v.reason, new RegExp(`\`${campo}\` vazio`))
    } finally { cleanupTmp(ctx.root) }
  }
})

test("NEGATIVO: campo obrigatório ausente BLOQUEIA", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  for (const campo of ["file", "line", "column", "expectedFileHash", "strategy", "interpolations", "reason", "owner", "evidence"]) {
    const d = decisaoPara(base, alvo)
    delete d[campo]
    const ctx = await projeto(FONTE, [d])
    try {
      const v = loadJsRegistry({ repoRoot: ctx.root })
      assert.equal(v.status, "corrupt", `sem \`${campo}\` precisa bloquear`)
      assert.match(v.reason, new RegExp(`sem \`${campo}\``))
    } finally { cleanupTmp(ctx.root) }
  }
})

test("NEGATIVO: decisão sobre callsite JÁ resolvido BLOQUEIA (decisão desnecessária)", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  try {
    // Um ponto com literal puro — provenance já resolvida por construção.
    const resolvido = base.entries.find((e) => e.provenance.resolved === true)
    assert.ok(resolvido, "o fixture precisa ter um ponto resolvido")

    const ctx = await projeto(FONTE, [{
      file: "src/cli/index.js", line: resolvido.line, column: resolvido.column,
      expectedFileHash: base.hash,
      strategy: "translate_literal_frame_preserve_interpolations",
      interpolations: [], reason: "r", owner: "o", evidence: "e",
    }])
    try {
      const v = loadJsRegistry({ repoRoot: ctx.root })
      assert.equal(v.status, "corrupt")
      assert.match(v.reason, /já tem provenance resolvida/)
    } finally { cleanupTmp(ctx.root) }
  } finally { cleanupTmp(base.root) }
})

test("NEGATIVO: âncora de decisão DUPLICADA bloqueia", async () => {
  const { loadJsRegistry } = await loader()
  const base = await projeto(FONTE)
  const alvo = await pendenteDe(base)
  cleanupTmp(base.root)

  const d = decisaoPara(base, alvo)
  const ctx = await projeto(FONTE, [d, { ...d, owner: "outro" }])
  try {
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /âncora duplicada/)
  } finally { cleanupTmp(ctx.root) }
})

test("NEGATIVO: `provenanceDecisions` que não é lista BLOQUEIA", async () => {
  const { loadJsRegistry } = await loader()
  const ctx = await projeto(FONTE)
  try {
    writeFileSync(path.join(ctx.root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1", overrides: [], provenanceDecisions: "x",
    }))
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /provenanceDecisions/)
  } finally { cleanupTmp(ctx.root) }
})

test("campo `provenanceDecisions` é OPCIONAL — ausência não quebra", async () => {
  const { loadJsRegistry } = await loader()
  const ctx = await projeto(FONTE)
  try {
    writeFileSync(path.join(ctx.root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1", overrides: [],
    }))
    const v = loadJsRegistry({ repoRoot: ctx.root })
    assert.equal(v.ok, true, "arquivo antigo, sem o campo, continua válido")
    assert.deepEqual(v.provenanceDecisions, [])
  } finally { cleanupTmp(ctx.root) }
})

// ── O caso REAL de src/cli/index.js:304 ──────────────────────────────────────

/**
 * Não é fixture sintética: usa o arquivo do repositório, que a Fatia 5 vai
 * converter. Se a linha 304 mudar, este teste mostra o novo estado em vez de
 * seguir afirmando o antigo.
 */
test("CASO REAL: src/cli/index.js tem exatamente 1 pendência, e a decisão a resolve", async () => {
  const { buildRegistry, serializar } = await gen()
  const { buildInventory, phase1Gate, isInScope } = await imp()

  const root = mkdtempSync(path.join(tmpdir(), "gstack-real304-"))
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    mkdirSync(path.join(root, "src", "cli"), { recursive: true })
    writeFileSync(path.join(root, "src/cli/index.js"), readFileSync(path.join(repoRoot, "src/cli/index.js")))

    const reg = buildRegistry(["src/cli/index.js"], { root })
    writeFileSync(path.join(root, REG), serializar(reg))
    const dados = reg.files["src/cli/index.js"]

    const pendentes = dados.entries.filter((e) => isInScope(e.audience) && e.provenance.resolved === false)
    assert.equal(pendentes.length, 1, `esperado 1 pendência real, veio ${pendentes.length}`)
    const alvo = pendentes[0]

    const escrever = (d) => writeFileSync(path.join(root, OVR), JSON.stringify({
      schema: "gstack.i18n-js-overrides.v1", overrides: [], provenanceDecisions: d,
    }))

    escrever([])
    assert.equal(phase1Gate(buildInventory({ repoRoot: root })).ok, false, "sem decisão, bloqueia")

    escrever([{
      file: "src/cli/index.js", line: alvo.line, column: alvo.column,
      expectedFileHash: dados.fileHash,
      strategy: "translate_literal_frame_preserve_interpolations",
      interpolations: [...alvo.provenance.ids],
      reason: "A moldura 'Falha ao executar' é traduzível; command e e.message são valores de runtime.",
      owner: "lucas", evidence: "src/cli/index.js:304",
    }])

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.provenance.ok, true, "a decisão resolve a única pendência do arquivo")
    assert.equal(inv.jsRegistry.provenanceDecisionsApplied, 1)

    const p = inv.points.find((x) => x.line === alvo.line && x.column === alvo.column)
    assert.equal(p.classification, "in_scope", "a mensagem CONTINUA pública — nada foi reclassificado")
    assert.equal(p.provenance.resolved, false, "o dado bruto segue dizendo a verdade")
  } finally { cleanupTmp(root) }
})

// ── Estado oficial ───────────────────────────────────────────────────────────

/**
 * Este teste guardava o estado PRÉ-migração (125/1924/0 decisões) para provar
 * que a Fatia 4.2 só criava o mecanismo. A Fatia 5 o exercitou de verdade, e o
 * número aqui passa a ser o estado real do repositório.
 */
test("INVENTÁRIO OFICIAL após a conversão de monitor.js: 71 unknown, 1917 total, 10 decisões aplicadas", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.unknown, 71, "98 -> 71: monitor.js converteu 27 pontos")
  assert.equal(inv.total, 1917, "1916 + 1: o adapter DiagnosticLogger acrescentou uma mensagem de erro tipado")
  assert.deepEqual(inv.jsRegistry.convertedFiles, ["src/cli/index.js", "src/commands/monitor.js"])
  assert.equal(inv.jsRegistry.provenanceDecisionsApplied, 10, "1 de cli/index.js (linha 304) + 9 de monitor.js")
})
