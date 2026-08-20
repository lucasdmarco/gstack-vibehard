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
    // S52.J: `gateExec` executa os gates E os verificadores `command` dos
    // aceites. Sem ele, o aceite fica `unverified` -- que e o contrato novo.
    gateExec: () => {},
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

/**
 * PRD52 S52.J — a intenção deste teste não mudou: provar que a journey mapeada
 * resolve o `pending_verifier` com dado real. O que mudou é ONDE isso se lê.
 *
 * `acceptanceResolved` é o veredito de TODOS os aceites, e neste fixture o
 * projeto não chega a existir — `test` e `verify` saem `not_applicable`, ou
 * seja, os gates de baseline (`lint`, `qg --strict`, `verify --profile
 * scaffold`) nunca rodaram. Antes isso não aparecia: bastava o verifier existir
 * e o portão abria, o que dava um `completed` oco.
 *
 * Agora o aceite da journey é `compliant` DE VERDADE — e é ele que este teste
 * afirma — enquanto o veredito global continua `false` porque três gates não
 * foram executados. O teste ficou mais informativo, não mais fraco.
 */
test("start pipeline: journey mapeada resolve o aceite com COMPLIANCE real (o veredito global ainda espera os gates)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-acc-2-"))
  try {
    const journeys = [{ acceptanceId: "feature-behavior", method: "command", ref: "npm test", files: [] }]
    const r = await runStart(cwd, { journeys })
    const c = r.pipeline.goldenRun.gates.compliance
    assert.equal(c.items.find((i) => i.id === "feature-behavior").status, "compliant",
      "a journey resolveu o pending_verifier E o verificador executou")
    assert.equal(c.allCompliant, false,
      "os gates de baseline não rodaram neste fixture (test/verify not_applicable) — e isso agora aparece")
    for (const g of ["scaffold", "quality-gate", "lint"]) {
      assert.equal(c.items.find((i) => i.id === g).status, "unverified", `'${g}' sem execução não é aprovação`)
    }
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
