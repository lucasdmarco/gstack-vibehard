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
 * PRD51 S51.2.3 — `preview` entra em GATE_STAGES só quando o projeto "roda"
 * (`hasRunScript`, mesmo sinal de `verify-runner.js`) E a flag `--golden-run`/
 * `GSTACK_GOLDEN_RUN=1` está ligada (idioma de `--agentshield`). Sem a flag, ou em
 * projeto CLI/lib (sem scripts.dev/start), comportamento 100% inalterado — zero
 * regressão no default.
 */

async function unhealthyUiProject(cwd) {
  const proj = path.join(cwd, "app")
  await mkdir(path.join(proj, ".gstack", "runtime"), { recursive: true })
  await writeFile(path.join(proj, "package.json"), JSON.stringify({ name: "app", scripts: { dev: "node s.js" } }))
  await writeFile(path.join(proj, ".gstack", "runtime.json"), JSON.stringify({ schemaVersion: 2, services: [{ name: "web", command: ["node", "s.js"], cwd: ".", dependsOn: [], port: null, health: { readiness: { type: "process" }, liveness: { type: "process" } }, restart: { policy: "never" }, secretRefs: [] }] }))
  await writeFile(path.join(proj, ".gstack", "runtime", "web.state.json"), JSON.stringify({ name: "web", pid: 1, port: 3000, status: "unhealthy", url: "http://127.0.0.1:3000/" }))
  return proj
}

test("pipeline: preview unhealthy SEM --golden-run -> comportamento legado intacto, pipeline continua 'done'", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pg-1-"))
  try {
    await unhealthyUiProject(cwd)
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd,
      exec: () => {}, devRunner: () => ({ services: [{ name: "web", status: "unhealthy" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.stages.preview.status, "unhealthy")
    assert.equal(r.status, "done", "sem a flag, preview não é gate — zero regressão")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: preview unhealthy COM --golden-run em projeto UI (hasRunScript) -> handoff (preview vira gate real)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pg-2-"))
  try {
    await unhealthyUiProject(cwd)
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, goldenRun: true,
      exec: () => {}, devRunner: () => ({ services: [{ name: "web", status: "unhealthy" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.stages.preview.status, "unhealthy")
    assert.equal(r.status, "handoff", "com a flag, projeto UI com preview unhealthy vira gate real")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: preview unhealthy COM --golden-run em projeto SEM scripts.dev/start (CLI/lib) -> continua 'done' (não regride não-UI)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pg-3-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(path.join(proj, ".gstack", "runtime"), { recursive: true })
    await writeFile(path.join(proj, "package.json"), JSON.stringify({ name: "app", scripts: { test: "node --test" } }))
    await writeFile(path.join(proj, ".gstack", "runtime.json"), JSON.stringify({ schemaVersion: 2, services: [{ name: "web", command: ["node", "s.js"], cwd: ".", dependsOn: [], port: null, health: { readiness: { type: "process" }, liveness: { type: "process" } }, restart: { policy: "never" }, secretRefs: [] }] }))
    await writeFile(path.join(proj, ".gstack", "runtime", "web.state.json"), JSON.stringify({ name: "web", pid: 1, port: 3000, status: "unhealthy", url: "http://127.0.0.1:3000/" }))
    const { runPipeline, gateStagesFor } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "cli tool", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, goldenRun: true,
      exec: () => {}, devRunner: () => ({ services: [{ name: "web", status: "unhealthy" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    // PRD51 S51.2.7: com o cutover, o `status` agregado passou a depender TAMBÉM de
    // acceptance/observação (gates do motor, não só do gate legado de preview) — a
    // asserção precisa (preview não gateia sem hasRunScript) é sobre gateStagesFor
    // diretamente, não sobre o status agregado.
    assert.ok(!gateStagesFor({ goldenRun: true, projectDir: proj }).has("preview"), "sem scripts.dev/start, preview não entra no gate mesmo com a flag ligada")
    assert.equal(r.stages.preview.status, "unhealthy", "estado real do preview continua honesto")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: preview 'ready' COM --golden-run -> continua 'done' (só unhealthy gateia, não ready)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pg-4-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(path.join(proj, ".gstack", "runtime"), { recursive: true })
    await writeFile(path.join(proj, "package.json"), JSON.stringify({ name: "app", scripts: { dev: "node s.js" } }))
    await writeFile(path.join(proj, ".gstack", "runtime.json"), JSON.stringify({ schemaVersion: 2, services: [{ name: "web", command: ["node", "server.js"], cwd: ".", dependsOn: [], port: { preferred: 3000, env: "WEB_PORT", autoAllocate: true }, health: { readiness: { type: "process" }, liveness: { type: "process" } }, restart: { policy: "never" }, secretRefs: [] }] }))
    await writeFile(path.join(proj, ".gstack", "runtime", "web.state.json"), JSON.stringify({ name: "web", pid: 1, port: 3000, status: "ready", url: "http://127.0.0.1:3000/" }))
    // PRD51 S51.2.7: "done" com a flag exige os 4 portões do motor verdes,
    // incluindo observationFresh (stage "test" ready/not_applicable) — árvore git
    // limpa faz o gate seletivo por arquivos alterados resolver "clean"->"ready".
    execFileSync("git", ["init"], { cwd: proj, stdio: "pipe" })
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: proj, stdio: "pipe" })
    execFileSync("git", ["config", "user.name", "t"], { cwd: proj, stdio: "pipe" })
    execFileSync("git", ["add", "-A"], { cwd: proj, stdio: "pipe" })
    execFileSync("git", ["commit", "-m", "init"], { cwd: proj, stdio: "pipe" })
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, goldenRun: true,
      exec: () => {}, devRunner: () => ({ services: [{ name: "web", status: "ready" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
      // PRD51 S51.2.7: com o cutover, "done" só é alcançável com TODOS os 4 portões
      // do motor verdes — aceite resolvido (verifier real) é um deles.
      acceptance: [{ id: "feature-behavior", verifier: { kind: "command", ref: "npm test" } }],
    })
    assert.equal(r.stages.test.status, "ready", "árvore git limpa -> changed-files 'clean' -> stage 'ready'")
    assert.equal(r.stages.preview.status, "ready")
    assert.equal(r.status, "done")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("startCommand: --golden-run (flag CLI, não opts direto) chega até o pipeline de ponta a ponta e gateia preview unhealthy", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pg-5-"))
  try {
    await unhealthyUiProject(cwd) // planta package.json+runtime real ANTES do create fake
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand(["--golden-run"], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      devRunner: () => ({ services: [{ name: "web", status: "unhealthy" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
      proofRunner: async () => ({ ready: false }), // S51.2.5: --golden-run roda proof por padrão — isola do proof real
    })
    assert.equal(r.pipeline.status, "handoff", "--golden-run parseado por parseStartArgs, propagado por confirmAndRunPipeline até runPipeline")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("startCommand: SEM --golden-run, o mesmo cenário unhealthy continua 'done' (default do CLI intacto)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pg-6-"))
  try {
    await unhealthyUiProject(cwd)
    const { startCommand } = await imp("src/commands/start.js")
    const r = await startCommand([], {
      cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
      confirm: async () => true, exec: () => {},
      devRunner: () => ({ services: [{ name: "web", status: "unhealthy" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.pipeline.status, "done")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
