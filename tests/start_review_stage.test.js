import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.2.2 — `review` deixa de ser uma string hardcoded (`initialStages`) e
 * passa a rodar `diffHygiene` (project-plan/diff-hygiene.js, já existente e usado
 * por `gstack_vibehard qa`) de verdade sobre o diff real do projeto. Ainda NÃO
 * entra em `GATE_STAGES` (isso é o cutover final, S51.2.7) — falha de review
 * continua não bloqueando o pipeline nesta sprint.
 */

async function realGitProject(cwd) {
  const proj = path.join(cwd, "app")
  await mkdir(proj, { recursive: true })
  execFileSync("git", ["init"], { cwd: proj, stdio: "pipe" })
  return proj
}

test("pipeline: review stage real detecta debugger statement via diff-hygiene (FALHA, mas NÃO bloqueia — review ainda não é gate)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-review-1-"))
  try {
    const proj = await realGitProject(cwd)
    await writeFile(path.join(proj, "index.js"), "function f() {\n  debugger;\n}\n")
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const planDir = path.join(cwd, ".gstack", "plans", plan.id)
    const r = runPipeline({ plan, planDir, cwd, exec: () => {}, verifyRunner: () => ({ status: "ready", usable: true, failed: [] }) })
    assert.equal(r.stages.review.status, "failed")
    assert.match(r.stages.review.detail, /debugger/)
    assert.equal(r.status, "done", "review ainda não é gate — falha de review não bloqueia o pipeline nesta sprint")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: review stage real SEM achados -> ready (diff limpo, evidência real, não mais string fake)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-review-2-"))
  try {
    const proj = await realGitProject(cwd)
    await writeFile(path.join(proj, "index.js"), "function f() {\n  return 1\n}\n")
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const planDir = path.join(cwd, ".gstack", "plans", plan.id)
    const r = runPipeline({ plan, planDir, cwd, exec: () => {}, verifyRunner: () => ({ status: "ready", usable: true, failed: [] }) })
    assert.equal(r.stages.review.status, "ready")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: projeto não criado -> review continua advisory (comportamento preservado, sem regressão)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-review-3-"))
  try {
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const planDir = path.join(cwd, ".gstack", "plans", plan.id)
    const r = runPipeline({ plan, planDir, cwd, exec: () => {} })
    assert.equal(r.stages.review.status, "advisory")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
