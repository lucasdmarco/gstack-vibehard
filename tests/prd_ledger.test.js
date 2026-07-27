import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.3.1 — schema comum de ledger (`releaseReady/programComplete/
 * operationallyProven/fullyValidated/residuals/nonGoals/evidence`) reusando
 * `release/baseline.js` (S51.0B/C) em vez de duplicar a lógica dos 4 estados.
 * Ação #4: `status:"delivered"` sem prova em disco NUNCA conta como pronto.
 */

test("evidenceHash: sha256 real de arquivo existente; null honesto se ausente (nunca inventado)", async () => {
  const { evidenceHash } = await imp("src/dream/prd-ledger.js")
  const real = evidenceHash(repoRoot, "package.json")
  assert.match(real, /^sha256:[0-9a-f]{64}$/)
  assert.equal(evidenceHash(repoRoot, "arquivo/que/nao/existe.js"), null)
  assert.equal(evidenceHash(repoRoot, null), null)
})

test("violationsOf: status delivered SEM prova em disco é violação real", async () => {
  const { violationsOf } = await imp("src/dream/prd-ledger.js")
  const items = [
    { id: "P0.1", status: "delivered", proof: "package.json" },
    { id: "P0.2", status: "delivered", proof: "arquivo/inexistente.js" },
    { id: "P0.3", status: "pending", proof: "outro/inexistente.js" }, // pending não é violação
  ]
  const v = violationsOf(items, repoRoot)
  assert.equal(v.length, 1)
  assert.equal(v[0].id, "P0.2")
})

test("projectPrdLedger: programItems fecham -> programComplete true; residual vira false honesto", async () => {
  const { projectPrdLedger, PRD_LEDGER_SCHEMA } = await imp("src/dream/prd-ledger.js")
  const closed = projectPrdLedger({
    prdId: "PRD-TEST", repoRoot,
    items: [{ id: "P0.1", status: "delivered", proof: "package.json" }],
  })
  assert.equal(closed.schemaVersion, PRD_LEDGER_SCHEMA, "schemaVersion do ledger, não o de release-baseline.js espalhado por cima")
  assert.equal(closed.programComplete, true)
  assert.equal(closed.residuals.length, 0)

  const open = projectPrdLedger({
    prdId: "PRD-TEST", repoRoot,
    items: [{ id: "P0.1", status: "delivered", proof: "package.json" }, { id: "P1.1", status: "pending" }],
  })
  assert.equal(open.programComplete, false)
  assert.equal(open.residuals.length, 1)
  assert.equal(open.residuals[0].id, "P1.1")
})

test("projectPrdLedger: item delivered sem prova em disco DERRUBA releaseReady e programComplete (ação #4)", async () => {
  const { projectPrdLedger } = await imp("src/dream/prd-ledger.js")
  const r = projectPrdLedger({
    prdId: "PRD-TEST", repoRoot, commit: "abc", proof: { ready: true, commit: "abc" },
    items: [{ id: "P0.1", status: "delivered", proof: "arquivo/fantasma.js" }],
  })
  assert.equal(r.programComplete, false, "delivered sem prova em disco nunca conta como completo")
  assert.equal(r.releaseReady, false, "mesma violação também derruba releaseReady")
  assert.equal(r.violations.length, 1)
})

test("projectPrdLedger: nonGoal explícito fecha item sem exigir prova (decisão humana, não omissão)", async () => {
  const { projectPrdLedger } = await imp("src/dream/prd-ledger.js")
  const r = projectPrdLedger({
    prdId: "PRD-TEST", repoRoot,
    items: [
      { id: "P0.1", status: "delivered", proof: "package.json" },
      { id: "P1.1", status: "pending", nonGoal: true, nonGoalReason: "fora do escopo real, decisão explícita" },
    ],
  })
  assert.equal(r.programComplete, true)
  assert.equal(r.nonGoals.length, 1)
  assert.equal(r.nonGoals[0].id, "P1.1")
})

test("projectPrdLedger: evidence[] traz hash real por item com proof", async () => {
  const { projectPrdLedger } = await imp("src/dream/prd-ledger.js")
  const r = projectPrdLedger({
    prdId: "PRD-TEST", repoRoot,
    items: [{ id: "P0.1", status: "delivered", proof: "package.json" }],
  })
  assert.equal(r.evidence.length, 1)
  assert.match(r.evidence[0].hash, /^sha256:/)
})

test("projectPrdLedger: operationallyProven honestamente false sem 20+ runs reais (MIN_RUNS_FOR_OPERATIONAL)", async () => {
  const { projectPrdLedger } = await imp("src/dream/prd-ledger.js")
  const { MIN_RUNS_FOR_OPERATIONAL } = await imp("src/release/baseline.js")
  const semRuns = projectPrdLedger({ prdId: "PRD-TEST", repoRoot, items: [{ id: "P0.1", status: "delivered", proof: "package.json" }] })
  assert.equal(semRuns.operationallyProven, false)
  const comRuns = projectPrdLedger({
    prdId: "PRD-TEST", repoRoot, items: [{ id: "P0.1", status: "delivered", proof: "package.json" }],
    operational: { runs: MIN_RUNS_FOR_OPERATIONAL, failures: 0 },
  })
  assert.equal(comRuns.operationallyProven, true)
})
