import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.2.7 (journeys reais) — `--journeys <arquivo.json>` declara journeys de
 * verdade (mesmo shape de `mapJourney`), resolvendo `pending_verifier` -> `verifier`
 * sem "por decreto": cada entrada é validada (`mapJourney` lança em shape inválido).
 */

test("start --journeys <arquivo>: journey real resolve acceptanceResolved (sem journey, ficaria false)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-journeys-1-"))
  try {
    const journeysPath = path.join(cwd, "journeys.json")
    await writeFile(journeysPath, JSON.stringify([
      { acceptanceId: "feature-behavior", method: "command", ref: "npm test", files: [] },
    ]))
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand(["--journeys", journeysPath], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
    })
    assert.equal(r.pipeline.goldenRun.gates.acceptanceResolved, true, "journey real do arquivo resolveu o aceite pendente")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start --journeys <arquivo>: entrada malformada (sem 'ref') LANÇA — nunca ignora silenciosamente", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-journeys-2-"))
  try {
    const journeysPath = path.join(cwd, "journeys.json")
    await writeFile(journeysPath, JSON.stringify([{ acceptanceId: "feature-behavior", method: "command" }]))
    const { startCommand } = await imp("src/commands/start.js")
    await assert.rejects(
      startCommand(["--journeys", journeysPath], {
        cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
        confirm: async () => true, exec: () => {},
      }),
      /acceptanceId e ref são obrigatórios/,
    )
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start SEM --journeys: acceptanceResolved continua false (comportamento S51.2.1 preservado)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-journeys-3-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand([], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
    })
    assert.equal(r.pipeline.goldenRun.gates.acceptanceResolved, false)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
