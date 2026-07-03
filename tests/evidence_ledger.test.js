import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("recordEvidence: só fonte determinística prova; LLM/review vira advisory", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ev-"))
  try {
    const { recordEvidence, readEvidence } = await imp("src/project-plan/evidence-ledger.js")
    const gate = recordEvidence(cwd, "t1", { step: "verify", source: "verify", status: "proved", result: "verify ok" })
    assert.equal(gate.status, "proved")
    // review NUNCA prova, mesmo pedindo proved
    const rev = recordEvidence(cwd, "t1", { step: "review", source: "review", status: "proved", result: "LLM aprovou" })
    assert.equal(rev.status, "advisory", "review não pode virar proof")
    const back = readEvidence(cwd, "t1")
    assert.equal(back.length, 2)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("evidence ledger redige secrets e trunca — nunca vaza segredo", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ev-"))
  try {
    const { recordEvidence, evidencePath } = await imp("src/project-plan/evidence-ledger.js")
    const rec = recordEvidence(cwd, "t2", {
      step: "dev", source: "command", status: "proved",
      result: "token=ghp_ABCDEF1234567890abcdef1234567890abcd subiu",
      evidence: "y".repeat(1000),
    })
    assert.ok(!/ghp_ABCDEF/.test(rec.result))
    assert.ok(rec.result.includes("REDACTED"))
    assert.ok(rec.evidence.includes("truncado"))
    const raw = await readFile(evidencePath(cwd, "t2"), "utf-8")
    assert.ok(!raw.includes("ghp_ABCDEF"), "secret nunca no arquivo")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("taskComplete: no proof, no done — precisa de prova e sem failed/pending", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ev-"))
  try {
    const { recordEvidence, readEvidence, taskComplete } = await imp("src/project-plan/evidence-ledger.js")
    // só advisory → NÃO completa (sem prova)
    recordEvidence(cwd, "t3", { step: "review", source: "review", status: "proved" })
    assert.equal(taskComplete(readEvidence(cwd, "t3")), false)
    // adiciona prova, mas há um pending → ainda não
    recordEvidence(cwd, "t3", { step: "build", source: "build", status: "proved" })
    recordEvidence(cwd, "t3", { step: "test", source: "test", status: "pending" })
    assert.equal(taskComplete(readEvidence(cwd, "t3")), false)
    // resolve o pending com prova (mesmo step, último vence) → completa
    recordEvidence(cwd, "t3", { step: "test", source: "test", status: "proved" })
    assert.equal(taskComplete(readEvidence(cwd, "t3")), true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("evento sem prova nenhuma nunca completa; TASK.md reflete o estado", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ev-"))
  try {
    const { recordEvidence, readEvidence, taskComplete, writeTaskMd, taskMdPath } = await imp("src/project-plan/evidence-ledger.js")
    recordEvidence(cwd, "t4", { step: "test", source: "test", status: "failed", result: "2 quebrando" })
    assert.equal(taskComplete(readEvidence(cwd, "t4")), false)
    writeTaskMd(cwd, "t4", "objetivo x")
    const md = await readFile(taskMdPath(cwd, "t4"), "utf-8")
    assert.match(md, /INCOMPLETO/)
    assert.match(md, /\[failed\] \*\*test\*\*/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
