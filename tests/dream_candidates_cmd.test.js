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
