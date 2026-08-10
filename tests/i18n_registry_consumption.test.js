import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Fatia 3 da Fase 1B — consumo FAIL-CLOSED do registry.
 *
 * O risco que esta fatia existe para eliminar: o inventário cair silenciosamente
 * no extrator regex quando o registry estiver ausente, corrompido ou defasado. Se
 * isso acontecesse, a classificação ANTIGA voltaria a valer sobre código NOVO sem
 * aviso, e o número do inventário pareceria saudável exatamente quando a medição
 * não aconteceu.
 *
 * Três modos de falha, cada um com controle negativo próprio:
 *   `missing` — o artefato é shipado; ausência = pacote incompleto
 *   `corrupt` — JSON inválido, schema desconhecido ou estrutura fora do contrato
 *   `stale`   — `fileHash` não confere: a classificação não descreve mais o arquivo
 *
 * E o caso que mais engana: num inventário bloqueado nada foi MEDIDO. As
 * contagens são `null` — `total`, `inScope`, `unknown` e `byAudience` — porque
 * `0` é resultado de medição e seria lido como "nada a classificar", a leitura
 * oposta à verdade. O gate reprova pelo BLOQUEIO, sem depender de contagem.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const imp = () => import(`file:///${path.join(repoRoot, "src", "meta", "i18n-inventory.js").replace(/\\/g, "/")}?t=${Date.now()}`)
const impLoader = () => import(`file:///${path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js").replace(/\\/g, "/")}?t=${Date.now()}`)

const REG = "src/meta/i18n-js-registry.json"
const OVR = "src/meta/i18n-js-overrides.json"

const hashOf = async (texto) => (await impLoader()).hashFileContent(texto)

/** Projeto temporário com um arquivo de saída e registry/overrides configuráveis. */
async function projeto({ registry, overrides, fonte } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-consumo-"))
  mkdirSync(path.join(root, "src", "meta"), { recursive: true })
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })

  const src = fonte ?? `export function info(m) { console.log(m) }\n`
  writeFileSync(path.join(root, "src", "cli", "index.js"), src)

  const reg = registry === undefined
    ? { schema: "gstack.i18n-js-registry.v1", convertedFiles: [], files: {} }
    : registry
  if (reg !== null) writeFileSync(path.join(root, REG), JSON.stringify(reg, null, 2))

  const ovr = overrides === undefined
    ? { schema: "gstack.i18n-js-overrides.v1", overrides: [] }
    : overrides
  if (ovr !== null) writeFileSync(path.join(root, OVR), JSON.stringify(ovr, null, 2))

  return { root, src }
}

/** Registry declarando `src/cli/index.js` convertido, com hash correto. */
async function registryConvertido(src, entries) {
  return {
    schema: "gstack.i18n-js-registry.v1",
    convertedFiles: ["src/cli/index.js"],
    files: {
      "src/cli/index.js": { fileHash: await hashOf(src), entries },
    },
  }
}

const ENTRADA = {
  audience: "public_diagnostic", bindingKind: "global", bindingOrigin: "src/cli/index.js",
  callee: "console.log", calleePath: "console.log", canonicalName: "log",
  column: 34, line: 1, provenance: { ids: [], kind: "literal_only", resolved: true },
  rule: "render-module-literal-output", sink: null,
}

// ── Caminho feliz ────────────────────────────────────────────────────────────

test("registry fresco e VAZIO não bloqueia e mantém tudo no extrator legado", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto()
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.ok, true)
    assert.equal(v.status, "fresh")
    assert.deepEqual(v.convertedFiles, [])
    assert.equal(v.byFile.size, 0, "nada convertido — nada substituído")
  } finally { cleanupTmp(root) }
})

