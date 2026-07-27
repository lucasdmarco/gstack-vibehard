import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.2.4 — GAP-6 ("gate falho -> handoff DIRETO, diagnose-loop.js nunca é
 * consultado"). Achado real: `diagnose-loop.js`/`runtime-repair-cycle.js` foram
 * desenhados para um ciclo AGÊNTICO (LLM propõe correção, reobservação valida) —
 * `runPipeline` é síncrono, sem pausa/retomada pra devolver controle ao LLM.
 * Decisão do usuário: NÃO fabricar autocorreção real — só consultar
 * `diagnoseObservation` (puro, genérico) e anexar diagnóstico REAL ao handoff,
 * honesto sobre não ter havido observação de runtime de verdade.
 */

test("pipeline: gate falho (verify) -> handoff com diagnosis REAL anexado (diagnose-loop.js consultado, GAP-6)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-diag-1-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(proj, { recursive: true })
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd,
      exec: () => {}, verifyRunner: () => ({ status: "blocked", usable: false, failed: ["qg-l1"] }),
    })
    assert.equal(r.status, "handoff")
    assert.ok(r.diagnosis, "diagnosis real anexado ao resultado")
    assert.equal(r.diagnosis.schemaVersion, "gstack.diagnose-loop.v1")
    assert.equal(r.diagnosis.passed, false)
    assert.match(r.diagnosis.problems.join(" "), /qg-l1/, "problema real do gate (não fabricado)")
    const handoff = await readFile(r.handoffPath, "utf-8")
    assert.match(handoff, /## Diagnóstico/)
    assert.match(handoff, /qg-l1/)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: falha no create (plan-execution) NÃO ganha diagnosis de runtime — fora do domínio do diagnose-loop.js", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-diag-2-"))
  try {
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "x", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, maxAttempts: 1,
      exec: () => { throw new Error("create quebrou de propósito") },
    })
    assert.equal(r.status, "handoff")
    assert.equal(r.diagnosis, undefined, "create falho é escopo do executor, não do diagnose-loop.js")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: 'done' nunca carrega diagnosis (só faz sentido em handoff de gate)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-diag-3-"))
  try {
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({ plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, exec: () => {} })
    assert.equal(r.status, "done")
    assert.equal(r.diagnosis, undefined)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
