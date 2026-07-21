import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtempSync(path.join(tmpdir(), p))

test("dream candidates --json: sem runs -> lista vazia, nunca crash (PRD46 S46.2)", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-dreamcand-empty-")
  try {
    const r = await dreamCommand(["candidates", "--json"], { cwd: dir })
    assert.deepEqual(r.candidates, [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("dream candidates --json: lê o candidate embutido no closeout.json de cada run (read-only)", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-dreamcand-real-")
  try {
    const runDir = path.join(dir, ".gstack", "runs", "run-x")
    mkdirSync(runDir, { recursive: true })
    const candidate = { id: "lc_abc", classification: "skill", title: "algo aprendido", validity: { status: "eligible" }, status: "observed" }
    writeFileSync(path.join(runDir, "closeout.json"), JSON.stringify({ learning: { candidate } }))
    const emptyRunDir = path.join(dir, ".gstack", "runs", "run-y")
    mkdirSync(emptyRunDir, { recursive: true })
    writeFileSync(path.join(emptyRunDir, "closeout.json"), JSON.stringify({ learning: { candidate: null } }))

    const r = await dreamCommand(["candidates", "--json"], { cwd: dir })
    assert.equal(r.candidates.length, 1, "só o run com candidate real aparece")
    assert.equal(r.candidates[0].id, "lc_abc")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("dream candidates: comando é KNOWLEDGE do ponto de vista de leitura — nunca escreve nada", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-dreamcand-nowrite-")
  try {
    await dreamCommand(["candidates", "--json"], { cwd: dir })
    assert.equal(existsSync(path.join(dir, ".gstack")), false, "nada foi criado no disco")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("dream metrics --json: sem runs -> tudo zerado, nunca crash (PRD46 S46.6)", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-dreammetrics-empty-")
  try {
    const r = await dreamCommand(["metrics", "--json"], { cwd: dir })
    assert.equal(r.schemaVersion, "gstack.dream.learning-metrics.v1")
    assert.equal(r.candidates, 0)
    assert.equal(r.promoted, 0)
    assert.equal(r.tokenEstimate.basis, "estimated")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("dream metrics --json: conta candidates reais por status/tentative/deadEnds a partir do closeout.json", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-dreammetrics-real-")
  try {
    const mkRun = (id, candidate) => {
      const runDir = path.join(dir, ".gstack", "runs", id)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(path.join(runDir, "closeout.json"), JSON.stringify({ learning: { candidate } }))
    }
    mkRun("r1", { id: "lc_1", status: "promoted", validity: { status: "eligible" }, deadEnds: [{ signature: "d1" }], dedupe: { decision: "new" } })
    mkRun("r2", { id: "lc_2", status: "observed", validity: { status: "tentative" }, deadEnds: [], dedupe: { decision: "unknown" } })
    mkRun("r3", { id: "lc_3", status: "revoked", validity: { status: "stale" }, deadEnds: [{ signature: "d2" }, { signature: "d3" }], dedupe: { decision: "merge" } })
    mkRun("r4", null) // run sem candidate — não deve contar

    const r = await dreamCommand(["metrics", "--json"], { cwd: dir })
    assert.equal(r.candidates, 3)
    assert.equal(r.promoted, 1)
    assert.equal(r.revoked, 1)
    assert.equal(r.tentative, 1)
    assert.equal(r.deadEndsAvoided, 3)
    assert.equal(r.reuseHits, 1, "só 'merge'/'update' contam — 'new'/'unknown' não")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