test("CONVIVÊNCIA: o convertido vem do registry; o resto segue no legado", async () => {
  const { buildInventory } = await imp()
  const src = `export function info(m) { console.log(m) }\n`
  const { root } = await projeto({ registry: await registryConvertido(src, [ENTRADA]), fonte: src })
  try {
    // Um segundo arquivo, NÃO convertido, com saída própria.
    mkdirSync(path.join(root, "src", "commands"), { recursive: true })
    writeFileSync(path.join(root, "src", "commands", "outro.js"), `export function r() { console.log("x") }\n`)

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.blocked, false)
    assert.deepEqual(inv.jsRegistry.convertedFiles, ["src/cli/index.js"])

    const doRegistry = inv.points.filter((p) => p.source === "ast_registry")
    assert.equal(doRegistry.length, 1, "o convertido veio do registry")
    assert.equal(doRegistry[0].file, "src/cli/index.js")
    assert.equal(doRegistry[0].audience, "public_diagnostic")
    assert.equal(doRegistry[0].column, 34, "a coluna sobrevive até o inventário")

    const legado = inv.points.filter((p) => p.file === "src/commands/outro.js")
    assert.ok(legado.length > 0, "arquivo não convertido continua sendo extraído")
    assert.ok(legado.every((p) => p.source !== "ast_registry"))
  } finally { cleanupTmp(root) }
})

// ── missing ──────────────────────────────────────────────────────────────────

test("NEGATIVO missing: registry ausente BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto({ registry: null })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.ok, false)
    assert.equal(v.status, "missing")
    assert.match(v.reason, /não existe/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO missing: overrides ausente BLOQUEIA (é parte do par)", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto({ overrides: null })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "missing")
    assert.match(v.details.file, /overrides/)
  } finally { cleanupTmp(root) }
})

// ── corrupt ──────────────────────────────────────────────────────────────────

