import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Fatia 4 da Fase 1B — provenance e overrides ancorados.
 *
 * DUAS DECISÕES QUE ESTA FATIA CODIFICA:
 *
 *  1. **Provenance não resolvida bloqueia SÓ `in_scope`.** `argumentProvenance`
 *     marca `unresolved` quando o argumento é template interpolado: `${plan.id}`
 *     é do projeto, `${objective}` é do usuário, `${count}` é derivado, e sem
 *     análise de fluxo não dá para saber qual. Isso importa para o que vai ser
 *     TRADUZIDO. Fora do escopo não importa — `render_primitive` recebe o texto
 *     do chamador (já contado) e `machine_protocol` não é traduzido. Bloquear
 *     neles travaria a migração por um dado que ninguém vai usar.
 *
 *  2. **Override casa por `file+line+column`, nunca por arquivo ou prefixo.**
 *     Cada override carrega `reason`, `owner`, `evidence` e `expectedFileHash`
 *     porque descreve UMA decisão sobre UM callsite. Casar por arquivo
 *     espalharia a decisão para pontos que ninguém olhou.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = () => import(`file:///${path.join(repoRoot, "src", "meta", "i18n-inventory.js").replace(/\\/g, "/")}?t=${Date.now()}`)
const gen = () => import(`file:///${path.join(repoRoot, "scripts", "i18n-registry.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)

const REG = "src/meta/i18n-js-registry.json"
const OVR = "src/meta/i18n-js-overrides.json"

/** Projeto com `src/cli/index.js` convertido de verdade pelo gerador. */
async function projetoConvertido(fonte, overrides = []) {
  const { buildRegistry, serializar } = await gen()
  const root = mkdtempSync(path.join(tmpdir(), "gstack-prov-"))
  mkdirSync(path.join(root, "src", "meta"), { recursive: true })
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "src", "cli", "index.js"), fonte)

  const reg = buildRegistry(["src/cli/index.js"], { root })
  writeFileSync(path.join(root, REG), serializar(reg))
  writeFileSync(path.join(root, OVR), JSON.stringify({
    schema: "gstack.i18n-js-overrides.v1", overrides,
  }, null, 2))
  return { root, reg, hash: reg.files["src/cli/index.js"].fileHash }
}

// ── Campos preservados até o ponto oficial ───────────────────────────────────

test("o ponto oficial preserva provenance, bindingOrigin, calleePath e a âncora", async () => {
  const { buildInventory } = await imp()
  const { root } = await projetoConvertido(`export function info(m) { console.log(m) }\n`)
  try {
    const inv = buildInventory({ repoRoot: root })
    const p = inv.points.find((x) => x.source === "ast_registry")
    assert.ok(p, "o arquivo convertido produz ponto")

    for (const campo of ["file", "line", "column", "calleePath", "bindingOrigin", "provenance"]) {
      assert.ok(p[campo] !== undefined, `o ponto oficial precisa carregar \`${campo}\``)
    }
    assert.equal(typeof p.line, "number")
    assert.equal(typeof p.column, "number")
    assert.equal(p.calleePath, "console.log")
    assert.equal(typeof p.provenance.resolved, "boolean")
  } finally { cleanupTmp(root) }
})

test("a âncora é file+line+column — não colide para chamadas na MESMA linha", async () => {
  const { buildInventory, anchorOf } = await imp()
  const { root } = await projetoConvertido(`export function info(m) { console.log("a"); console.log("b") }\n`)
  try {
    const pontos = buildInventory({ repoRoot: root }).points.filter((p) => p.source === "ast_registry")
    assert.ok(pontos.length >= 2, "duas chamadas na mesma linha")
    const ancoras = new Set(pontos.map(anchorOf))
    assert.equal(ancoras.size, pontos.length, "só `line` colidiria; com `column` não")
  } finally { cleanupTmp(root) }
})

// ── Provenance bloqueia SÓ in_scope ──────────────────────────────────────────

