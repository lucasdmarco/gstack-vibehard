import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Estrategia `translate_at_value_origin` — ponto SEM moldura literal cujo valor
 * interpolado E LINGUISTICO.
 *
 * NASCEU DE CASOS REAIS, e o vocabulario e fechado justamente para que nascer
 * seja caro. Callsites do repositorio nao cabiam em nenhuma das duas estrategias
 * anteriores sem mentir: `translate_literal_frame_preserve_interpolations`
 * promete traduzir uma moldura que ali nao existe, e
 * `preserve_nonlinguistic_dynamic_values` exigiria declarar a frase como
 * `glyph`/`identifier`/`control` — falso no unico campo que o revisor consegue
 * conferir.
 *
 * A CONTRAPARTIDA e ser MAIS exigente, nao menos: em vez de categoria por valor,
 * exige a ORIGEM ancorada (arquivo, linha, coluna e hash do arquivo de origem).
 * Se a frase se mover, a decisao morre — igual ao hash do sink.
 *
 * DIVISAO DE RESPONSABILIDADE, dita para nao parecer buraco:
 *
 *   loader (runtime, ZERO TypeScript) — forma, listas fechadas, ancora exata nos
 *     DOIS lados, existencia da origem em disco e hash da origem. E o que este
 *     arquivo exercita;
 *   aplicacao real (commit seguinte) — que a origem resolve para um literal de
 *     verdade e que ha UMA so origem possivel. Isso exige ler o codigo, nao o
 *     JSON, e e provado ponto a ponto na conversao de cada arquivo.
 *
 * O CENARIO E SINTETICO de proposito. Ancorar os controles num ponto real
 * criaria dependencia circular (o ponto so existe no registry depois da
 * conversao, e a conversao depende desta capacidade) e faria cada negativo
 * mudar de significado a cada arquivo convertido.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const loader = () => import(pathToFileURL(path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js")).href)

const REGISTRY = "src/meta/i18n-js-registry.json"
const OVERRIDES = "src/meta/i18n-js-overrides.json"

/** Mesma normalizacao do loader: fim de linha nao muda conteudo. */
const hashDe = (t) => `sha256:${createHash("sha256").update(String(t).replace(/\r\n/g, "\n"), "utf8").digest("hex")}`

const SINK = "src/commands/demo.js"
const ORIGEM = "src/tools/origem.js"

// A frase mora AQUI. O sink so a renderiza.
const FONTE_ORIGEM = `export function conectar() {
  return {
    mode: "manual",
    message: "Conexao exige um passo interativo real — nao pode ser automatizado.",
  }
}
`
// Sem moldura literal: o template e so espacamento em volta do valor.
const FONTE_SINK = `import { conectar } from "../tools/origem.js"
export function demoCommand() {
  const p = conectar()
  info(\`  \${p.message}\`)
}
`

/** Entrada de registry na forma que `entrada()` emite. */
const pontoNoLocalFrame = () => ({
  audience: "public_diagnostic",
  bindingKind: "import",
  bindingOrigin: "src/cli/index.js",
  callee: "info",
  calleePath: "info",
  canonicalName: "info",
  column: 3,
  line: 4,
  provenance: { ids: ["p", "message"], kind: "no_local_frame", resolved: false },
  rule: "render-via-canonical-helper",
  sink: null,
})

/** Ponto COM moldura, para o controle de estrategia usada no kind errado. */
const pontoInterpolado = () => ({
  ...pontoNoLocalFrame(),
  column: 30,
  line: 5,
  provenance: { ids: ["p", "message"], kind: "interpolated", resolved: false },
})

function sandbox(decisoes) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-tavo-"))
  for (const rel of [SINK, ORIGEM, REGISTRY]) mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
  writeFileSync(path.join(root, ORIGEM), FONTE_ORIGEM)
  writeFileSync(path.join(root, SINK), FONTE_SINK)
  writeFileSync(path.join(root, REGISTRY), `${JSON.stringify({
    convertedFiles: [SINK],
    files: { [SINK]: { entries: [pontoNoLocalFrame(), pontoInterpolado()], fileHash: hashDe(FONTE_SINK) } },
    schema: "gstack.i18n-js-registry.v1",
  }, null, 2)}\n`)
  writeFileSync(path.join(root, OVERRIDES), `${JSON.stringify({
    schema: "gstack.i18n-js-overrides.v1", overrides: [], provenanceDecisions: decisoes,
  }, null, 2)}\n`)
  return root
}

const carregar = async (root) => (await loader()).loadJsRegistry({ repoRoot: root })

/** Decisao BEM FORMADA. Cada negativo quebra exatamente uma porta a partir dela. */
const decisaoBase = () => ({
  file: SINK,
  line: 4,
  column: 3,
  expectedFileHash: hashDe(FONTE_SINK),
  strategy: "translate_at_value_origin",
  translationSite: "value_origin",
  interpolations: ["p", "message"],
  reason: "A frase e redigida na origem e apenas renderizada aqui; nao ha moldura local a traduzir.",
  owner: "controle",
  evidence: "src/tools/origem.js:4 — literal estatico unico",
  values: {
    p: {
      id: "p", sourceKind: "project_module_literal",
      origin: { file: ORIGEM, line: 4, column: 5, expectedFileHash: hashDe(FONTE_ORIGEM) },
      reason: "portador da frase", owner: "controle", evidence: "src/tools/origem.js:4",
    },
    message: {
      id: "message", sourceKind: "project_module_literal",
      origin: { file: ORIGEM, line: 4, column: 5, expectedFileHash: hashDe(FONTE_ORIGEM) },
      reason: "a frase em si", owner: "controle", evidence: "src/tools/origem.js:4",
    },
  },
})

async function comDecisao(mutar) {
  const d = decisaoBase()
  mutar(d)
  const root = sandbox([d])
  try { return await carregar(root) } finally { cleanupTmp(root) }
}

const reprova = (v, oQue) => {
  assert.equal(v.ok, false, `${oQue}: o loader ACEITOU — a porta não existe`)
  assert.equal(v.status, "corrupt", `${oQue}: deveria ser corrupt, veio ${v.status}`)
}

// ── VOCABULARIO ─────────────────────────────────────────────────────────────

test("a estratégia entra na lista FECHADA e só vale para `no_local_frame`", async () => {
  const { PROVENANCE_STRATEGIES, STRATEGY_BY_KIND, ORIGIN_SOURCE_KINDS } = await loader()
  assert.ok(PROVENANCE_STRATEGIES.includes("translate_at_value_origin"))
  assert.ok(STRATEGY_BY_KIND.no_local_frame.includes("translate_at_value_origin"))
  assert.ok(!STRATEGY_BY_KIND.interpolated.includes("translate_at_value_origin"),
    "havendo moldura literal a tradução é do callsite, não da origem")
  assert.deepEqual([...ORIGIN_SOURCE_KINDS], ["project_module_literal"],
    "lista fechada: cresce com evidência, nunca por conveniência")
})

// ── POSITIVO (vem antes: é ele que dá sentido aos negativos) ────────────────

test("POSITIVO: a decisão bem formada é ACEITA pelo caminho real do loader", async () => {
  const v = await comDecisao(() => {})
  assert.equal(v.ok, true, `o loader recusou a decisão válida: ${v.reason}`)
  assert.equal(v.provenanceDecisions.length, 1, "declarada é aplicada")
})

/**
 * CONTROLE DO PROPRIO CONTROLE. Se a decisão base já fosse inválida por outro
 * motivo, TODO negativo abaixo passaria por vacuidade: o loader reprovaria de
 * qualquer jeito e o teste não saberia a diferença.
 */
test("a decisão base é aceita E o dado bruto continua dizendo `resolved: false`", async () => {
  const root = sandbox([decisaoBase()])
  try {
    const v = await carregar(root)
    assert.equal(v.ok, true)
    const reg = JSON.parse(readFileSync(path.join(root, REGISTRY), "utf8"))
    assert.equal(reg.files[SINK].entries[0].provenance.resolved, false,
      "a decisão humana fica AO LADO da provenance automática — sobrescrever apagaria a evidência")
  } finally { cleanupTmp(root) }
})

// ── NEGATIVOS: uma porta por teste ──────────────────────────────────────────

test("NEGATIVO: origem INEXISTENTE bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.p.origin.file = "src/tools/nao-existe.js" }), "origem inexistente")
})

