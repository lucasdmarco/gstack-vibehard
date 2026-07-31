import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function captureStdout() {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  return { get: () => out, restore: () => { process.stdout.write = orig } }
}

/**
 * PRD51 S51.3.4 — `prd status` agrega os checklists canônicos no schema comum do ledger.
 * READ-ONLY (camada knowledge — nunca edita fonte).
 *
 * S51.10.1 — PRD51 entrou no agregado: o programa de FECHAMENTO era o único fora do
 * próprio ledger. As asserções deixaram de fixar a contagem para não precisarem de
 * manutenção a cada PRD novo; o que importa é que TODO programa registrado tenha schema,
 * evidência real e zero violação.
 */

test("buildPrdStatusReport: cobre PRD45-PRD51, cada um com schema comum e SEM violações (todos delivered têm prova real)", async () => {
  const { buildPrdStatusReport } = await imp("src/commands/prd.js")
  const report = buildPrdStatusReport(repoRoot)
  const ids = report.map((p) => p.prdId)
  for (const esperado of ["PRD45", "PRD46", "PRD47", "PRD48", "PRD49", "PRD50", "PRD51"]) {
    assert.ok(ids.includes(esperado), `${esperado} está no ledger`)
  }
  for (const p of report) {
    assert.equal(p.schemaVersion, "gstack.prd-ledger.v1")
    assert.equal(p.violations.length, 0, `${p.prdId} não deveria ter violação de prova`)
    assert.ok(Array.isArray(p.evidence) && p.evidence.length > 0, `${p.prdId} deveria ter evidência real`)
  }
})

test("prd status --json: JSON puro com todos os programas registrados", async () => {
  const { prdCommand, buildPrdStatusReport } = await imp("src/commands/prd.js")
  const esperado = buildPrdStatusReport(repoRoot).length
  const cap = captureStdout()
  let r
  try { r = await prdCommand(["status", "--json"], { cwd: repoRoot }) }
  finally { cap.restore() }
  const parsed = JSON.parse(cap.get().trim())
  assert.equal(parsed.schemaVersion, "gstack.prd-status-report.v1")
  assert.equal(parsed.programs.length, esperado)
  assert.equal(r.programs.length, esperado)
})

// S51.10.1: o DoD do §9 sai no `--json` junto do ledger. Uma pendência que só existe no
// código-fonte do checklist não serve para conduzir um RC.
test("prd status --json carrega o DoD do PRD51, com as pendências abertas explícitas", async () => {
  const { prdCommand } = await imp("src/commands/prd.js")
  const cap = captureStdout()
  try { await prdCommand(["status", "--json"], { cwd: repoRoot }) }
  finally { cap.restore() }
  const parsed = JSON.parse(cap.get().trim())
  assert.ok(parsed.dod, "o bloco do DoD existe no contrato JSON")
  assert.equal(parsed.dod.total, 24)
  assert.equal(parsed.dod.programComplete, false, "não pode alegar concluído com caixa aberta")
  assert.ok(parsed.dod.open.length > 0)
  for (const d of parsed.dod.open) assert.ok(d.missing, `${d.id} diz o que falta`)
})

test("prd <subcomando desconhecido>: erro honesto, nunca lança nem finge sucesso", async () => {
  const { prdCommand } = await imp("src/commands/prd.js")
  const cap = captureStdout()
  let r
  try { r = await prdCommand(["bogus", "--json"], { cwd: repoRoot }) }
  finally { cap.restore() }
  assert.equal(r.error, true)
  assert.match(cap.get(), /subcomando desconhecido/)
})

test("layerOf('prd') é knowledge — read-only, nunca edita fonte", async () => {
  const { layerOf } = await imp("src/meta/command-layers.js")
  assert.equal(layerOf("prd"), "knowledge")
})

test("DISPATCH: 'prd' é um comando real registrado na CLI", async () => {
  const cliSrc = (await import("node:fs")).readFileSync(path.join(repoRoot, "src/cli/index.js"), "utf-8")
  assert.match(cliSrc, /prd:\s*\(a\)\s*=>\s*prdCommand\(a\)/)
})
