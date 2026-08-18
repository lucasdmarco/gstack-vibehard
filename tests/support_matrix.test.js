/**
 * PRD52 S52.E — §26.3: evidência de suporte é uma matriz OS × Node.
 *
 * O que os testes protegem é a assimetria: `not_run` não vira verde por
 * analogia com a célula vizinha, e também não vira vermelho por ninguém ter
 * medido. As duas conversões são erros, e são erros diferentes.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const M = () => imp("src/release/support-matrix.js")

/** Um repo sintético com o workflow que declara a grade. */
async function repoComGrade(os, node) {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-matrix-"))
  await mkdir(path.join(dir, ".github", "workflows"), { recursive: true })
  await writeFile(path.join(dir, ".github", "workflows", "runtime-compat.yml"),
    `jobs:\n  matrix:\n    strategy:\n      matrix:\n        os: [${os.join(", ")}]\n        node: [${node.join(", ")}]\n`)
  return dir
}

const celulaProvada = (os, nodeVersion) => ({
  os, arch: "x64", nodeVersion,
  packageHash: "sha256:pkg", installReceiptRef: "r/install", runtimeReceiptRef: "r/runtime",
  uninstallReceiptRef: "r/uninstall", verdict: "pass",
})

test("a grade é DERIVADA do workflow, não digitada no módulo", async () => {
  const { gradeDeclarada } = await M()
  const dir = await repoComGrade(["ubuntu-latest", "windows-latest"], [20, 22])
  try {
    const g = gradeDeclarada(dir)
    assert.deepEqual(g.os, ["ubuntu-latest", "windows-latest"])
    assert.deepEqual(g.node, ["20", "22"])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("célula nova nasce `not_run` — acrescentar Node ao CI faz a matriz crescer", async () => {
  const { construirMatriz } = await M()
  const dir = await repoComGrade(["ubuntu-latest"], [20, 22, 24])
  try {
    const m = construirMatriz({ cwd: dir })
    assert.equal(m.cells.length, 3)
    assert.deepEqual(m.counts, { pass: 0, fail: 0, not_run: 3 })
    assert.deepEqual(m.proven, [], "a matriz pública só tem célula provada")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("sem workflow legível, a grade é VAZIA — nunca uma grade default inventada", async () => {
  const { construirMatriz } = await M()
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-matrix-vazia-"))
  try {
    const m = construirMatriz({ cwd: dir })
    assert.deepEqual(m.cells, [])
    assert.equal(m.grid.source, null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("célula com os quatro recibos é `pass` e entra na matriz pública", async () => {
  const { construirMatriz, chaveDaCelula } = await M()
  const dir = await repoComGrade(["ubuntu-latest"], [22])
  try {
    const chave = chaveDaCelula("ubuntu-latest", "22")
    const m = construirMatriz({ cwd: dir, receipts: { [chave]: celulaProvada("ubuntu-latest", "22") } })
    assert.deepEqual(m.proven, [chave])
    assert.deepEqual(m.invalidCells, [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("CONTROLE NEGATIVO: `pass` sem os quatro recibos é célula MALFORMADA, não verde", async () => {
  const { construirMatriz, chaveDaCelula } = await M()
  const dir = await repoComGrade(["ubuntu-latest"], [22])
  try {
    const chave = chaveDaCelula("ubuntu-latest", "22")
    const alegada = { ...celulaProvada("ubuntu-latest", "22"), uninstallReceiptRef: null }
    const m = construirMatriz({ cwd: dir, receipts: { [chave]: alegada } })
    assert.equal(m.invalidCells.length, 1, "um verde alegado não vira verde por ser alegado")
    assert.ok(m.invalidCells[0].problems.some((p) => p.includes("uninstallReceiptRef")))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("CONTROLE NEGATIVO: declarar suporte a célula não executada é recusado com o nome dela", async () => {
  const { construirMatriz, problemasDaDeclaracao, chaveDaCelula } = await M()
  const dir = await repoComGrade(["macos-latest"], [18])
  try {
    const m = construirMatriz({ cwd: dir })
    const p = problemasDaDeclaracao([chaveDaCelula("macos-latest", "18")], m)
    assert.equal(p.length, 1)
    assert.ok(p[0].includes("macos-latest::node18") && p[0].includes("not_run"))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("reduzir a faixa declarada é legítimo; ampliar sem célula verde não", async () => {
  const { construirMatriz, problemasDaDeclaracao, chaveDaCelula } = await M()
  const dir = await repoComGrade(["ubuntu-latest"], [20, 22])
  try {
    const provada = chaveDaCelula("ubuntu-latest", "22")
    const m = construirMatriz({ cwd: dir, receipts: { [provada]: celulaProvada("ubuntu-latest", "22") } })
    assert.deepEqual(problemasDaDeclaracao([provada], m), [], "declarar SÓ a provada é honesto")
    assert.equal(problemasDaDeclaracao([provada, chaveDaCelula("ubuntu-latest", "20")], m).length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// ── O estado REAL deste repositório ────────────────────────────────────────

test("a matriz REAL do repo tem 12 células, todas `not_run` (o CI nunca rodou)", async () => {
  const { construirMatriz } = await M()
  const m = construirMatriz({ cwd: repoRoot })
  assert.deepEqual(m.grid.os, ["ubuntu-latest", "windows-latest", "macos-latest"])
  assert.deepEqual(m.grid.node, ["18", "20", "22", "24"])
  assert.equal(m.cells.length, 12)
  assert.equal(m.counts.not_run, 12, "nenhuma execução observada: pintar de verde ou vermelho seria inventar")
  assert.deepEqual(m.proven, [])
})

// ── O gate de publicação ───────────────────────────────────────────────────

const guard = async (over = {}) => {
  const { publishGuard } = await imp("src/project-plan/publish-guard.js")
  return publishGuard({ cwd: repoRoot, exec: () => "", dream: () => ({ summary: {}, claims: [] }), ...over })
}
const check = (r) => r.checks.find((c) => c.id === "support-matrix")

test("matriz 0/12 NÃO reprova o release: ausência de execução não é defeito", async () => {
  const r = await guard()
  assert.equal(check(r).status, "not_applicable")
  assert.ok(!r.failed.includes("support-matrix"), "reprovar por `not_run` diria 'quebrado' onde ninguém mediu")
})

test("CONTROLE NEGATIVO: célula que FALHOU reprova o release", async () => {
  const r = await guard({
    supportMatrix: () => ({
      cells: [{ key: "ubuntu-latest::node22", verdict: "fail", problems: [] }],
      proven: [], invalidCells: [],
    }),
  })
  assert.equal(check(r).status, "failed")
  assert.ok(check(r).detail.includes("ubuntu-latest::node22"))
})

test("CONTROLE NEGATIVO: declaração acima da prova reprova o release", async () => {
  const r = await guard({
    supportMatrix: () => ({
      cells: [{ key: "ubuntu-latest::node22", verdict: "not_run", problems: [] }],
      proven: [], invalidCells: [], declaredSupport: ["ubuntu-latest::node22"],
    }),
  })
  assert.equal(check(r).status, "failed")
  assert.ok(check(r).detail.includes("sem prova"))
})