test("POSITIVO: provenance não resolvida em ponto in_scope BLOQUEIA", async () => {
  const { buildInventory, unresolvedProvenance } = await imp()
  // `info` importado do módulo canônico ⇒ `public_diagnostic` ⇒ in_scope.
  // Template interpolado ⇒ provenance `unresolved`.
  const { root } = await projetoConvertido(
    `export function info(m) { console.log(m) }\nexport function run(alvo) { info(\`indo para \${alvo}\`) }\n`,
  )
  try {
    const inv = buildInventory({ repoRoot: root })
    const prov = unresolvedProvenance(inv)
    assert.equal(prov.ok, false, "in_scope com origem indeterminada precisa bloquear")
    assert.ok(prov.count >= 1)
    assert.match(prov.reason, /não resolvida|interpolação/)
    assert.ok(prov.points[0].ids.includes("alvo"), "reporta QUAL identificador ficou aberto")
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: `render_primitive` com template NÃO bloqueia (fora do escopo)", async () => {
  const { buildInventory, unresolvedProvenance, isInScope } = await imp()
  // `console.log` DENTRO da primitiva exportada `info` ⇒ `render_primitive`.
  const { root } = await projetoConvertido(
    "export function info(m) { console.log(`[gstack] ${m}`) }\n",
  )
  try {
    const inv = buildInventory({ repoRoot: root })
    const p = inv.points.find((x) => x.audience === "render_primitive")
    assert.ok(p, "a primitiva produz ponto render_primitive")
    assert.equal(p.provenance.resolved, false, "o template É interpolado")
    assert.equal(isInScope("render_primitive"), false)

    assert.equal(unresolvedProvenance(inv).ok, true,
      "bloquear aqui travaria a migração por dado que ninguém vai traduzir")
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: literal puro nunca bloqueia, mesmo in_scope", async () => {
  const { buildInventory, unresolvedProvenance } = await imp()
  const { root } = await projetoConvertido(
    `export function info(m) { console.log(m) }\nexport function run() { info("texto fixo") }\n`,
  )
  try {
    const inv = buildInventory({ repoRoot: root })
    assert.equal(unresolvedProvenance(inv).ok, true, "literal resolve por construção")
  } finally { cleanupTmp(root) }
})

test("unresolvedProvenance ignora ponto sem provenance (extrator legado)", async () => {
  const { unresolvedProvenance } = await imp()
  const r = unresolvedProvenance({
    points: [
      { file: "a.js", line: 1, classification: "in_scope" },                       // legado, sem provenance
      { file: "b.js", line: 2, classification: "in_scope", provenance: null },
    ],
  })
  assert.equal(r.ok, true, "arquivo não convertido não tem provenance — e não pode bloquear por isso")
})

test("o inventário oficial expõe o veredito de provenance", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.ok(inv.provenance, "o gate precisa poder consumir sem recomputar")
  assert.equal(typeof inv.provenance.ok, "boolean")
  assert.equal(typeof inv.provenance.count, "number")
})

// ── Overrides SOMENTE por âncora ─────────────────────────────────────────────

const overrideBase = (hash, extra = {}) => ({
  file: "src/cli/index.js", line: 1, column: 27,
  audience: "internal_debug", reason: "decisão de exemplo", owner: "lucas",
  evidence: "tests/i18n_provenance_overrides.test.js", expectedFileHash: hash,
  ...extra,
})

test("POSITIVO: override aplica no callsite ancorado e registra a decisão", async () => {
  const { buildInventory } = await imp()
  const fonte = `export function info(m) { console.log(m) }\n`
  const { root, hash, reg } = await projetoConvertido(fonte)
  try {
    const alvo = reg.files["src/cli/index.js"].entries[0]
    const { root: root2 } = await projetoConvertido(fonte, [
      overrideBase(hash, { line: alvo.line, column: alvo.column }),
    ])
    try {
      const inv = buildInventory({ repoRoot: root2 })
      const p = inv.points.find((x) => x.line === alvo.line && x.column === alvo.column)
      assert.equal(p.audience, "internal_debug", "a decisão humana tem a última palavra")
      assert.equal(p.trigger, "override")
      assert.equal(p.override.owner, "lucas")
      assert.ok(p.override.reason && p.override.evidence, "a decisão viaja com sua justificativa")
      assert.equal(inv.jsRegistry.overridesApplied, 1)
    } finally { cleanupTmp(root2) }
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: override NÃO vaza para outro callsite do MESMO arquivo", async () => {
  const { buildInventory } = await imp()
  // Duas chamadas em linhas diferentes: o override ancora só na primeira.
  const fonte = `export function info(m) { console.log(m) }\nexport function outra(m) { console.log(m) }\n`
  const { root, hash, reg } = await projetoConvertido(fonte)
  try {
    const entries = reg.files["src/cli/index.js"].entries
    assert.ok(entries.length >= 2, "o fixture precisa de dois callsites")
    const primeiro = entries[0]

    const { root: root2 } = await projetoConvertido(fonte, [
      overrideBase(hash, { line: primeiro.line, column: primeiro.column }),
    ])
    try {
      const inv = buildInventory({ repoRoot: root2 })
      const doArquivo = inv.points.filter((p) => p.file === "src/cli/index.js")
      const comOverride = doArquivo.filter((p) => p.trigger === "override")
      assert.equal(comOverride.length, 1,
        "casar por arquivo espalharia a decisão para pontos que ninguém olhou")
      assert.equal(comOverride[0].line, primeiro.line)
      assert.equal(comOverride[0].column, primeiro.column)
    } finally { cleanupTmp(root2) }
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: override com MESMA linha e coluna DIFERENTE não aplica", async () => {
  const { buildInventory } = await imp()
  const fonte = `export function info(m) { console.log("a"); console.log("b") }\n`
  const { root, hash, reg } = await projetoConvertido(fonte)
  try {
    const entries = reg.files["src/cli/index.js"].entries.filter((e) => e.line === 1)
    assert.ok(entries.length >= 2, "duas chamadas na mesma linha")
    const [a, b] = entries

    const { root: root2 } = await projetoConvertido(fonte, [
      overrideBase(hash, { line: a.line, column: a.column }),
    ])
    try {
      const inv = buildInventory({ repoRoot: root2 })
      const noB = inv.points.find((p) => p.line === b.line && p.column === b.column)
      assert.notEqual(noB.trigger, "override", "a coluna é parte da âncora, não decoração")
      const noA = inv.points.find((p) => p.line === a.line && p.column === a.column)
      assert.equal(noA.trigger, "override")
    } finally { cleanupTmp(root2) }
  } finally { cleanupTmp(root) }
})

test("override reclassifica o `classification` junto com a audiência", async () => {
  const { buildInventory } = await imp()
  const fonte = `export function info(m) { console.log(m) }\n`
  const { root, hash, reg } = await projetoConvertido(fonte)
  try {
    const alvo = reg.files["src/cli/index.js"].entries[0]
    const { root: root2 } = await projetoConvertido(fonte, [
      overrideBase(hash, { line: alvo.line, column: alvo.column, audience: "user_content" }),
    ])
    try {
      const p = buildInventory({ repoRoot: root2 }).points
        .find((x) => x.line === alvo.line && x.column === alvo.column)
      assert.equal(p.audience, "user_content")
      assert.equal(p.classification, "out_of_scope", "in_scope precisa acompanhar a nova audiência")
    } finally { cleanupTmp(root2) }
  } finally { cleanupTmp(root) }
})

// ── Estado oficial ───────────────────────────────────────────────────────────

test("INVENTÁRIO OFICIAL: 125 unknown, 1924 total, convertedFiles vazio", async () => {
  const { buildInventory } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.unknown, 125, "a Fatia 4 não classifica nada")
  assert.equal(inv.total, 1924)
  assert.deepEqual(inv.jsRegistry.convertedFiles, [])
  assert.equal(inv.jsRegistry.overridesApplied, 0, "não há override no repositório")
})
