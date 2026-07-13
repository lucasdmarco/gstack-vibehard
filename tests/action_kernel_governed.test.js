import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src/skills/action-kernel.js"))}?t=${Date.now()}`)

const ALLOW = { tool: "Write", harness: "claude", files: ["src/app.js"], command: null }
const DENY = { tool: "Bash", harness: "claude", command: "rm -rf /" }

test("governed: ação permitida EXECUTA, gera recibo e 1 entrada no ledger", async () => {
  const { runGovernedAction, readActions } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-ak-"))
  try {
    let ran = 0
    const r = await runGovernedAction({
      action: ALLOW, ctx: { planApproved: true, designResolved: true }, root, runId: "run1",
      execute: () => { ran++; return { ok: true, exitCode: 0, summary: "escrito" } },
    })
    assert.equal(r.decision, "allow")
    assert.equal(r.executed, true)
    assert.equal(ran, 1, "execute rodou exatamente 1×")
    assert.equal(r.receipt.ok, true)
    const ledger = readActions({ root, runId: "run1" })
    assert.equal(ledger.length, 1, "uma entrada no ledger")
    assert.equal(ledger[0].executed, true)
    assert.equal(ledger[0].decision, "allow")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("CONFORMANCE (P1.3): ação NEGADA + enforced NÃO executa — controle negativo", async () => {
  const { runGovernedAction, readActions } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-ak-"))
  try {
    let ran = 0
    const r = await runGovernedAction({
      action: DENY, ctx: {}, root, runId: "run2",
      execute: () => { ran++; return { ok: true } }, // se o kernel não gatear, ISTO roda
    })
    assert.equal(r.decision, "deny")
    assert.equal(r.executed, false, "ação destrutiva NÃO executa sob enforcement")
    assert.equal(ran, 0, "execute NUNCA foi chamado — se alguém remover o gate, isto falha")
    assert.equal(r.receipt.exitCode, 126)
    const ledger = readActions({ root, runId: "run2" })
    assert.equal(ledger[0].decision, "deny")
    assert.equal(ledger[0].executed, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("harness INSTRUCIONAL (enforced:false): deny é ADVISORY — registra mas não simula bloqueio", async () => {
  const { runGovernedAction } = await imp()
  const root = await mkdtemp(path.join(tmpdir(), "gstack-ak-"))
  try {
    let ran = 0
    const r = await runGovernedAction({
      action: DENY, ctx: { enforced: false }, root, runId: "run3",
      execute: () => { ran++; return { ok: true, exitCode: 0 } },
    })
    assert.equal(r.decision, "deny", "a decisão do gate é registrada honestamente")
    assert.equal(r.enforced, false)
    assert.equal(r.executed, true, "instrucional não pode REALMENTE bloquear — não finge")
    assert.equal(ran, 1)
    assert.equal(r.record.advisory, true, "recibo declara advisory (P0.8)")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("governed: execute assíncrono é aguardado", async () => {
  const { runGovernedAction } = await imp()
  const r = await runGovernedAction({
    action: ALLOW, ctx: { planApproved: true, designResolved: true },
    execute: async () => { await new Promise((res) => setTimeout(res, 5)); return { ok: true, exitCode: 0 } },
  })
  assert.equal(r.executed, true)
  assert.equal(r.receipt.ok, true)
})
