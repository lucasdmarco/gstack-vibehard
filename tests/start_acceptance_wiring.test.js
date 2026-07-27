import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.2.1 — o acceptance REAL do brief (product-brief.js) chega no pipeline
 * (`runPipeline`'s `opts.acceptance`) em vez de sempre `[]` por omissão. Puramente
 * aditivo: `goldenRun` continua não-autoritativo — só passa a refletir dado real.
 */

async function runStart(cwd, extraOpts = {}) {
  const { startCommand } = await imp("src/commands/start.js")
  return startCommand([], {
    cwd, objective: "quero um web app fullstack", projectName: "loja", mode: "lite",
    designSystem: "none", confirm: async () => true, exec: () => {},
    ...extraOpts,
  })
}

test("start pipeline: SEM journey mapeada, aceite de feature continua pending -> acceptanceResolved false (honesto, não por omissão de wiring)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-acc-1-"))
  try {
    const r = await runStart(cwd)
    assert.equal(r.pipeline.goldenRun.gates.acceptanceResolved, false)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start pipeline: journey mapeada resolve pending_verifier -> acceptanceResolved fica REAL (dado real, não vazio por omissão)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-acc-2-"))
  try {
    const journeys = [{ acceptanceId: "feature-behavior", method: "command", ref: "npm test", files: [] }]
    const r = await runStart(cwd, { journeys })
    assert.equal(r.pipeline.goldenRun.gates.acceptanceResolved, true, "journey mapeada resolveu o único aceite pendente (feature-behavior) — infra já tem verifier real")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start pipeline: brief.acceptances chega intacto (com pending_verifier honesto) quando não há journeys — nunca inventa verifier", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-acc-3-"))
  try {
    const r = await runStart(cwd)
    const acc = r.pipeline.goldenRun.gates
    assert.equal(acc.acceptanceResolved, false)
    // controle negativo: sem --journeys, brief.json no disco continua com pending_verifier
    const brief = JSON.parse(readFileSync(path.join(cwd, ".gstack", "plans", r.plan.id, "brief.json"), "utf-8"))
    const feature = brief.acceptances.find((a) => a.id === "feature-behavior")
    assert.ok(feature.pending_verifier, "brief persistido continua honesto — resolução vale só pro pipeline, nunca reescreve o brief")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
