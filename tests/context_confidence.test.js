import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("aggregateConfidence: média dos top-5; vazio = 0", async () => {
  const { aggregateConfidence } = await imp("src/skills/context-confidence.js")
  assert.equal(aggregateConfidence([]), 0)
  assert.equal(aggregateConfidence([{ confidence: 0.8 }, { confidence: 0.6 }]), 0.7)
})

test("loadContextPolicy: default seguro (ask, remoto off); modo inválido cai p/ ask", async () => {
  const { loadContextPolicy } = await imp("src/skills/context-confidence.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-ctxpol-"))
  try {
    const def = loadContextPolicy(dir)
    assert.equal(def.mode, "ask"); assert.equal(def.allowRemote, false)
    mkdirSync(path.join(dir, ".gstack"), { recursive: true })
    writeFileSync(path.join(dir, ".gstack", "context-policy.json"), JSON.stringify({ mode: "xxx", allowRemote: true, remoteBackend: "fc" }))
    const p = loadContextPolicy(dir)
    assert.equal(p.mode, "ask", "modo inválido → ask"); assert.equal(p.allowRemote, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("resolveEnhancement: confiança suficiente → none; disabled → disabled", async () => {
  const { resolveEnhancement } = await imp("src/skills/context-confidence.js")
  assert.equal(resolveEnhancement({ confidence: 0.9, policy: { mode: "ask" } }).action, "none")
  assert.equal(resolveEnhancement({ confidence: 0.1, policy: { mode: "disabled" } }).action, "disabled")
})

test("resolveEnhancement: baixa confiança — sem TTY em ask NÃO decide; project_auto = local", async () => {
  const { resolveEnhancement } = await imp("src/skills/context-confidence.js")
  const noTty = resolveEnhancement({ confidence: 0.2, policy: { mode: "ask" }, interactive: false })
  assert.equal(noTty.action, "needs_user_confirmation")
  assert.equal(resolveEnhancement({ confidence: 0.2, policy: { mode: "ask" }, autoEnhance: true }).action, "local_enhance")
  assert.equal(resolveEnhancement({ confidence: 0.2, policy: { mode: "project_auto" } }).action, "local_enhance")
  assert.equal(resolveEnhancement({ confidence: 0.2, policy: { mode: "ask" }, interactive: true }).action, "ask_user")
})

test("remoteAllowed: só com allowRemote:true E backend definido (nunca default)", async () => {
  const { remoteAllowed } = await imp("src/skills/context-confidence.js")
  assert.equal(remoteAllowed({ allowRemote: false }), false)
  assert.equal(remoteAllowed({ allowRemote: true, remoteBackend: null }), false)
  assert.equal(remoteAllowed({ allowRemote: true, remoteBackend: "fc" }), true)
})

test("scout: retorna contextConfidence agregado", async () => {
  const { scout } = await imp("src/context-docs/scout.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-scout-conf-"))
  try {
    writeFileSync(path.join(dir, "notes.md"), "auth login flow\nsupabase token here")
    const r = scout({ cwd: dir, question: "auth login supabase" })
    assert.equal(typeof r.contextConfidence, "number")
    assert.ok(r.contextConfidence >= 0 && r.contextConfidence <= 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
