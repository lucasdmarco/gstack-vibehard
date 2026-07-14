import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD42 S42.0C — o `start` (runPipeline) é DIRIGIDO pelo LoopEngine canônico: o motor é a
// fonte única de ORDEM de fase e de CAPS. Não há 2ª máquina de estados. Controles negativos:
// fase fora de ordem lança invalid_transition; hard cap de tentativas → motor faz hard halt.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("start é dirigido pelo motor: pipeline OK avança até a fase canônica 'proof'", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-eng-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(path.join(proj, ".gstack", "runtime"), { recursive: true })
    await writeFile(path.join(proj, ".gstack", "runtime.json"), JSON.stringify({
      schemaVersion: 2,
      services: [{ name: "web", command: ["node", "server.js"], cwd: ".", dependsOn: [], port: { preferred: 3000, env: "WEB_PORT", autoAllocate: true }, health: { readiness: { type: "process" }, liveness: { type: "process" } }, restart: { policy: "never" }, secretRefs: [] }],
    }))
    await writeFile(path.join(proj, ".gstack", "runtime", "web.state.json"), JSON.stringify({ name: "web", pid: 1, port: 3000, status: "ready", url: "http://127.0.0.1:3000/" }))
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd,
      exec: () => {},
      devRunner: () => ({ services: [{ name: "web", status: "ready" }] }),
      verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.status, "done")
    assert.ok(r.engine, "resultado carrega o snapshot do motor")
    assert.equal(r.engine.phase, "proof", "o motor percorreu o pipeline canônico até proof")
    assert.ok(r.engine.counters.attempts >= 1, "o motor contou a(s) tentativa(s) do create")
    assert.equal(r.engine.capped, false, "run limpo não estoura cap")
    assert.ok(r.engine.transitions >= 8, "houve transições reais de fase governadas pelo motor")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("CONTROLE NEGATIVO (ordem) — avançar fora de ordem lança invalid_transition", async () => {
  const { LoopEngine } = await imp("src/skills/loop-engine.js")
  const { advanceEngine } = await imp("src/project-plan/run-loop.js")
  // 'verify' exige checkpoint→verify; a partir de 'intent' isso é proibido → o motor rejeita
  // (prova que a ordem é do motor, não reimplementada no pipeline).
  assert.throws(() => advanceEngine(new LoopEngine(), "verify"), /invalid_transition/)
})

test("CONTROLE NEGATIVO (cap) — create falha em série → motor faz hard halt (blocked) + handoff", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-engcap-"))
  try {
    await mkdir(path.join(cwd, "x"), { recursive: true })
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "x", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd, maxAttempts: 3,
      exec: (c) => { if (String(c).includes("create")) throw new Error("boom persistente") },
    })
    assert.equal(r.status, "handoff")
    assert.equal(r.attempts, 3, "hard cap exato")
    assert.equal(r.engine.capped, true, "o motor estourou o cap (fonte única de caps)")
    assert.equal(r.engine.status, "blocked", "hard halt tipado")
    assert.equal(r.engine.phase, "implement", "parou na fase do create (implement)")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
