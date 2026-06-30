import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const att = path.join(repoRoot, "src", "vfa", "attestation.js")
const prov = path.join(repoRoot, "src", "vfa", "provenance.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

test("buildReceipt: hashes de input/output, previousHash e receiptHash selado", async () => {
  const { buildReceipt, GENESIS, recomputeHash } = await imp(att)
  const r = buildReceipt({ runId: "run1", intent: "edit_file", input: "abc", output: "def", actionId: "act_x", timestamp: "2026-06-30T00:00:00Z" })
  assert.match(r.inputHash, /^sha256:/)
  assert.match(r.outputHash, /^sha256:/)
  assert.equal(r.previousHash, GENESIS, "1º recibo encadeia no genesis")
  assert.equal(recomputeHash(r), r.receiptHash, "receiptHash sela o conteúdo")
})

test("stableStringify: ordem de chaves não afeta o hash (determinístico)", async () => {
  const { buildReceipt } = await imp(att)
  const a = buildReceipt({ runId: "r", actionId: "x", timestamp: "t", actor: { a: 1, b: 2 } })
  const b = buildReceipt({ runId: "r", actionId: "x", timestamp: "t", actor: { b: 2, a: 1 } })
  assert.equal(a.receiptHash, b.receiptHash)
})

// ── ABUSO: adulterar um campo OU remover um recibo quebra a verificação ──
test("verifyChain: cadeia íntegra passa; adulteração/remoção QUEBRA", async () => {
  const { buildReceipt, verifyChain } = await imp(att)
  const r1 = buildReceipt({ runId: "r", actionId: "a1", timestamp: "1", intent: "x" })
  const r2 = buildReceipt({ runId: "r", actionId: "a2", timestamp: "2", intent: "y", previousHash: r1.receiptHash })
  const r3 = buildReceipt({ runId: "r", actionId: "a3", timestamp: "3", intent: "z", previousHash: r2.receiptHash })
  assert.equal(verifyChain([r1, r2, r3]).valid, true)

  // adultera um campo do meio SEM recomputar o hash → receiptHash não confere
  const tampered = [r1, { ...r2, intent: "HACKED" }, r3]
  const v1 = verifyChain(tampered)
  assert.equal(v1.valid, false); assert.equal(v1.brokenAt, 1)

  // remove o do meio → previousHash de r3 não encaixa
  const v2 = verifyChain([r1, r3])
  assert.equal(v2.valid, false); assert.equal(v2.brokenAt, 1)
})

// ── provenance: append-only, redação de segredo, e verify por run ──
test("recordAction + verifyRun: encadeia, redige segredo, valida; jsonl adulterado falha", async () => {
  const { recordAction, verifyRun, readRun } = await imp(prov)
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-prov-"))
  try {
    recordAction(dir, { runId: "run1", intent: "read_secret", target: { kind: "file", pathOrName: "postgres://u:TOPSECRETVAL@h/db" }, secretValues: ["TOPSECRETVAL"] })
    recordAction(dir, { runId: "run1", intent: "edit_file", target: { kind: "file", pathOrName: "src/a.js" } })
    const run = readRun(dir, "run1")
    assert.equal(run.length, 2)
    assert.equal(run[1].previousHash, run[0].receiptHash, "encadeado")
    // segredo redigido em disco
    const raw = await readFile(path.join(dir, ".gstack", "provenance", "actions.jsonl"), "utf-8")
    assert.ok(!raw.includes("TOPSECRETVAL"), "segredo NUNCA em claro no provenance")
    assert.ok(raw.includes("***"))
    assert.equal(verifyRun(dir, "run1").valid, true)

    // adultera o actions.jsonl à mão → verify falha
    await writeFile(path.join(dir, ".gstack", "provenance", "actions.jsonl"), raw.replace("edit_file", "delete_everything"))
    assert.equal(verifyRun(dir, "run1").valid, false, "adulteração do jsonl quebra a cadeia")
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})
