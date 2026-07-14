import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function captureStdout() {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  return { get: () => out, restore: () => { process.stdout.write = orig } }
}

test("start --dry-run --json: JSON PURO, nada escrito, comandos sanitizados", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-dryrun-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    const cap = captureStdout()
    let r
    try { r = await startCommand(["quero um web app fullstack", "--name", "loja", "--mode", "lite", "--dry-run", "--json"], { cwd }) }
    finally { cap.restore() }
    const parsed = JSON.parse(cap.get().trim()) // JSON puro: parseia inteiro
    assert.equal(parsed.ok, true)
    assert.equal(parsed.dryRun, true)
    assert.ok(Array.isArray(parsed.pipeline.stages) && parsed.pipeline.stages.includes("preview"))
    assert.ok(parsed.pipeline.commands.some((c) => c.command.includes("create loja")))
    assert.equal(existsSync(path.join(cwd, ".gstack")), false, "dry-run NÃO escreve nada")
    assert.equal(r.ok, true)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start --dry-run sem objetivo → erro honesto (não trava esperando TTY)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const cap = captureStdout()
  let r
  try { r = await startCommand(["--dry-run", "--json"], { cwd: "/x" }) }
  finally { cap.restore() }
  assert.equal(r.ok, false)
  assert.equal(JSON.parse(cap.get().trim()).ok, false)
})

test("pipeline: run done cria journal/status por run e estágios honestos (sem projeto real)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pipe-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    const ran = []
    const r = await startCommand([], {
      cwd, objective: "quero um web app fullstack", projectName: "loja", mode: "lite",
      designSystem: "none", // testa o pipeline, não o design-system gate (F2-B)
      confirm: async () => true, exec: (c) => ran.push(c.join(" ")),
    })
    // contrato antigo preservado
    assert.equal(r.result.status, "done")
    assert.equal(r.pipeline.status, "done")
    // artefatos do plano: json + md
    const planDir = path.join(cwd, ".gstack", "plans", r.plan.id)
    assert.ok(existsSync(path.join(planDir, "plan.json")))
    const md = await readFile(path.join(planDir, "plan.md"), "utf-8")
    assert.match(md, /## Passos/)
    assert.match(md, /Pipeline: intent → plan → scout/)
    // artefatos do run
    const runDir = path.join(cwd, ".gstack", "runs", r.pipeline.runId)
    assert.ok(existsSync(path.join(runDir, "journal.jsonl")))
    const status = JSON.parse(await readFile(path.join(runDir, "status.json"), "utf-8"))
    assert.equal(status.status, "done")
    // estágios honestos: projeto não foi criado de verdade (exec fake) → dev/verify not_applicable
    assert.equal(status.stages.dev.status, "not_applicable")
    assert.equal(status.stages.verify.status, "not_applicable")
    assert.equal(status.stages.scout.status, "not_applicable", "projeto novo — nada a explorar antes do create")
    assert.equal(status.stages.review.status, "advisory", "review nunca é gate")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: falha persistente respeita HARD CAP e gera handoff.md (sem loop infinito)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cap-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    let calls = 0
    const r = await startCommand([], {
      cwd, objective: "web app", projectName: "x", mode: "lite",
      designSystem: "none", // testa o hard cap do pipeline, não o design-system gate
      confirm: async () => true, maxAttempts: 3,
      exec: (c) => { if (c.includes("create")) { calls++; throw new Error("create quebrou de propósito") } },
    })
    assert.equal(r.pipeline.status, "handoff")
    assert.equal(r.pipeline.attempts, 3, "exatamente o hard cap — nem mais nem menos")
    assert.equal(calls, 3, "não vira loop zumbi")
    const handoff = await readFile(r.pipeline.handoffPath, "utf-8")
    assert.match(handoff, /Handoff — run/)
    assert.match(handoff, /create quebrou de propósito/)
    assert.match(handoff, /plan run/, "handoff é acionável (como retomar)")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: com projeto real (runtime manifest) dev/preview refletem estado dos serviços", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-rt-"))
  try {
    // simula o resultado do create: projeto com manifest de runtime
    const proj = path.join(cwd, "app")
    await mkdir(path.join(proj, ".gstack"), { recursive: true })
    await writeFile(path.join(proj, ".gstack", "runtime.json"), JSON.stringify({
      schemaVersion: 2,
      services: [{ name: "web", command: ["node", "server.js"], cwd: ".", dependsOn: [], port: { preferred: 3000, env: "WEB_PORT", autoAllocate: true }, health: { readiness: { type: "process" }, liveness: { type: "process" } }, restart: { policy: "never" }, secretRefs: [] }],
    }))
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const planDir = path.join(cwd, ".gstack", "plans", plan.id)
    // devRunner fake: serviços de pé; state real de preview vem do runtime dir
    await mkdir(path.join(proj, ".gstack", "runtime"), { recursive: true })
    await writeFile(path.join(proj, ".gstack", "runtime", "web.state.json"), JSON.stringify({ name: "web", pid: 1, port: 3000, status: "ready", url: "http://127.0.0.1:3000/" }))
    const r = runPipeline({
      plan, planDir, cwd,
      exec: () => {}, // create steps fake (projeto já existe)
      devRunner: () => ({ services: [{ name: "web", status: "ready" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.status, "done")
    assert.equal(r.stages.dev.status, "ready")
    assert.equal(r.stages.verify.status, "ready")
    assert.equal(r.stages.preview.status, "ready")
    assert.equal(r.stages.preview.url, "http://127.0.0.1:3000/")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

// S42.6 CONTROLE NEGATIVO: serviço com URL mas status="unhealthy" NÃO vira preview "ready".
test("pipeline: serviço unhealthy (tem URL, health não passou) NÃO libera preview ready", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-unhealthy-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(path.join(proj, ".gstack", "runtime"), { recursive: true })
    await writeFile(path.join(proj, ".gstack", "runtime.json"), JSON.stringify({ schemaVersion: 2, services: [{ name: "web", command: ["node", "s.js"], cwd: ".", dependsOn: [], port: null, health: { readiness: { type: "process" }, liveness: { type: "process" } }, restart: { policy: "never" }, secretRefs: [] }] }))
    // url presente MAS status unhealthy (o supervisor grava url mesmo quando readiness falha)
    await writeFile(path.join(proj, ".gstack", "runtime", "web.state.json"), JSON.stringify({ name: "web", pid: 1, port: 3000, status: "unhealthy", url: "http://127.0.0.1:3000/" }))
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd,
      exec: () => {}, devRunner: () => ({ services: [{ name: "web", status: "unhealthy" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.notEqual(r.stages.preview.status, "ready", "unhealthy nunca vira preview ready")
    assert.equal(r.stages.preview.status, "unhealthy")
    assert.equal(r.stages.preview.url, undefined, "URL retida enquanto health não passa")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: gate determinístico falhou → handoff imediato (LLM não aprova nada)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-gate-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(proj, { recursive: true })
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd,
      exec: () => {},
      gateExec: () => { throw new Error("not a git repo") }, // test stage → fallback (pending)
      verifyRunner: () => ({ status: "blocked", usable: false, failed: ["lint"] }),
    })
    assert.equal(r.status, "handoff")
    assert.equal(r.stages.verify.status, "failed")
    assert.ok(existsSync(r.handoffPath))
    const status = JSON.parse(readFileSync(path.join(cwd, ".gstack", "runs", r.runId, "status.json"), "utf-8"))
    assert.equal(status.status, "handoff")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
