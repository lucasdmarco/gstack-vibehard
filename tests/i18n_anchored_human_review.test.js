import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * REVISÃO HUMANA ANCORADA — quando NENHUMA regra estrutural pode decidir.
 *
 * Caso concreto: `runtime-supervisor.js:381`. O valor impresso é o log do
 * processo supervisionado, e a cadeia é
 *
 *   followLog → readTail(logPath) → readSync(fd, buffer, …)
 *              → buffer.subarray(…).toString(…) → write(…)
 *
 * O `readSync` preenche o buffer por EFEITO COLATERAL: o retorno não guarda
 * vínculo sintático com a leitura. O checker não resolve — e a decisão não pode
 * fingir que resolveu.
 *
 * OS CAMPOS NOVOS IMPEDEM A DECISÃO DE SE DISFARÇAR DE DERIVAÇÃO. Ela declara
 * que a resolução estrutural falhou (`structuralResolution: unresolved`) e em que
 * se apoia (`decisionBasis: anchored_human_review`). Sem isso, ao revisar o JSON
 * um override anônimo seria indistinguível de classificação automática.
 *
 * `expectedIds` fecha a última fresta, e `expectedFileHash` cobre o arquivo
 * inteiro — logo também `readTail` e `followLog`. Qualquer mudança na cadeia
 * invalida a decisão.
 *
 * NÃO cria regra genérica para Buffer, para `toString()`, para funções chamadas
 * `readTail` nem para parâmetros passados a `write`: vale para UMA âncora.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const url = (p) => pathToFileURL(path.join(repoRoot, p)).href
const loader = () => import(`${url("src/meta/i18n-js-registry-loader.js")}?t=${Date.now()}`)
const gen = () => import(`${url("scripts/i18n-registry.mjs")}?t=${Date.now()}`)

const ALVO = "src/cli/index.js"

/** Mesma FORMA do caso real: seam de escrita alimentado por leitura opaca. */
const FONTE = `import { openSync, readSync, closeSync } from "fs"
function readTail(logPath, from, to) {
  const fd = openSync(logPath, "r")
  const buf = Buffer.alloc(to - from)
  const bytes = readSync(fd, buf, 0, buf.length, from)
  closeSync(fd)
  return buf.subarray(0, bytes).toString("utf-8")
}
export function seguir(logPath, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write(readTail(logPath, 0, 10))
}
`

async function projeto({ overrides = [] } = {}) {
  const { buildRegistry, serializar } = await gen()
  const root = mkdtempSync(path.join(tmpdir(), "gstack-ancorada-"))
  mkdirSync(path.join(root, "src", "meta"), { recursive: true })
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, ALVO), FONTE)

  const reg = buildRegistry([ALVO], { root })
  writeFileSync(path.join(root, "src/meta/i18n-js-registry.json"), serializar(reg))
  writeFileSync(path.join(root, "src/meta/i18n-js-overrides.json"), JSON.stringify({
    schema: "gstack.i18n-js-overrides.v1", overrides, provenanceDecisions: [],
  }, null, 2))

  const dados = reg.files[ALVO]
  const alvo = dados.entries.find((e) => e.audience === "unknown")
  return { root, hash: dados.fileHash, alvo }
}

const decisao = (ctx, extra = {}) => ({
  file: ALVO, line: ctx.alvo.line, column: ctx.alvo.column,
  audience: "user_content",
  expectedFileHash: ctx.hash,
  expectedIds: [...(ctx.alvo.provenance?.ids ?? [])],
  structuralResolution: "unresolved",
  decisionBasis: "anchored_human_review",
  reason: "conteúdo verbatim do log do processo supervisionado; o checker não resolve por causa do efeito colateral no buffer",
  owner: "teste",
  evidence: "tests/i18n_anchored_human_review.test.js",
  ...extra,
})

const veredito = async (ctx) => (await loader()).loadJsRegistry({ repoRoot: ctx.root })

const comProjeto = async (t, montar, fn) => {
  const base = await projeto()
  const ctx = await projeto(montar(base))
  cleanupTmp(base.root)
  t.after(() => cleanupTmp(ctx.root))
  return fn(await veredito(ctx), ctx)
}

const reprova = (v, padrao) => {
  assert.equal(v.ok, false, "a decisão precisava ser recusada e passou")
  assert.match(v.reason ?? "", padrao)
}

// ── O ponto de partida ─────────────────────────────────────────────────────

test("o fixture reproduz a forma real: o ponto fica `unknown` sem decisão", async (t) => {
  const ctx = await projeto()
  t.after(() => cleanupTmp(ctx.root))
  assert.ok(ctx.alvo, "o seam de escrita precisa produzir um ponto sem audiência")
  assert.equal(ctx.alvo.provenance.resolved, true, "não há interpolação — a pendência é de AUDIÊNCIA, não de provenance")
})

// ── POSITIVO ────────────────────────────────────────────────────────────────

test("POSITIVO: decisão ancorada, declarando que a resolução estrutural falhou", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [decisao(b)] }), (v) => {
    assert.equal(v.ok, true, v.reason ?? "")
  })
})

