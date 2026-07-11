import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD37 37.0/37.1 — Loop Contract: bounded, LLM propõe/observação decide, só
// valida com evidência; intenção específica (não scaffold genérico).

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("classifyIntent: 'criar projeto' vs 'implementar feature'; scaffold genérico é flagrado", async () => {
  const { classifyIntent } = await imp("src/skills/replit-loop.js")
  assert.equal(classifyIntent("implementar tela de login").kind, "implement_feature")
  assert.equal(classifyIntent("criar um novo app").kind, "create_project")
  assert.equal(classifyIntent("criar um novo projeto").isGenericScaffold, true)
  assert.equal(classifyIntent("criar um novo app com login e dashboard").isGenericScaffold, false)
})

test("buildLoopState: schema + fases + budget bounded + intentKind", async () => {
  const { buildLoopState, REPLIT_LOOP_SCHEMA } = await imp("src/skills/replit-loop.js")
  const s = buildLoopState({ runId: "r1", intent: "implementar checkout", acceptance: ["carrinho soma certo"] })
  assert.equal(s.schemaVersion, REPLIT_LOOP_SCHEMA)
  assert.equal(s.intentKind, "implement_feature")
  assert.equal(s.phase, "implement")
  assert.ok(s.budget.maxIterations >= 1)
  assert.deepEqual(s.acceptance, ["carrinho soma certo"])
})

test("loopExhausted: bounded por iterações e por tempo (nunca loop infinito)", async () => {
  const { buildLoopState, loopExhausted } = await imp("src/skills/replit-loop.js")
  const s = buildLoopState({ runId: "r", intent: "x", budget: { maxIterations: 2, maxWallTimeSeconds: 10 } })
  assert.equal(loopExhausted(s).exhausted, false)
  assert.equal(loopExhausted({ ...s, consumed: { iterations: 2, tokens: 0, wallMs: 0 } }).exhausted, true)
  assert.match(loopExhausted({ ...s, consumed: { iterations: 0, tokens: 0, wallMs: 10000 } }).reason, /tempo/)
})

test("recordPhase: avança as fases; checkpoint incrementa iteração", async () => {
  const { buildLoopState, recordPhase } = await imp("src/skills/replit-loop.js")
  let s = buildLoopState({ runId: "r", intent: "x" })
  const order = []
  for (let i = 0; i < 6; i++) { order.push(s.phase); s = recordPhase(s, { ok: true, ms: 1 }) }
  assert.deepEqual(order, ["implement", "run", "observe", "diagnose", "autocorrect", "checkpoint"])
  assert.equal(s.iteration, 1, "fechou 1 iteração no checkpoint")
  assert.equal(s.phase, "implement", "recomeça o ciclo")
})

test("recordPhase: fase de DECISÃO que falha (observe) volta o ciclo para autocorrect (LLM não decide)", async () => {
  const { buildLoopState, recordPhase } = await imp("src/skills/replit-loop.js")
  let s = buildLoopState({ runId: "r", intent: "x" })
  s = recordPhase(s, { ok: true }) // implement→run
  s = recordPhase(s, { ok: true }) // run→observe
  s = recordPhase(s, { ok: false, detail: "console error" }) // observe FALHOU
  assert.equal(s.phase, "autocorrect", "observação decide: falhou → autocorrect")
  assert.equal(s.history.at(-1).decider, "observation")
})

test("loopVerdict: só 'validated' com observação limpa; senão degraded/needs_user", async () => {
  const { buildLoopState, loopVerdict } = await imp("src/skills/replit-loop.js")
  const s = buildLoopState({ runId: "r", intent: "x", budget: { maxIterations: 3, maxWallTimeSeconds: 100 } })
  assert.equal(loopVerdict(s, { visualValidated: true, problems: [] }).verdict, "validated")
  assert.equal(loopVerdict(s, { visualValidated: false, problems: ["erro"] }).verdict, "degraded")
  assert.equal(loopVerdict(s, null).verdict, "degraded", "sem observação nunca valida")
  const exhausted = { ...s, consumed: { iterations: 3, tokens: 0, wallMs: 0 } }
  assert.equal(loopVerdict(exhausted, null).verdict, "needs_user")
})

test("persist/readLoopState: grava e recarrega loop.json", async () => {
  const { buildLoopState, persistLoopState, readLoopState } = await imp("src/skills/replit-loop.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-loop-"))
  try {
    const s = buildLoopState({ runId: "rl", intent: "implementar busca" })
    persistLoopState({ root, state: s })
    assert.ok(existsSync(path.join(root, ".gstack", "runs", "rl", "loop.json")))
    assert.equal(readLoopState({ root, runId: "rl" }).intent, "implementar busca")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("CLI loop plan --json: monta o contrato, grava loop.json, sem intent → erro", async () => {
  const { loopCommand } = await imp("src/commands/loop.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-loopcli-"))
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await loopCommand(["plan", "--intent", "implementar carrinho", "--run", "c1", "--json"], { cwd }) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.replit-loop.v1")
  assert.equal(parsed.intentKind, "implement_feature")
  assert.ok(existsSync(path.join(cwd, ".gstack", "runs", "c1", "loop.json")))
  await rm(cwd, { recursive: true, force: true })
})