test("NEGATIVO corrupt: JSON inválido BLOQUEIA sem lançar", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto()
  try {
    writeFileSync(path.join(root, REG), "{ nao é json,,, ")
    let v
    assert.doesNotThrow(() => { v = loadJsRegistry({ repoRoot: root }) }, "erro estruturado, nunca crash")
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /não é JSON válido/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO corrupt: schema desconhecido BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto({ registry: { schema: "gstack.i18n-js-registry.v99", convertedFiles: [], files: {} } })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /schema desconhecido/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO corrupt: convertedFiles divergindo das chaves de files BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto({
    registry: { schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/cli/index.js"], files: {} },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /convertedFiles diverge/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO corrupt: entrada sem `column` BLOQUEIA (âncora incompleta)", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const semColuna = { ...ENTRADA }
  delete semColuna.column
  const { root } = await projeto({ registry: await registryConvertido(src, [semColuna]), fonte: src })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /sem `column` válida/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO corrupt: entrada sem `audience` BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const semAud = { ...ENTRADA, audience: "" }
  const { root } = await projeto({ registry: await registryConvertido(src, [semAud]), fonte: src })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /sem `audience`/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO corrupt: fileHash malformado BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto({
    registry: {
      schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/cli/index.js"],
      files: { "src/cli/index.js": { fileHash: "nao-e-hash", entries: [] } },
    },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /fileHash ausente ou malformado/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO corrupt: override sem campo obrigatório BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto({
    overrides: {
      schema: "gstack.i18n-js-overrides.v1",
      // falta `expectedFileHash`: sem ele a decisão humana migraria em silêncio
      overrides: [{ file: "src/cli/index.js", line: 1, column: 1, audience: "internal_debug", reason: "r", owner: "o", evidence: "e" }],
    },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /sem `expectedFileHash`/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO corrupt: schema de overrides desconhecido BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const { root } = await projeto({ overrides: { schema: "outra.coisa.v1", overrides: [] } })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /schema de overrides desconhecido/)
  } finally { cleanupTmp(root) }
})

// ── stale ────────────────────────────────────────────────────────────────────

test("NEGATIVO stale: 1 byte alterado no fonte BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const { root } = await projeto({ registry: await registryConvertido(src, [ENTRADA]), fonte: src })
  try {
    writeFileSync(path.join(root, "src", "cli", "index.js"), `export function info(m) { console.log(m) } \n`)
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "stale")
    assert.match(v.reason, /regenerar/)
    assert.equal(v.details.files[0].file, "src/cli/index.js")
    assert.notEqual(v.details.files[0].expected, v.details.files[0].actual)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO stale: arquivo convertido que sumiu BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const { root } = await projeto({
    registry: {
      schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/sumiu.js"],
      files: { "src/sumiu.js": { fileHash: await hashOf(src), entries: [] } },
    },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "stale")
    assert.match(v.details.files[0].reason, /não existe/)
  } finally { cleanupTmp(root) }
})

test("CRLF vs LF NÃO produz stale — senão o CI reprovaria por fim de linha", async () => {
  const { hashFileContent } = await impLoader()
  const lf = "export function a() {\n  return 1\n}\n"
  assert.equal(hashFileContent(lf), hashFileContent(lf.replace(/\n/g, "\r\n")))
})

// ── O ponto que mais engana ──────────────────────────────────────────────────

test("BLOQUEADO NÃO cai no regex: `points` fica VAZIO, nunca com o inventário legado", async () => {
  const { buildInventory } = await imp()
  const { root } = await projeto({ registry: null })
  try {
    mkdirSync(path.join(root, "src", "commands"), { recursive: true })
    writeFileSync(path.join(root, "src", "commands", "x.js"), `export function r() { console.log("a") }\n`)

    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.blocked, true)
    assert.equal(inv.jsRegistry.ok, false)
    assert.equal(inv.jsRegistry.status, "missing")
    assert.deepEqual(inv.points, [],
      "devolver os pontos do regex aqui SERIA o fallback silencioso que a fatia proíbe")
    assert.equal(inv.total, null, "não medido — `0` seria uma medição que não aconteceu")
  } finally { cleanupTmp(root) }
})

test("o gate reprova por BLOQUEIO, sem depender de contagem alguma", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const { root } = await projeto({ registry: null })
  try {
    const inv = buildInventory({ repoRoot: root })
    assert.equal(inv.unknown, null, "não medido")

    const g = phase1Gate(inv)
    assert.equal(g.ok, false, "inventário não medido NUNCA aprova o gate")
    assert.equal(g.blocked, true)
    assert.equal(g.registryStatus, "missing")
    assert.equal(g.unknown, null, "`null` distingue NÃO MEDIDO de ZERO")
    assert.match(g.reason, /registry de saída JS missing/)
  } finally { cleanupTmp(root) }
})

test("CONTROLE POSITIVO: registry fresco deixa o gate voltar a medir `unknown`", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const { root } = await projeto()
  try {
    mkdirSync(path.join(root, "src", "commands"), { recursive: true })
    writeFileSync(path.join(root, "src", "commands", "x.js"), `export function r() { console.log("a") }\n`)
    const g = phase1Gate(buildInventory({ repoRoot: root }))
    assert.equal(g.blocked, false)
    assert.equal(g.registryStatus, "fresh")
    assert.equal(typeof g.unknown, "number", "voltou a MEDIR")
  } finally { cleanupTmp(root) }
})

test("nenhum modo de falha lança — todos devolvem veredito estruturado", async () => {
  const { loadJsRegistry } = await impLoader()
  const casos = [
    ["missing", { registry: null }],
    ["corrupt-schema", { registry: { schema: "x", convertedFiles: [], files: {} } }],
    ["corrupt-overrides", { overrides: { schema: "y", overrides: [] } }],
  ]
  for (const [rotulo, cfg] of casos) {
    const { root } = await projeto(cfg)
    try {
      let v
      assert.doesNotThrow(() => { v = loadJsRegistry({ repoRoot: root }) }, `${rotulo} não pode lançar`)
      assert.equal(v.ok, false)
      assert.ok(["missing", "corrupt", "stale"].includes(v.status), `${rotulo}: status tipado`)
      assert.ok(v.reason && v.reason.length > 5, `${rotulo}: motivo legível`)
      assert.ok(v.details, `${rotulo}: detalhes para agir`)
    } finally { cleanupTmp(root) }
  }
})

// ── Dado HOSTIL não pode lançar (revisão: entries:[null] quebrava em e.line) ──

test("NEGATIVO: entries/overrides com null, escalar ou tipo errado NÃO lançam", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const hash = await hashOf(src)

  const hostis = [
    ["entries com null", { registry: { schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/cli/index.js"], files: { "src/cli/index.js": { fileHash: hash, entries: [null] } } } }],
    ["entries com escalar", { registry: { schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/cli/index.js"], files: { "src/cli/index.js": { fileHash: hash, entries: [42] } } } }],
    ["files[x] null", { registry: { schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/cli/index.js"], files: { "src/cli/index.js": null } } }],
    ["registry escalar", { registry: 42 }],
    ["registry array", { registry: [] }],
    ["overrides com null", { overrides: { schema: "gstack.i18n-js-overrides.v1", overrides: [null] } }],
    ["overrides escalar", { overrides: { schema: "gstack.i18n-js-overrides.v1", overrides: "x" } }],
    ["overrides array cru", { overrides: [] }],
  ]

  for (const [rotulo, cfg] of hostis) {
    const { root } = await projeto({ ...cfg, fonte: src })
    try {
      let v
      assert.doesNotThrow(() => { v = loadJsRegistry({ repoRoot: root }) }, `${rotulo} NÃO pode lançar`)
      assert.equal(v.ok, false, `${rotulo} precisa bloquear`)
      assert.equal(v.status, "corrupt", `${rotulo}: corrupt`)
      assert.ok(naoVazioStr(v.reason), `${rotulo}: motivo legível`)
    } finally { cleanupTmp(root) }
  }
})

const naoVazioStr = (s) => typeof s === "string" && s.trim().length > 5

test("NEGATIVO: arquivo convertido que é DIRETÓRIO vira stale, não exceção", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const { root } = await projeto({
    registry: {
      schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/umdir"],
      files: { "src/umdir": { fileHash: await hashOf(src), entries: [] } },
    },
  })
  try {
    mkdirSync(path.join(root, "src", "umdir"), { recursive: true })
    let v
    assert.doesNotThrow(() => { v = loadJsRegistry({ repoRoot: root }) }, "EISDIR não pode escapar")
    assert.equal(v.status, "stale")
    assert.match(v.details.files[0].reason, /ileg[íi]vel|EISDIR/i)
  } finally { cleanupTmp(root) }
})

// ── Path traversal ───────────────────────────────────────────────────────────

test("NEGATIVO: caminhos que escapam do repositório são RECUSADOS", async () => {
  const { pathProblem } = await impLoader()
  const recusados = [
    ["../fora.txt", /escapa/],
    ["..", /escapa|canônic/],
    ["src/../../fora.js", /canônic/],
    ["/etc/passwd", /absoluto/],
    ["C:/Windows/x.js", /absoluto/],
    ["src\\cli\\index.js", /separador inválido/],
    ["", /vazio/],
    ["   ", /vazio/],
    [42, /não textual/],
    [null, /não textual/],
    ["src/./x.js", /canônic/],
  ]
  for (const [p, re] of recusados) {
    const problema = pathProblem(p)
    assert.ok(problema, `deveria recusar: ${JSON.stringify(p)}`)
    assert.match(problema, re, `motivo errado para ${JSON.stringify(p)}`)
  }
  assert.equal(pathProblem("src/cli/index.js"), null, "caminho canônico passa")
})

test("NEGATIVO: registry com chave `../` BLOQUEIA antes de tocar o disco", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const { root } = await projeto({
    registry: {
      schema: "gstack.i18n-js-registry.v1", convertedFiles: ["../fora.js"],
      files: { "../fora.js": { fileHash: await hashOf(src), entries: [] } },
    },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt", "traversal é corrupção de contrato, não staleness")
    assert.match(v.reason, /escapa do repositório/)
  } finally { cleanupTmp(root) }
})

// ── Overrides: validação REFERENCIAL ─────────────────────────────────────────

test("POSITIVO: override íntegro é aceito", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const hash = await hashOf(src)
  const { root } = await projeto({
    registry: await registryConvertido(src, [ENTRADA]), fonte: src,
    overrides: {
      schema: "gstack.i18n-js-overrides.v1",
      overrides: [{
        file: "src/cli/index.js", line: ENTRADA.line, column: ENTRADA.column,
        audience: "internal_debug", reason: "motivo real", owner: "lucas",
        evidence: "tests/x.test.js", expectedFileHash: hash,
      }],
    },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.ok, true)
    assert.equal(v.overrides.length, 1)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: cada defeito referencial do override BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const hash = await hashOf(src)
  const base = {
    file: "src/cli/index.js", line: ENTRADA.line, column: ENTRADA.column,
    audience: "internal_debug", reason: "r", owner: "o", evidence: "e", expectedFileHash: hash,
  }

  const casos = [
    ["hash malformado", { expectedFileHash: "nao-e-hash" }, /malformado/],
    ["hash de OUTRO conteúdo", { expectedFileHash: `sha256:${"0".repeat(64)}` }, /não confere/],
    ["arquivo fora de convertedFiles", { file: "src/outro.js" }, /não está em convertedFiles/],
    ["callsite inexistente", { line: 999, column: 1 }, /nenhum callsite/],
    ["coluna inexistente", { column: 999 }, /nenhum callsite/],
    ["audiência inválida", { audience: "inventada" }, /audiência inválida/],
    ["reason vazio", { reason: "   " }, /`reason` vazio/],
    ["owner vazio", { owner: "" }, /`owner` vazio/],
    ["evidence vazio", { evidence: "  " }, /`evidence` vazio/],
    ["path traversal no override", { file: "../fora.js" }, /escapa/],
  ]

  for (const [rotulo, mudanca, re] of casos) {
    const { root } = await projeto({
      registry: await registryConvertido(src, [ENTRADA]), fonte: src,
      overrides: { schema: "gstack.i18n-js-overrides.v1", overrides: [{ ...base, ...mudanca }] },
    })
    try {
      const v = loadJsRegistry({ repoRoot: root })
      assert.equal(v.status, "corrupt", `${rotulo} precisa bloquear`)
      assert.match(v.reason, re, `${rotulo}: motivo`)
    } finally { cleanupTmp(root) }
  }
})

test("NEGATIVO: âncora de override DUPLICADA bloqueia", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const hash = await hashOf(src)
  const ov = {
    file: "src/cli/index.js", line: ENTRADA.line, column: ENTRADA.column,
    audience: "internal_debug", reason: "r", owner: "o", evidence: "e", expectedFileHash: hash,
  }
  const { root } = await projeto({
    registry: await registryConvertido(src, [ENTRADA]), fonte: src,
    overrides: { schema: "gstack.i18n-js-overrides.v1", overrides: [ov, { ...ov, audience: "user_content" }] },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /âncora duplicada/)
  } finally { cleanupTmp(root) }
})

test("NEGATIVO: entrada com audiência fora do vocabulário BLOQUEIA", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const { root } = await projeto({
    registry: await registryConvertido(src, [{ ...ENTRADA, audience: "inventada" }]), fonte: src,
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /audiência inválida/)
  } finally { cleanupTmp(root) }
})

// ── Contagens: `null` significa NÃO MEDIDO ───────────────────────────────────

test("BLOQUEADO: contagens são `null` desde o buildInventory, nunca 0", async () => {
  const { buildInventory } = await imp()
  const { root } = await projeto({ registry: null })
  try {
    const inv = buildInventory({ repoRoot: root })
    for (const campo of ["total", "inScope", "unknown", "byAudience"]) {
      assert.equal(inv[campo], null, `${campo} precisa ser null — 0 seria lido como medição`)
    }
  } finally { cleanupTmp(root) }
})

test("BLOQUEADO: phaseStatus propaga o bloqueio em vez de anunciar '0 sem audiência'", async () => {
  const { buildInventory, phaseStatus } = await imp()
  const { root } = await projeto({ registry: null })
  try {
    const s = phaseStatus(buildInventory({ repoRoot: root }))
    assert.equal(s.blocked, true)
    assert.equal(s.phaseStatus, "blocked")
    assert.equal(s.registryStatus, "missing")
    assert.equal(s.unknown, null)
    assert.match(s.reason, /registry de saída JS missing/)
    assert.ok(!/0 ponto/.test(s.reason), "não pode anunciar contagem de um inventário não medido")
  } finally { cleanupTmp(root) }
})

// ── Fonte sem byte NUL físico ────────────────────────────────────────────────

test("o fonte do loader NÃO contém byte NUL literal (tornaria o .js binário)", async () => {
  const bytes = readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js"))
  assert.equal(bytes.includes(0), false,
    "NUL físico faz `rg`, `grep` e diff tratarem o arquivo como binário")
})

// ── Contrato GERADOR ↔ LOADER (o defeito que só a integração revela) ─────────

/**
 * O engine AST e o loader estavam corretos ISOLADAMENTE e incompatíveis JUNTOS:
 * o engine emite `public_interactive` e `render_primitive` (regras
 * `interactive-prompt` e `render-primitive-impl`), e o vocabulário do loader não
 * os continha. Na Fatia 5, ao converter o primeiro arquivo, o loader
 * classificaria como `corrupt` um registry perfeitamente legítimo.
 *
 * Este teste usa `src/cli/index.js` REAL — justamente o arquivo que a Fatia 5
 * vai converter — para que o drift não possa voltar despercebido.
 */
test("CONTRATO: toda audiência que o GERADOR emite existe em AUDIENCES", async () => {
  const gen = await import(`file:///${path.join(repoRoot, "scripts", "i18n-registry.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)
  const { AUDIENCES } = await import(`file:///${path.join(repoRoot, "src", "meta", "i18n-audiences.js").replace(/\\/g, "/")}?t=${Date.now()}`)

  const alvo = "src/cli/index.js"
  const r = gen.buildRegistry([alvo], { root: repoRoot })
  const emitidas = [...new Set(r.files[alvo].entries.map((e) => e.audience))].sort()

  assert.ok(emitidas.length >= 3, `esperado volume real de audiências, veio ${JSON.stringify(emitidas)}`)
  const ausentes = emitidas.filter((a) => !AUDIENCES.includes(a))
  assert.deepEqual(ausentes, [],
    `o gerador emite audiência que o loader recusaria: ${JSON.stringify(ausentes)}`)
})

test("CONTRATO: toda audiência declarada pelas REGRAS do engine existe em AUDIENCES", async () => {
  const eng = await import(`file:///${path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)
  const { AUDIENCES } = await import(`file:///${path.join(repoRoot, "src", "meta", "i18n-audiences.js").replace(/\\/g, "/")}?t=${Date.now()}`)

  // Cobre também regra que exista mas ainda não tenha disparado em nenhum arquivo.
  const declaradas = [...new Set(eng.rules().map((r) => r.audience))].sort()
  const ausentes = declaradas.filter((a) => !AUDIENCES.includes(a))
  assert.deepEqual(ausentes, [], `regra declara audiência fora do vocabulário: ${JSON.stringify(ausentes)}`)
})

test("CONTRATO: o registry REAL de src/cli/index.js é ACEITO pelo loader", async () => {
  // Prova de ponta a ponta do que a Fatia 5 fará: gera de verdade, escreve, carrega.
  const gen = await import(`file:///${path.join(repoRoot, "scripts", "i18n-registry.mjs").replace(/\\/g, "/")}?t=${Date.now()}`)
  const { loadJsRegistry } = await impLoader()

  const alvo = "src/cli/index.js"
  const root = mkdtempSync(path.join(tmpdir(), "gstack-contrato-"))
  try {
    mkdirSync(path.join(root, "src", "meta"), { recursive: true })
    mkdirSync(path.join(root, "src", "cli"), { recursive: true })
    // Copia o arquivo REAL para o sandbox, preservando bytes.
    const conteudo = readFileSync(path.join(repoRoot, alvo))
    writeFileSync(path.join(root, alvo), conteudo)

    const r = gen.buildRegistry([alvo], { root })
    writeFileSync(path.join(root, REG), gen.serializar(r))
    writeFileSync(path.join(root, OVR), JSON.stringify({ schema: "gstack.i18n-js-overrides.v1", overrides: [] }))

    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.ok, true, `o loader recusou o registry legítimo: ${v.reason || ""}`)
    assert.deepEqual(v.convertedFiles, [alvo])
    assert.ok(v.byFile.get(alvo).length > 0)
  } finally { cleanupTmp(root) }
})

// ── Contenção REAL: symlink não pode escapar ─────────────────────────────────

/**
 * Symlink de ARQUIVO exige Developer Mode ou admin no Windows e falha com EPERM.
 * Junction de DIRETÓRIO (`mklink /J`) não exige privilégio e resolve por
 * `realpath` do mesmo jeito — serve igualmente para provar a contenção. Em
 * POSIX, `symlinkSync` de diretório resolve o mesmo caso.
 *
 * Cair no skip aqui deixaria a correção DECLARADA e NÃO PROVADA justamente na
 * máquina onde ela roda.
 */
async function ligarDiretorio(link, destino) {
  const { symlinkSync } = await import("node:fs")
  try {
    symlinkSync(destino, link, "junction")
    return { ok: true, via: "junction" }
  } catch { /* tenta o modo POSIX */ }
  try {
    symlinkSync(destino, link, "dir")
    return { ok: true, via: "symlink" }
  } catch (e) {
    return { ok: false, code: e.code }
  }
}

test("NEGATIVO: link apontando para FORA do repositório é recusado (contenção real)", async (t) => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`

  const fora = mkdtempSync(path.join(tmpdir(), "gstack-fora-"))
  const { root } = await projeto({
    registry: {
      schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/vendido/alvo.js"],
      files: { "src/vendido/alvo.js": { fileHash: await hashOf(src), entries: [] } },
    },
  })
  try {
    writeFileSync(path.join(fora, "alvo.js"), src)
    const l = await ligarDiretorio(path.join(root, "src", "vendido"), fora)
    if (!l.ok) { t.skip(`SO não permite criar link de diretório: ${l.code}`); return }

    // O caminho é lexicalmente impecável: `src/vendido/alvo.js`. Só `realpath`
    // revela que ele sai do repositório.
    const { pathProblem } = await impLoader()
    assert.equal(pathProblem("src/vendido/alvo.js"), null, "a checagem lexical NÃO pega este caso")

    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.ok, false, `${l.via} para fora precisa ser recusado`)
    assert.equal(v.status, "stale")
    assert.match(v.details.files[0].reason, /aponta para fora/)
  } finally { cleanupTmp(root); cleanupTmp(fora) }
})

test("POSITIVO: link INTERNO é permitido — é contenção, não proibição de link", async (t) => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`

  const { root } = await projeto({
    registry: {
      schema: "gstack.i18n-js-registry.v1", convertedFiles: ["src/atalho/alvo.js"],
      files: { "src/atalho/alvo.js": { fileHash: await hashOf(src), entries: [] } },
    },
  })
  try {
    const realDir = path.join(root, "src", "real")
    mkdirSync(realDir, { recursive: true })
    writeFileSync(path.join(realDir, "alvo.js"), src)

    const l = await ligarDiretorio(path.join(root, "src", "atalho"), realDir)
    if (!l.ok) { t.skip(`SO não permite criar link de diretório: ${l.code}`); return }

    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.ok, true, `link interno é legítimo (${l.via}): ${v.reason || ""}`)
  } finally { cleanupTmp(root) }
})

// ── Override não pode escolher `unknown` ─────────────────────────────────────

test("NEGATIVO: override com audience `unknown` é recusado", async () => {
  const { loadJsRegistry } = await impLoader()
  const src = `export function info(m) { console.log(m) }\n`
  const hash = await hashOf(src)
  const { root } = await projeto({
    registry: await registryConvertido(src, [ENTRADA]), fonte: src,
    overrides: {
      schema: "gstack.i18n-js-overrides.v1",
      overrides: [{
        file: "src/cli/index.js", line: ENTRADA.line, column: ENTRADA.column,
        audience: "unknown", reason: "r", owner: "o", evidence: "e", expectedFileHash: hash,
      }],
    },
  })
  try {
    const v = loadJsRegistry({ repoRoot: root })
    assert.equal(v.status, "corrupt")
    assert.match(v.reason, /não é destino de decisão humana/)
  } finally { cleanupTmp(root) }
})

test("`unknown` está em AUDIENCES mas NÃO em OVERRIDABLE_AUDIENCES", async () => {
  const { AUDIENCES, OVERRIDABLE_AUDIENCES } = await import(`file:///${path.join(repoRoot, "src", "meta", "i18n-audiences.js").replace(/\\/g, "/")}?t=${Date.now()}`)
  assert.ok(AUDIENCES.includes("unknown"), "o inventário precisa poder REPORTAR unknown")
  assert.ok(!OVERRIDABLE_AUDIENCES.includes("unknown"), "mas ninguém pode DECIDIR unknown")
  assert.equal(OVERRIDABLE_AUDIENCES.length, AUDIENCES.length - 1)
})

test("`public_interactive` entra na claim; `render_primitive` não", async () => {
  const { isInScope } = await import(`file:///${path.join(repoRoot, "src", "meta", "i18n-audiences.js").replace(/\\/g, "/")}?t=${Date.now()}`)
  assert.equal(isInScope("public_interactive"), true, "pergunta que o usuário lê e responde")
  assert.equal(isInScope("render_primitive"), false,
    "a string vem do chamador, que já foi contado — incluir duplicaria a mensagem")
})

// ── Zero TypeScript em runtime ───────────────────────────────────────────────

test("o loader NÃO importa TypeScript nem o engine AST", async () => {
  const fonte = readFileSync(path.join(repoRoot, "src", "meta", "i18n-js-registry-loader.js"), "utf8")
  assert.ok(!/from\s+["']typescript["']/.test(fonte), "runtime não pode depender de devDependency")
  assert.ok(!fonte.includes("i18n-js-ast"), "o engine é build-time")
})

// ── Estado oficial preservado ────────────────────────────────────────────────

test("INVENTÁRIO OFICIAL: registry fresco, dois arquivos convertidos, 71 unknown", async () => {
  const { buildInventory, phase1Gate } = await imp()
  const inv = buildInventory({ repoRoot })
  assert.equal(inv.blocked, false)
  assert.equal(inv.jsRegistry.ok, true)
  assert.deepEqual(inv.jsRegistry.convertedFiles, ["src/cli/create.js", "src/cli/index.js", "src/commands/monitor.js"],
    "cli/index.js na Fatia 5; monitor.js em d9824f6; create.js na conversão oficial")
  assert.equal(inv.unknown, 54, "71 -> 54 quando os 17 pontos in_scope de create.js saíram do extrator regex")
  assert.equal(phase1Gate(inv).ok, false, "54 pendências ainda bloqueiam a Fase 1")
})
