import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.4 — checkpoint-presenter: usuário compara e restaura por comando; restore
// NUNCA apaga audit trail (reusa provenance append-only, PRD13 §10.3).

test("presentCheckpoints: rótulo humano sobre listCheckpoints real (loop-checkpoint.js, sem duplicar)", async () => {
  const { presentCheckpoints } = await imp("src/skills/checkpoint-presenter.js")
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = mkdtempSync(path.join(tmpdir(), "gstack-ckpt-present-"))
  try {
    writeFileSync(path.join(root, "a.txt"), "v1")
    createCheckpoint({ root, runId: "run-1", files: ["a.txt"], green: true, note: "primeiro verde" })
    const list = presentCheckpoints({ root, runId: "run-1" })
    assert.equal(list.length, 1)
    assert.equal(list[0].seq, 1)
    assert.equal(list[0].green, true)
    assert.equal(list[0].fileCount, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("diffCheckpoints: mostra SÓ os arquivos que mudaram de hash entre 2 checkpoints", async () => {
  const { diffCheckpoints } = await imp("src/skills/checkpoint-presenter.js")
  const a = { files: [{ path: "x.js", sha256: "h1" }, { path: "y.js", sha256: "h2" }] }
  const b = { files: [{ path: "x.js", sha256: "h1" }, { path: "y.js", sha256: "h3" }] }
  const d = diffCheckpoints(a, b)
  assert.deepEqual(d.changed, ["y.js"])
})

test("restoreWithProvenance: restore REAL via loop-checkpoint.js + recibo de provenance append-only (NUNCA apaga audit trail, DoD)", async () => {
  const { restoreWithProvenance } = await imp("src/skills/checkpoint-presenter.js")
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const { readRun } = await imp("src/vfa/provenance.js")
  const root = mkdtempSync(path.join(tmpdir(), "gstack-ckpt-restore-"))
  try {
    writeFileSync(path.join(root, "a.txt"), "verde")
    const ckpt = createCheckpoint({ root, runId: "run-1", files: ["a.txt"], green: true })
    writeFileSync(path.join(root, "a.txt"), "quebrado")
    const r = restoreWithProvenance({ root, runId: "run-1", seq: ckpt.seq })
    assert.equal(r.ok, true)
    assert.ok(r.provenanceReceipt, "recibo de provenance gerado")
    const receipts = readRun(root, "run-1")
    assert.ok(receipts.length >= 1, "audit trail JAMAIS apagado — recibo append-only presente")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("taskCommand checkpoints <runId> --json: lista via CLI real", async () => {
  const { taskCommand } = await imp("src/commands/task.js")
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-task-ckpts-"))
  try {
    writeFileSync(path.join(cwd, "a.txt"), "v1")
    createCheckpoint({ root: cwd, runId: "run-1", files: ["a.txt"], green: true })
    const chunks = []
    const orig = process.stdout.write
    process.stdout.write = (s) => { chunks.push(s); return true }
    try { await taskCommand(["checkpoints", "run-1", "--json"], { cwd }) } finally { process.stdout.write = orig }
    const out = JSON.parse(chunks.join(""))
    assert.equal(out.checkpoints.length, 1)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("taskCommand restore <runId> --checkpoint <n> SEM --yes: exige confirmação, nunca restaura por decreto", async () => {
  const { taskCommand } = await imp("src/commands/task.js")
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-task-restore-noyes-"))
  try {
    writeFileSync(path.join(cwd, "a.txt"), "v1")
    const ckpt = createCheckpoint({ root: cwd, runId: "run-1", files: ["a.txt"], green: true })
    const chunks = []
    const orig = process.stdout.write
    process.stdout.write = (s) => { chunks.push(s); return true }
    try { await taskCommand(["restore", "run-1", "--checkpoint", String(ckpt.seq), "--json"], { cwd }) } finally { process.stdout.write = orig }
    const out = JSON.parse(chunks.join(""))
    assert.equal(out.error, "confirmation_required")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("restoreWithProvenance: checkpoint adulterado -> ABORTA (tamper_detected), NUNCA restaura nem grava recibo de sucesso falso", async () => {
  const { restoreWithProvenance } = await imp("src/skills/checkpoint-presenter.js")
  const { createCheckpoint } = await imp("src/skills/loop-checkpoint.js")
  const root = mkdtempSync(path.join(tmpdir(), "gstack-ckpt-tamper-"))
  try {
    writeFileSync(path.join(root, "a.txt"), "original")
    const ckpt = createCheckpoint({ root, runId: "run-1", files: ["a.txt"], green: true })
    const blobPath = path.join(root, ".gstack", "runs", "run-1", "checkpoints", String(ckpt.seq), "files", "a.txt")
    writeFileSync(blobPath, "ADULTERADO")
    const r = restoreWithProvenance({ root, runId: "run-1", seq: ckpt.seq })
    assert.equal(r.ok, false)
    assert.equal(r.reason, "tamper_detected")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
