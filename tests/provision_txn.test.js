import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.5 (P1.7/P1.8) — install/create Full não eram transacionais: falha tardia deixava
// máquina e projeto parcialmente modificados (o fluxo do INICIANTE), terminando em
// `partial_with_restore_available` com restore MANUAL. E o dry-run omitia os efeitos reais
// (Docker/Casdoor/ECC/rede) — consentimento informado falso. Correção: operation plan ÚNICO
// (dry-run e executor consomem o mesmo), journal write-ahead, compensação automática em ordem
// reversa, ownership por recurso, estados `committed|rolled_back|rollback_failed`, recovery
// após crash.

const mod = path.resolve(import.meta.dirname, "..", "src", "installer", "provision-txn.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)
const withTmp = async (fn) => { const d = await mkdtemp(path.join(tmpdir(), "gstack-op-")); try { return await fn(d) } finally { await rm(d, { recursive: true, force: true }) } }

// Op de teste que registra apply/compensate numa trilha, com opção de falhar no apply.
const op = (id, trail, { fail = false, ...extra } = {}) => ({
  id, kind: "file", description: `op ${id}`, scope: "project", reason: `porque ${id}`, ...extra,
  apply: () => { if (fail) throw new Error(`apply ${id} falhou`); trail.push(`apply:${id}`) },
  compensate: () => { trail.push(`undo:${id}`) },
})

test("commit: todas as ops aplicam em ordem; estado committed; nada compensado", async () => {
  await withTmp(async (dir) => {
    const { executePlan } = await imp()
    const trail = []
    const r = await executePlan([op("a", trail), op("b", trail), op("c", trail)], { journalDir: dir })
    assert.equal(r.state, "committed")
    assert.deepEqual(trail, ["apply:a", "apply:b", "apply:c"], "ordem preservada, sem undo")
    assert.equal(r.applied.length, 3)
  })
})

test("FAULT-INJECTION: falha na op N compensa as anteriores em ORDEM REVERSA (rolled_back)", async () => {
  await withTmp(async (dir) => {
    const { executePlan } = await imp()
    const trail = []
    const r = await executePlan([op("a", trail), op("b", trail), op("c", trail, { fail: true }), op("d", trail)], { journalDir: dir })
    assert.equal(r.state, "rolled_back")
    // a,b aplicaram; c falhou (não aplicou); d nunca rodou. Undo reverso: b, depois a.
    assert.deepEqual(trail, ["apply:a", "apply:b", "undo:b", "undo:a"], "compensação em ordem reversa")
    assert.equal(r.failedOp, "c")
  })
})

test("a op que FALHOU não é compensada (não foi aplicada — ownership por recurso)", async () => {
  await withTmp(async (dir) => {
    const { executePlan } = await imp()
    const trail = []
    await executePlan([op("a", trail), op("b", trail, { fail: true })], { journalDir: dir })
    assert.ok(!trail.includes("undo:b"), "CONTROLE NEGATIVO: não compensa o que não aplicou")
    assert.deepEqual(trail, ["apply:a", "undo:a"])
  })
})

test("rollback_failed: se um compensador lança, o estado é rollback_failed (nunca 'rolled_back' otimista)", async () => {
  await withTmp(async (dir) => {
    const { executePlan } = await imp()
    const trail = []
    const badUndo = { ...op("b", trail), compensate: () => { throw new Error("undo b explodiu") } }
    const r = await executePlan([op("a", trail), badUndo, op("c", trail, { fail: true })], { journalDir: dir })
    assert.equal(r.state, "rollback_failed", "compensador que falha vira rollback_failed")
    assert.ok(r.rollbackErrors.length >= 1, "reporta o(s) erro(s) de compensação")
    assert.ok(trail.includes("undo:a"), "segue compensando os demais mesmo com um undo falho")
  })
})

test("journal write-ahead: registra a intenção ANTES de aplicar (crash-safe)", async () => {
  await withTmp(async (dir) => {
    const { executePlan, JOURNAL_FILE } = await imp()
    const trail = []
    // op cujo apply crasha o processo "entre" write-ahead e commit: garantimos que o
    // journal já tinha o started ANTES do apply.
    let journalAtApply = null
    const spy = {
      ...op("x", trail),
      apply: async () => { journalAtApply = await readFile(path.join(dir, JOURNAL_FILE), "utf-8"); trail.push("apply:x") },
    }
    await executePlan([spy], { journalDir: dir })
    assert.match(journalAtApply, /op_started/, "o journal tem op_started ANTES do apply concluir")
    assert.match(journalAtApply, /"id":"x"/)
  })
})

test("recovery após crash: journal com op aplicada e SEM commit ⇒ recoverPlan compensa", async () => {
  await withTmp(async (dir) => {
    const { executePlan, recoverPlan } = await imp()
    const trail = []
    // Simula crash: executa um plano que "morre" (não chama commit). Usamos um plano onde a
    // última op registra applied mas o processo "cai" antes de finalizar — emulado por opção.
    await executePlan([op("a", trail), op("b", trail)], { journalDir: dir, simulateCrashAfterApply: true })
    // No "próximo doctor", recoverPlan lê o journal e compensa o que ficou aplicado sem commit.
    const undoTrail = []
    const compensators = { a: () => undoTrail.push("undo:a"), b: () => undoTrail.push("undo:b") }
    const r = await recoverPlan({ journalDir: dir, compensators })
    assert.equal(r.state, "rolled_back")
    assert.deepEqual(undoTrail, ["undo:b", "undo:a"], "recovery compensa em ordem reversa")
  })
})

test("describePlan: dry-run fiel — cada op expõe kind/scope/reason/rollback/network sem executar", async () => {
  const { describePlan } = await imp()
  const trail = []
  const ops = [
    op("dir", trail, { kind: "file", scope: "project", reason: "cria o projeto" }),
    { ...op("casdoor", trail), kind: "container", scope: "global", network: "127.0.0.1:8000", package: "casbin/casdoor", version: "sha256:…", reason: "IAM local", rollbackDesc: "docker compose down -v" },
  ]
  const desc = describePlan(ops)
  assert.equal(desc.length, 2)
  assert.equal(desc[0].kind, "file")
  assert.equal(desc[1].kind, "container")
  assert.equal(desc[1].network, "127.0.0.1:8000", "efeito de REDE é exposto (consentimento informado)")
  assert.equal(desc[1].scope, "global")
  assert.ok(desc[1].rollback, "cada op declara como é revertida")
  assert.deepEqual(trail, [], "CONTROLE NEGATIVO: describe NUNCA executa apply/compensate")
})
