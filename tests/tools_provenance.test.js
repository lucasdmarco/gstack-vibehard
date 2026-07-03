import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("recordToolProvenance grava recibo; readToolProvenance filtra só tool:*", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-tp-"))
  try {
    mkdirSync(path.join(cwd, ".gstack"), { recursive: true })
    const { recordToolProvenance, readToolProvenance } = await imp("src/tools/provenance.js")
    recordToolProvenance(cwd, { slug: "stripe", origin: "remote", decision: "install", risk: "medium" })
    recordToolProvenance(cwd, { slug: "danger", origin: "remote", decision: "skip", risk: "high" })
    const recs = readToolProvenance(cwd)
    assert.equal(recs.length, 2)
    assert.ok(recs.every((r) => r.intent.startsWith("tool:")))
    const install = recs.find((r) => r.intent === "tool:install")
    assert.equal(install.policy.decision, "allow")
    const skip = recs.find((r) => r.intent === "tool:skip")
    assert.equal(skip.policy.decision, "deny")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("recordToolProvenance é best-effort: cwd inexistente não lança", async () => {
  const { recordToolProvenance } = await imp("src/tools/provenance.js")
  assert.doesNotThrow(() => recordToolProvenance(path.join(tmpdir(), "nao-existe-xyz"), { slug: "x" }))
})
