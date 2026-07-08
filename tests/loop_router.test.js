import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── detecção ───────────────────────────────────────────────────────────────────
test("detectLoopSignals: knowledge vs build vs parallel vs delegate", async () => {
  const { detectLoopSignals } = await imp("src/skills/loop-router.js")
  assert.equal(detectLoopSignals("explicar como o pipeline funciona")[0], "knowledge_only")
  assert.equal(detectLoopSignals("delegar essa tarefa ao codex")[0], "delegate_single_harness")
  assert.equal(detectLoopSignals("rodar vários agentes em paralelo")[0], "meta_harness_parallel")
  assert.equal(detectLoopSignals("criar um dashboard novo")[0], "replit_pipeline")
  assert.deepEqual(detectLoopSignals("xyzzy nada casa"), [])
})

// ── decisão ────────────────────────────────────────────────────────────────────
test("buildLoopDecision: flag > sinais > palpite; ambiguous só no palpite", async () => {
  const { buildLoopDecision } = await imp("src/skills/loop-router.js")
  const byFlag = buildLoopDecision({ objective: "criar app", flags: { loop: "workflow_graph" } })
  assert.equal(byFlag.mode, "workflow_graph"); assert.equal(byFlag.source, "user_flag"); assert.equal(byFlag.confidence, "high")
  const bySignal = buildLoopDecision({ objective: "refatorar o módulo de auth" })
  assert.equal(bySignal.mode, "task_worktree_loop"); assert.equal(bySignal.source, "intent_signals"); assert.equal(bySignal.ambiguous, false)
  const guess = buildLoopDecision({ objective: "asdf qwer zxcv" })
  assert.equal(guess.mode, "replit_pipeline"); assert.equal(guess.source, "default_guess"); assert.equal(guess.ambiguous, true)
})

test("buildLoopDecision: flag inválida cai para sinais (não confia cegamente)", async () => {
  const { buildLoopDecision } = await imp("src/skills/loop-router.js")
  const r = buildLoopDecision({ objective: "criar landing page", flags: { loop: "modo_inexistente" } })
  assert.equal(r.source, "intent_signals"); assert.equal(r.mode, "replit_pipeline")
})

// ── honestidade: não chuta em não-interativo ambíguo ─────────────────────────────
test("resolveLoopDecision: NÃO-interativo + ambíguo → needs_user_confirmation acionável", async () => {
  const { resolveLoopDecision } = await imp("src/skills/loop-router.js")
  const blocked = resolveLoopDecision({ objective: "asdf zxcv", interactive: false })
  assert.equal(blocked.status, "needs_user_confirmation")
  assert.ok(blocked.actionable.options.length === 6, "oferece os 6 modos reais")
  assert.match(blocked.actionable.hint, /--loop/)
  // interativo pode usar o palpite (o humano corrige na hora)
  assert.equal(resolveLoopDecision({ objective: "asdf zxcv", interactive: true }).status, "decided")
  // sinal claro nunca precisa de confirmação
  assert.equal(resolveLoopDecision({ objective: "criar um site", interactive: false }).status, "decided")
})

// ── wiring no start ──────────────────────────────────────────────────────────────
const startOpts = (dir, extra = {}) => ({
  cwd: dir,
  classify: () => ({ state: "empty_dir", description: "", signals: {}, actions: [] }),
  exec: () => ({ ok: true }), gateExec: () => ({ ok: true, code: 0 }),
  devRunner: () => ({ services: [] }),
  verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
  scoutRunner: () => ({ status: "not_applicable", detail: "teste" }),
  prompt: async () => "proj", select: async (_q, choices) => choices[0],
  ...extra,
})

test("start: declara loop-decision.json no plano (modo inferido da intenção)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-loop-"))
  try {
    const r = await startCommand([], startOpts(dir, {
      objective: "refatorar o parser de logs deste projeto", // task_worktree_loop
      designSystem: "none", // template do plano ativa frontend; foco aqui é o loop, não o DS
      confirm: async () => false, // só declara
    }))
    assert.equal(r.loopDecision.mode, "task_worktree_loop")
    assert.equal(r.executed, false)
    const planId = (await import("node:fs")).readdirSync(path.join(dir, ".gstack", "plans"))[0]
    const rec = JSON.parse(readFileSync(path.join(dir, ".gstack", "plans", planId, "loop-decision.json"), "utf-8"))
    assert.equal(rec.schemaVersion, "gstack.loop-decision.v1"); assert.equal(rec.status, "decided")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