test("NEGATIVO: hash da origem DIVERGENTE bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.p.origin.expectedFileHash = `sha256:${"0".repeat(64)}` }), "hash divergente")
})

test("NEGATIVO: origem MUTADA depois da decisão bloqueia", async () => {
  const root = sandbox([decisaoBase()])
  try {
    writeFileSync(path.join(root, ORIGEM), `${FONTE_ORIGEM}// a frase se moveu\n`)
    reprova(await carregar(root), "origem mutada")
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: origem sem COLUNA bloqueia — duas frases cabem na mesma linha", async () => {
  reprova(await comDecisao((d) => { delete d.values.p.origin.column }), "coluna ausente")
})

/**
 * Coluna PRESENTE porém inválida — porta diferente da ausência.
 *
 * Deletar `column` cai na checagem de campos obrigatórios; `column: 0` só é
 * barrado por `inteiroPositivo`. Sem este caso, um mutante que removesse a
 * validação de valor não quebraria teste nenhum — foi exatamente o que o
 * mutation control mostrou.
 */
test("NEGATIVO: origem com COLUNA presente mas inválida bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.p.origin.column = 0 }), "coluna zero")
})

test("NEGATIVO: origem com LINHA inválida bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.p.origin.line = 0 }), "linha inválida")
})

test("NEGATIVO: templateId SEM entrada em `values` bloqueia", async () => {
  reprova(await comDecisao((d) => { delete d.values.message }), "templateId sem valor")
})

