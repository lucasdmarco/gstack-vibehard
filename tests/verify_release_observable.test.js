import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const runnerMod = path.join(repoRoot, "src", "project-plan", "verify-runner.js")
const cmdMod = path.join(repoRoot, "src", "commands", "verify.js")
const execMod = path.join(repoRoot, "src", "util", "exec-step.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

async function projectWith(scripts) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-vro-"))
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "x", scripts }))
  return cwd
}

test("runStepProcess: timeout → mata a ÁRVORE (reusa killTreeCommand), sem processo real", async () => {
  const { runStepProcess } = await imp(execMod)
  const killed = []
  // spawn injetado simula o kill-por-timeout (signal === killSignal)
  const fakeSpawn = () => ({ status: null, signal: "SIGKILL", pid: 4242, stdout: "", stderr: "boom" })
  const r = runStepProcess("npm", ["test"], {
    cwd: ".", timeoutMs: 10, platform: "win32",
    spawn: fakeSpawn,
    killer: (file, args) => { killed.push({ file, args }) },
  })
  assert.equal(r.timedOut, true)
  assert.equal(r.pid, 4242)
  assert.equal(killed.length, 1, "tree-kill chamado no timeout")
  assert.equal(killed[0].file, "taskkill")
  assert.ok(killed[0].args.includes("/T") && killed[0].args.includes("4242"))
})

test("runStepProcess: sucesso normal não mata nada", async () => {
  const { runStepProcess } = await imp(execMod)
  const killed = []
  const r = runStepProcess("echo", ["ok"], {
    spawn: () => ({ status: 0, signal: null, pid: 1, stdout: "ok", stderr: "" }),
    killer: () => killed.push(1),
  })
  assert.equal(r.timedOut, false)
  assert.equal(r.code, 0)
  assert.equal(killed.length, 0)
})

test("verify --dry-run: lista os comandos do release e NÃO executa nada", async () => {
  const cwd = await projectWith({ lint: "x", typecheck: "x", test: "x", build: "x" })
  try {
    const { runVerify } = await imp(runnerMod)
    let called = 0
    const plan = runVerify({ cwd, profile: "release", home: cwd, dryRun: true, stepExec: () => { called++; return { code: 0 } } })
    assert.equal(plan.dryRun, true)
    assert.equal(called, 0, "dry-run NUNCA executa")
    const ids = plan.plan.map((s) => s.id)
    assert.deepEqual(ids.slice(0, 5), ["deps", "lint", "typecheck", "test", "build"])
    assert.ok(plan.plan.find((s) => s.id === "test").required)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: etapa que estoura o tempo → status de step timed_out E status de run timed_out (≠ blocked)", async () => {
  const cwd = await projectWith({ lint: "x", test: "x" })
  try {
    const { runVerify } = await imp(runnerMod)
    // stepExec injetado: 'test' estoura o tempo; o resto passa.
    const stepExec = (file, args) => {
      const isTest = args.some((a) => a === "test" || String(a).includes("test"))
      return isTest ? { code: null, timedOut: true, stdout: "", stderr: "" } : { code: 0, timedOut: false, stdout: "", stderr: "" }
    }
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, stepExec })
    const byId = Object.fromEntries(r.steps.map((s) => [s.id, s.status]))
    assert.equal(byId.test, "timed_out")
    assert.equal(r.status, "timed_out", "run distingue timeout de blocked")
    assert.ok(r.timedOut.includes("test"))
    assert.equal(r.ready, false)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: required que FALHA (não timeout) segue blocked", async () => {
  const cwd = await projectWith({ test: "x" })
  try {
    const { runVerify } = await imp(runnerMod)
    const stepExec = () => ({ code: 1, timedOut: false, stdout: "", stderr: "erro" })
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, stepExec })
    assert.equal(r.status, "blocked")
    assert.ok(r.failed.includes("test"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: onStep é chamado INCREMENTALMENTE, um por etapa, na ordem", async () => {
  const cwd = await projectWith({ lint: "x", test: "x" })
  try {
    const { runVerify } = await imp(runnerMod)
    const emitted = []
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, exec: () => {}, onStep: (s) => emitted.push(s.id) })
    assert.equal(emitted.length, r.steps.length, "cada etapa emitida ao sink")
    assert.deepEqual(emitted, r.steps.map((s) => s.id), "ordem preservada")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify --dry-run --json (comando): JSON puro, escreve nada de execução", async () => {
  const cwd = await projectWith({ lint: "x", test: "x" })
  try {
    const { verifyCommand } = await imp(cmdMod)
    const chunks = []
    const orig = process.stdout.write
    process.stdout.write = (s) => { chunks.push(s); return true }
    try { await verifyCommand(["--profile", "release", "--dry-run", "--json"], { cwd, home: cwd }) }
    finally { process.stdout.write = orig }
    const d = JSON.parse(chunks.join(""))
    assert.equal(d.dryRun, true)
    assert.ok(Array.isArray(d.plan) && d.plan.length)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify (comando): sink escreve verify.progress.jsonl incremental + verify.json", async () => {
  const cwd = await projectWith({ lint: "x", test: "x" })
  try {
    const { verifyCommand } = await imp(cmdMod)
    const orig = process.stdout.write
    process.stdout.write = () => true
    try { await verifyCommand(["--profile", "scaffold", "--json"], { cwd, home: cwd, exec: () => {}, runId: "fixedrun" }) }
    finally { process.stdout.write = orig }
    const dir = path.join(cwd, ".gstack", "runs", "fixedrun")
    assert.ok(existsSync(path.join(dir, "verify.progress.jsonl")), "progress.jsonl existe")
    assert.ok(existsSync(path.join(dir, "verify.json")), "verify.json existe")
    const prog = (await readFile(path.join(dir, "verify.progress.jsonl"), "utf-8")).trim().split("\n").filter(Boolean)
    assert.ok(prog.length >= 2, "progresso por etapa")
    assert.ok(JSON.parse(prog[0]).ts, "cada linha tem timestamp")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
