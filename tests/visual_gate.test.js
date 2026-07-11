import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.9 — visual-validation-gate EXECUTADO: navegador/screenshot/console/rede/
// a11y como EVIDÊNCIA. Sem driver, needs_browser (BLOQUEIA) — nunca finge verde.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// Driver fake: devolve a observação que o teste quiser.
const fakeDriver = (obs) => ({ observe: async (url, { screenshotPath }) => ({ screenshotPath, console: [], network: [], a11y: { violations: [] }, ...obs }) })

test("evaluateVisualGate: sem driver de navegador → needs_browser (BLOQUEIA, nunca finge verde)", async () => {
  const { evaluateVisualGate } = await imp("src/skills/visual-gate.js")
  const r = evaluateVisualGate({ uiChanged: true, observation: { status: "unavailable" } })
  assert.equal(r.status, "needs_browser")
  assert.equal(r.blocked, true)
})

test("evaluateVisualGate: !uiChanged → not_applicable (não bloqueia)", async () => {
  const { evaluateVisualGate } = await imp("src/skills/visual-gate.js")
  const r = evaluateVisualGate({ uiChanged: false })
  assert.equal(r.status, "not_applicable")
  assert.equal(r.blocked, false)
})

test("evaluateVisualGate: observação LIMPA (screenshot + console/rede/a11y ok) → validated", async () => {
  const { evaluateVisualGate } = await imp("src/skills/visual-gate.js")
  const obs = { status: "captured", screenshotPath: "/x/shot.png", console: [{ type: "log", text: "ok" }], network: [{ url: "/api", status: 200 }], a11y: { violations: [] } }
  const r = evaluateVisualGate({ uiChanged: true, observation: obs })
  assert.equal(r.status, "validated")
  assert.equal(r.blocked, false)
})

test("evaluateVisualGate: erro de console / 5xx / a11y / sem screenshot → failed (BLOQUEIA)", async () => {
  const { evaluateVisualGate } = await imp("src/skills/visual-gate.js")
  const consoleErr = { status: "captured", screenshotPath: "/s.png", console: [{ type: "error", text: "boom" }], network: [], a11y: { violations: [] } }
  assert.equal(evaluateVisualGate({ uiChanged: true, observation: consoleErr }).blocked, true)
  const net5xx = { status: "captured", screenshotPath: "/s.png", console: [], network: [{ url: "/api", status: 500 }], a11y: { violations: [] } }
  assert.ok(evaluateVisualGate({ uiChanged: true, observation: net5xx }).problems.some((p) => /request/.test(p)))
  const a11yBad = { status: "captured", screenshotPath: "/s.png", console: [], network: [], a11y: { violations: [{ id: "color-contrast", impact: "serious" }] } }
  assert.ok(evaluateVisualGate({ uiChanged: true, observation: a11yBad }).problems.some((p) => /acessibilidade/.test(p)))
  const noShot = { status: "captured", screenshotPath: null, console: [], network: [], a11y: { violations: [] } }
  assert.ok(evaluateVisualGate({ uiChanged: true, observation: noShot }).problems.some((p) => /screenshot/.test(p)))
})

test("browserDriverAvailable: honesto — false quando playwright NÃO resolve", async () => {
  const { browserDriverAvailable } = await imp("src/skills/visual-gate.js")
  assert.equal(browserDriverAvailable(() => { throw new Error("not found") }), false)
  assert.equal(browserDriverAvailable(() => "/fake/playwright"), true)
})

test("runVisualGate: driver fake limpo → validated + evidência gravada no ledger", async () => {
  const { runVisualGate } = await imp("src/skills/visual-gate.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-visual-"))
  try {
    const r = await runVisualGate({ root, runId: "vr1", url: "http://localhost:3000", uiChanged: true, driver: fakeDriver({}) })
    assert.equal(r.status, "validated")
    const ledger = path.join(root, ".gstack", "runs", "vr1", "skill-evidence.json")
    assert.ok(existsSync(ledger))
    const parsed = JSON.parse(readFileSync(ledger, "utf-8"))
    assert.ok(parsed.entries.some((e) => e.gate === "visual-validation-gate" && e.status === "validated"))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("runVisualGate: SEM driver → needs_browser (blocked) e grava a evidência do bloqueio", async () => {
  const { runVisualGate } = await imp("src/skills/visual-gate.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-visual-nb-"))
  try {
    const r = await runVisualGate({ root, runId: "vr2", url: "http://localhost:3000", uiChanged: true, driver: null })
    assert.equal(r.status, "needs_browser")
    assert.equal(r.blocked, true)
    const parsed = JSON.parse(readFileSync(path.join(root, ".gstack", "runs", "vr2", "skill-evidence.json"), "utf-8"))
    assert.ok(parsed.entries.some((e) => e.status === "needs_browser"))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("CLI visual check --json: sem url → erro; com url e sem driver → blocked honesto", async () => {
  const { visualCommand } = await imp("src/commands/visual.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-visual-cli-"))
  const prevExit = process.exitCode
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await visualCommand(["check", "--url", "http://localhost:5173", "--json"], { cwd }) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.visual-gate.v1")
  assert.equal(parsed.blocked, true, "sem driver não valida")
  assert.equal(typeof parsed.driverAvailable, "boolean")
  process.exitCode = prevExit
  await rm(cwd, { recursive: true, force: true })
})