test("NEGATIVO: entrada EXTRA em `values` bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.sobrando = { ...d.values.p, id: "sobrando" } }), "valor sem templateId")
})

test("NEGATIVO: `id` que não confere com a chave bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.p.id = "outro" }), "id divergente")
})

test("NEGATIVO: origem EXTERNA (fora do repo) bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.p.origin.file = "../fora.js" }), "origem externa")
})

test("NEGATIVO: `category` não pertence a esta estratégia", async () => {
  reprova(await comDecisao((d) => { d.values.p.category = "identifier" }), "categoria de outra estratégia")
})

test("NEGATIVO: `sourceKind` fora da lista fechada bloqueia", async () => {
  reprova(await comDecisao((d) => { d.values.p.sourceKind = "qualquer_coisa" }), "sourceKind inválido")
})

test("NEGATIVO: sem declarar `translationSite` a decisão não vale", async () => {
  reprova(await comDecisao((d) => { delete d.translationSite }), "translationSite ausente")
})

test("NEGATIVO: `translationSite` apontando para o SINK bloqueia", async () => {
  reprova(await comDecisao((d) => { d.translationSite = "sink" }), "translationSite errado")
})

test("NEGATIVO: reason/owner/evidence vazios no VALOR bloqueiam", async () => {
  for (const campo of ["reason", "owner", "evidence"]) {
    reprova(await comDecisao((d) => { d.values.p[campo] = "   " }), `${campo} vazio`)
  }
})

test("NEGATIVO: a estratégia usada em ponto `interpolated` bloqueia", async () => {
  reprova(await comDecisao((d) => { d.line = 5; d.column = 30 }), "estratégia em ponto com moldura")
})

test("NEGATIVO: âncora do SINK divergente bloqueia", async () => {
  reprova(await comDecisao((d) => { d.column = 99 }), "coluna do sink divergente")
})

test("NEGATIVO: decisão DUPLICADA na mesma âncora bloqueia", async () => {
  const root = sandbox([decisaoBase(), decisaoBase()])
  try { reprova(await carregar(root), "âncora duplicada") } finally { cleanupTmp(root) }
})

test("NEGATIVO: decisão DECLARADA para ponto inexistente bloqueia", async () => {
  reprova(await comDecisao((d) => { d.line = 999 }), "callsite inexistente")
})
