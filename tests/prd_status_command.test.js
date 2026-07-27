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
 * PRD51 S51.3.4 — `prd status` agrega os checklists canônicos de PRD45-PRD50 no
 * schema comum do ledger. READ-ONLY (camada knowledge — nunca edita fonte).
 */

test("buildPrdStatusReport: cobre PRD45-PRD50, cada um com schema comum e SEM violações (todos delivered têm prova real)", async () => {
  const { buildPrdStatusReport } = await imp("src/commands/prd.js")
  const report = buildPrdStatusReport(repoRoot)
  assert.deepEqual(report.map((p) => p.prdId), ["PRD45", "PRD46", "PRD47", "PRD48", "PRD49", "PRD50"])
  for (const p of report) {
    assert.equal(p.schemaVersion, "gstack.prd-ledger.v1")
    assert.equal(p.violations.length, 0, `${p.prdId} não deveria ter violação de prova`)
    assert.ok(Array.isArray(p.evidence) && p.evidence.length > 0, `${p.prdId} deveria ter evidência real`)
  }
})

test("prd status --json: JSON puro com os 6 programas", async () => {
  const { prdCommand } = await imp("src/commands/prd.js")
  const cap = captureStdout()
  let r
  try { r = await prdCommand(["status", "--json"], { cwd: repoRoot }) }
  finally { cap.restore() }
  const parsed = JSON.parse(cap.get().trim())
  assert.equal(parsed.schemaVersion, "gstack.prd-status-report.v1")
  assert.equal(parsed.programs.length, 6)
  assert.equal(r.programs.length, 6)
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