// ── NEGATIVOS: cada porta do contrato ─────────────────────────────────────

test("NEGATIVO: `decisionBasis` fora da lista fechada bloqueia", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [decisao(b, { decisionBasis: "derivado" })] }),
    (v) => reprova(v, /`decisionBasis` inválido/))
})

/**
 * A porta que impede a decisão de REIVINDICAR derivação. Se o checker tivesse
 * resolvido, a decisão humana não seria necessária — declarar `resolved` seria
 * afirmar uma prova que não houve.
 */
test("NEGATIVO: declarar `structuralResolution: resolved` bloqueia", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [decisao(b, { structuralResolution: "resolved" })] }),
    (v) => reprova(v, /`structuralResolution` deve ser "unresolved"/))
})

test("NEGATIVO: campo do contrato pela metade bloqueia", async (t) => {
  await comProjeto(t, (b) => {
    const d = decisao(b)
    delete d.structuralResolution
    return { overrides: [d] }
  }, (v) => reprova(v, /`structuralResolution` deve ser/))

  await comProjeto(t, (b) => {
    const d = decisao(b)
    delete d.expectedIds
    return { overrides: [d] }
  }, (v) => reprova(v, /`expectedIds` ausente ou não é lista/))
})

/**
 * TRANSFORMAÇÃO LINGUÍSTICA DO GSTACK: se alguém puser uma moldura em volta, o
 * ponto ganha interpolação e `expectedIds` deixa de bater — a decisão morre em
 * vez de continuar valendo sobre outra coisa.
 */
test("NEGATIVO: `expectedIds` divergente do gerado bloqueia", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [decisao(b, { expectedIds: ["s"] })] }),
    (v) => reprova(v, /`expectedIds` diverge do gerado/))
})

test("NEGATIVO: hash divergente invalida — a cadeia de leitura mudou", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [decisao(b, { expectedFileHash: `sha256:${"9".repeat(64)}` })] }),
    (v) => reprova(v, /`expectedFileHash` não confere/))
})

test("NEGATIVO: linha ou coluna divergentes bloqueiam — decisão copiada para outro sink", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [decisao(b, { line: 999 })] }),
    (v) => reprova(v, /nenhum callsite em/))
  await comProjeto(t, (b) => ({ overrides: [decisao(b, { column: 999 })] }),
    (v) => reprova(v, /nenhum callsite em/))
})

test("NEGATIVO: `unknown` não é destino de decisão humana", async (t) => {
  await comProjeto(t, (b) => ({ overrides: [decisao(b, { audience: "unknown" })] }),
    (v) => reprova(v, /não é destino de decisão humana/))
})

test("NEGATIVO: reason/owner/evidence vazios bloqueiam", async (t) => {
  for (const campo of ["reason", "owner", "evidence"]) {
    await comProjeto(t, (b) => ({ overrides: [decisao(b, { [campo]: "  " })] }),
      (v) => reprova(v, new RegExp(`\`${campo}\` vazio`)))
  }
})

// ── A decisão é ESTREITA: não vira regra genérica ──────────────────────────

/**
 * Um segundo seam idêntico no MESMO arquivo continua `unknown`. A decisão vale
 * para uma âncora, e não para "qualquer Buffer", "qualquer `toString()`",
 * "qualquer `readTail`" ou "qualquer parâmetro passado a `write`".
 */
test("a decisão NÃO alcança um segundo seam de forma idêntica", async (t) => {
  const { buildRegistry, serializar } = await gen()
  const { loadJsRegistry } = await loader()
  const root = mkdtempSync(path.join(tmpdir(), "gstack-ancorada2-"))
  t.after(() => cleanupTmp(root))
  mkdirSync(path.join(root, "src", "meta"), { recursive: true })
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, ALVO), `${FONTE}
export function seguirDeNovo(logPath, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s))
  write(readTail(logPath, 0, 10))
}
`)
  const reg = buildRegistry([ALVO], { root })
  const dados = reg.files[ALVO]
  const pendentes = dados.entries.filter((e) => e.audience === "unknown")
  assert.equal(pendentes.length, 2, "o fixture precisa ter DOIS seams idênticos")

  writeFileSync(path.join(root, "src/meta/i18n-js-registry.json"), serializar(reg))
  writeFileSync(path.join(root, "src/meta/i18n-js-overrides.json"), JSON.stringify({
    schema: "gstack.i18n-js-overrides.v1",
    overrides: [decisao({ hash: dados.fileHash, alvo: pendentes[0] })],
    provenanceDecisions: [],
  }, null, 2))

  const v = loadJsRegistry({ repoRoot: root })
  assert.equal(v.ok, true, v.reason ?? "")

  const inv = await import(`${url("src/meta/i18n-inventory.js")}?t=${Date.now()}`)
  const pts = inv.buildInventory({ repoRoot: root }).points
  assert.equal(pts.find((p) => p.line === pendentes[0].line).audience, "user_content")
  assert.equal(pts.find((p) => p.line === pendentes[1].line).audience, "unknown",
    "o segundo seam continua na fila — a decisão é de UMA âncora")
})
