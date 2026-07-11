import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD37 37.3 (D3) — diagnose + autocorrect BOUNDED: verifier determinístico
// compara observação × critérios; reprovou → correção limitada (LLM propõe, o
// verifier decide); budget esgotado → para e pede usuário. Nunca finge verde.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("diagnoseObservation: observação limpa + critérios com evidência → passed", async () => {
  const { diagnoseObservation } = await imp("src/skills/diagnose-loop.js")
  const obs = { visualValidated: true, problems: [], checks: { "carrinho soma": true } }
  assert.equal(diagnoseObservation({ observation: obs, acceptance: ["carrinho soma"] }).passed, true)
})

test("diagnoseObservation: critério SEM evidência nunca é presumido atendido", async () => {
  const { diagnoseObservation } = await imp("src/skills/diagnose-loop.js")
  const obs = { visualValidated: true, problems: [], checks: {} }
  const d = diagnoseObservation({ observation: obs, acceptance: ["carrinho soma"] })
  assert.equal(d.passed, false)
  assert.deepEqual(d.pendingCriteria, ["carrinho soma"])
})

test("diagnoseObservation: sem observação reprova (o ciclo não rodou)", async () => {
  const { diagnoseObservation } = await imp("src/skills/diagnose-loop.js")
  const d = diagnoseObservation({ observation: null, acceptance: ["x"] })
  assert.equal(d.passed, false)
  assert.match(d.problems[0], /sem observação/)
})

test("buildCorrectionRequest: bounded — dentro do budget propõe; esgotado → stop", async () => {
  const { buildCorrectionRequest } = await imp("src/skills/diagnose-loop.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const diagnosis = { problems: ["1 erro(s) no console"], pendingCriteria: ["login ok"] }
  const fresh = buildLoopState({ runId: "r", intent: "x", budget: { maxIterations: 3, maxWallTimeSeconds: 100 } })
  const req = buildCorrectionRequest({ diagnosis, state: fresh })
  assert.equal(req.stop, false)
  assert.equal(req.targets.length, 2)
  assert.match(req.targets[1], /login ok/)
  const spent = { ...fresh, consumed: { iterations: 3, tokens: 0, wallMs: 0 } }
  assert.equal(buildCorrectionRequest({ diagnosis, state: spent }).stop, true)
})

test("decideNext: passed→checkpoint; reprovou dentro do budget→autocorrect; esgotado→stop/needs_user", async () => {
  const { decideNext } = await imp("src/skills/diagnose-loop.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const s = buildLoopState({ runId: "r", intent: "x", budget: { maxIterations: 2, maxWallTimeSeconds: 100 } })
  assert.equal(decideNext(s, { passed: true }).action, "checkpoint")
  assert.equal(decideNext(s, { passed: false }).action, "autocorrect")
  const spent = { ...s, consumed: { iterations: 2, tokens: 0, wallMs: 0 } }
  const d = decideNext(spent, { passed: false })
  assert.equal(d.action, "stop")
  assert.equal(d.verdict, "needs_user")
})

test("runDiagnosePhase: reprovar roteia o ciclo para autocorrect (fase de decisão)", async () => {
  const { runDiagnosePhase } = await imp("src/skills/diagnose-loop.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  let s = buildLoopState({ runId: "r", intent: "x", acceptance: ["login ok"] })
  s = { ...s, phase: "diagnose" }
  const r = runDiagnosePhase(s, { observation: { visualValidated: true, problems: [], checks: {} } })
  assert.equal(r.diagnosis.passed, false)
  assert.equal(r.state.phase, "autocorrect", "diagnose reprovado → autocorrect")
  assert.equal(r.state.history.at(-1).decider, "verifier")
})

test("runAutocorrectPhase: registra a correção proposta pelo LLM (nunca fabrica patch) e avança", async () => {
  const { runAutocorrectPhase } = await imp("src/skills/diagnose-loop.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  let s = buildLoopState({ runId: "r", intent: "x" })
  s = { ...s, phase: "autocorrect" }
  const r = runAutocorrectPhase(s, { correction: { targets: ["a", "b"] }, applied: { ok: true, detail: "patch aplicado", tokens: 12 } })
  assert.equal(r.state.phase, "checkpoint", "autocorrect avança no ciclo")
  const entry = r.state.history.at(-1)
  assert.equal(entry.decider, "llm")
  assert.equal(r.state.consumed.tokens, 12)
})

test("CLI loop diagnose: sem observação persistida reprova (exit 1); JSON traz correção bounded", async () => {
  const { loopCommand } = await imp("src/commands/loop.js")
  const { buildLoopState, persistLoopState } = await imp("src/skills/replit-loop.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-diagcli-"))
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  try {
    const s = { ...buildLoopState({ runId: "d1", intent: "implementar x", acceptance: ["login ok"] }), phase: "diagnose",
      lastObservation: { status: "observed", visualValidated: true, problems: [], checks: {} } }
    persistLoopState({ root: cwd, state: s })
    process.exitCode = 0
    process.stdout.write = (x) => { out += x; return true }
    await loopCommand(["diagnose", "--run", "d1", "--json"], { cwd })
  } finally { process.stdout.write = orig }
  assert.equal(process.exitCode, 1, "critério sem evidência reprova")
  const payload = JSON.parse(out.trim().split("\n").pop())
  assert.equal(payload.diagnosis.passed, false)
  assert.equal(payload.correction.stop, false)
  assert.match(payload.correction.targets.join(" "), /login ok/)
  process.exitCode = 0
  await rm(cwd, { recursive: true, force: true })
})
