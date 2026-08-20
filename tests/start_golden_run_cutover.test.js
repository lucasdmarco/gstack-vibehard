import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.2.7 — cutover final atrás de `--golden-run`. Com a flag, `status`
 * público (`done|handoff`) deriva do veredito ESTRITO do motor (`goldenRun.status`:
 * `completed|handoff|blocked|planned_only|not_executed|cancelled`), não mais só do
 * critério solto (`GATE_STAGES`+`failedGate`). Sem a flag: comportamento 100%
 * inalterado. Desbloqueado por journeys reais (`--journeys`) — sem elas,
 * `acceptanceResolved` nunca fica `true` e `"completed"` é inalcançável (achado
 * discutido e confirmado com o usuário antes de implementar).
 */

async function realGreenProject(cwd) {
  const proj = path.join(cwd, "app")
  await mkdir(proj, { recursive: true })
  execFileSync("git", ["init"], { cwd: proj, stdio: "pipe" })
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: proj, stdio: "pipe" })
  execFileSync("git", ["config", "user.name", "t"], { cwd: proj, stdio: "pipe" })
  await writeFile(path.join(proj, "index.js"), "function f() { return 1 }\n")
  execFileSync("git", ["add", "-A"], { cwd: proj, stdio: "pipe" })
  execFileSync("git", ["commit", "-m", "init"], { cwd: proj, stdio: "pipe" })
  return proj
}

test("SEM --golden-run: status deriva do critério legado mesmo que o motor não fecharia os 4 portões (zero regressão)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cutover-1-"))
  try {
    await realGreenProject(cwd)
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd,
      exec: () => {}, verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.status, "done", "legado: verify ready + create ok -> done, mesmo sem acceptance resolvido")
    assert.notEqual(r.goldenRun.status, "completed", "controle: o motor por si NÃO consideraria isso completed (sem acceptance)")
  } finally { cleanupTmp(cwd) }
})

test("COM --golden-run, SEM journeys: status vira 'handoff' mesmo com tudo tecnicamente verde (honesto — acceptanceResolved:false)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cutover-2-"))
  try {
    await realGreenProject(cwd)
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, goldenRun: true,
      exec: () => {}, verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.status, "handoff", "sem journeys, acceptanceResolved:false -> nunca completed -> handoff")
    assert.equal(r.goldenRun.gates.acceptanceResolved, false)
  } finally { cleanupTmp(cwd) }
})

test("COM --golden-run E acceptance real resolvida (todos os 4 portões verdes): status vira 'done' via goldenRun.status==='completed'", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cutover-3-"))
  try {
    await realGreenProject(cwd)
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, goldenRun: true,
      exec: () => {}, verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
      // PRD52 S52.J — `gateExec` executa os gates E o verificador `command` do
      // aceite. Injeta-lo e o teste DECLARANDO que `npm test` rodou e passou;
      // sem ele o pipeline rodaria `npm test` de verdade no projeto temporario.
      // O aceite so resolve com execucao, e e essa execucao que o teste fixa.
      gateExec: () => {},
      acceptance: [{ id: "feature-behavior", verifier: { kind: "command", ref: "npm test" } }],
    })
    assert.equal(r.goldenRun.status, "completed", "compliance EXECUTADO + 4 portoes verdes -> completed continua alcancavel")
    assert.equal(r.status, "done")
    assert.equal(r.goldenRun.gates.compliance.items[0].status, "compliant")
  } finally { cleanupTmp(cwd) }
})

test("COM --golden-run, gate falho (verify blocked): status 'handoff' (goldenRun.status !== completed) — mesmo veredito do legado aqui, mas por motor", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cutover-4-"))
  try {
    await realGreenProject(cwd)
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, goldenRun: true,
      exec: () => {}, verifyRunner: () => ({ status: "blocked", usable: false, failed: ["qg-l1"] }),
      acceptance: [{ id: "feature-behavior", verifier: { kind: "command", ref: "npm test" } }],
    })
    assert.equal(r.status, "handoff")
    assert.ok(r.diagnosis, "S51.2.4 continua funcionando: diagnóstico real anexado")
  } finally { cleanupTmp(cwd) }
})
