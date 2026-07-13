import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD37 37.2 (D2) — camada de observação: roda o app, abre o navegador, captura
// evidência e devolve { visualValidated, problems } que o contrato (D1) decide.
// Honesto: app morto nunca é observado; sem driver nunca valida.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const pollOk = async () => ({ ok: true, status: 200 })
const pollDead = async () => ({ ok: false, status: null, timedOut: true })
// S41.6: o gate verifica a evidência no disco → o driver de teste ESCREVE o screenshot.
async function writeShot(p) { if (p) { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, "PNG") } }
const cleanDriver = { async observe(_url, { screenshotPath }) { await writeShot(screenshotPath); return { screenshotPath, console: [], network: [], a11y: { checked: true, violations: [] } } } }
const brokenDriver = { async observe(_url, { screenshotPath }) { await writeShot(screenshotPath); return { screenshotPath, console: [{ type: "error", text: "boom" }], network: [], a11y: { checked: true, violations: [] } } } }

test("summarizeObservation: só 'validated' conta como visualmente válido", async () => {
  const { summarizeObservation } = await imp("src/skills/observe-layer.js")
  assert.deepEqual(summarizeObservation({ status: "validated", problems: [] }), {
    visualValidated: true, problems: [], gateStatus: "validated", screenshotPath: null,
  })
  assert.equal(summarizeObservation({ status: "failed", problems: ["1 erro(s) no console"] }).visualValidated, false)
  assert.equal(summarizeObservation({ status: "needs_browser", problems: ["sem driver"] }).visualValidated, false)
})

test("observeRunningApp: app que NÃO responde → unreachable (nunca observa app morto)", async () => {
  const { observeRunningApp } = await imp("src/skills/observe-layer.js")
  const r = await observeRunningApp({ url: "http://127.0.0.1:59999", poll: pollDead, driver: null })
  assert.equal(r.status, "unreachable")
  assert.equal(r.reachable, false)
  assert.equal(r.visualValidated, false)
  assert.match(r.problems[0], /não respondeu/)
})

test("observeRunningApp: reachable + driver limpo → validated com evidência", async () => {
  const { observeRunningApp } = await imp("src/skills/observe-layer.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-obs-"))
  try {
    const r = await observeRunningApp({ root, runId: "o1", url: "http://x", poll: pollOk, driver: cleanDriver })
    assert.equal(r.status, "observed")
    assert.equal(r.visualValidated, true)
    assert.equal(r.problems.length, 0)
    assert.equal(r.gate.status, "validated")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("observeRunningApp: reachable mas SEM driver → needs_browser (nunca valida sem prova)", async () => {
  const { observeRunningApp } = await imp("src/skills/observe-layer.js")
  const r = await observeRunningApp({ url: "http://x", poll: pollOk, driver: null })
  assert.equal(r.visualValidated, false)
  assert.equal(r.gate.status, "needs_browser")
})

test("runObservePhase: observação limpa avança; observação com erro roteia para autocorrect", async () => {
  const { runObservePhase } = await imp("src/skills/observe-layer.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-obsphase-"))
  try {
    let s = buildLoopState({ runId: "p1", intent: "implementar x" })
    s = { ...s, phase: "observe" }
    const clean = await runObservePhase(s, { root, url: "http://x", poll: pollOk, driver: cleanDriver })
    assert.equal(clean.observation.visualValidated, true)
    assert.equal(clean.state.phase, "diagnose", "observe limpo avança no ciclo")
    const broken = await runObservePhase(s, { root, url: "http://x", poll: pollOk, driver: brokenDriver })
    assert.equal(broken.observation.visualValidated, false)
    assert.equal(broken.state.phase, "autocorrect", "observação decide: erro → autocorrect")
    assert.equal(broken.state.history.at(-1).decider, "observation")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("CLI loop observe: sem state → erro; com state + driver injetável avança e persiste", async () => {
  const { loopCommand } = await imp("src/commands/loop.js")
  const { buildLoopState, persistLoopState } = await imp("src/skills/replit-loop.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-obscli-"))
  try {
    process.exitCode = 0
    await loopCommand(["observe", "--run", "nope", "--url", "http://x", "--json"], { cwd })
    assert.equal(process.exitCode, 1, "sem loop.json falha")
    process.exitCode = 0
    persistLoopState({ root: cwd, state: { ...buildLoopState({ runId: "c1", intent: "implementar x" }), phase: "observe" } })
    assert.ok(existsSync(path.join(cwd, ".gstack", "runs", "c1", "loop.json")))
  } finally { process.exitCode = 0; await rm(cwd, { recursive: true, force: true }) }
})
