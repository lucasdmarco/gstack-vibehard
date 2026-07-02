import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

async function capture(fn) {
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await fn() } finally { process.stdout.write = orig }
  return buf
}

test("task-planner: gera workflow + delegate; OpenCode SEMPRE requer confirmação", async () => {
  const { buildTaskPlan } = await imp("src/project-plan/task-planner.js")
  const plan = buildTaskPlan({ request: "adicione checkout com Stripe", hasIndex: false })
  const ids = plan.steps.map((s) => s.id)
  assert.ok(ids.includes("workflow:run"))
  const delegate = plan.steps.find((s) => s.id === "delegate:opencode")
  assert.ok(delegate, "recomenda delegação OpenCode")
  assert.equal(delegate.requiresConfirmation, true, "OpenCode nunca sem confirmação")
  assert.equal(delegate.optional, true)
  // sem índice, não inclui context search
  assert.ok(!ids.includes("context:search"))
  // comandos são reais
  for (const s of plan.steps) assert.equal(s.command[0], "gstack_vibehard")
})

test("task-planner: escolhe loop pattern e delega em --worktree", async () => {
  const { buildTaskPlan } = await imp("src/project-plan/task-planner.js")
  const plan = buildTaskPlan({ request: "corrigir erro 500 no login", hasIndex: false })
  assert.equal(plan.loopPattern, "runtime-debugging", "bug de runtime → runtime-debugging")
  assert.ok(plan.verificationProfile === "runtime-debugging")
  assert.ok(plan.loopReason && plan.loopConfidence > 0)
  const delegate = plan.steps.find((s) => s.id === "delegate:opencode")
  assert.ok(delegate.command.includes("--worktree"), "delegação isolada por worktree")
})

test("task-planner: com índice usa Document Graph (context search/related)", async () => {
  const { buildTaskPlan } = await imp("src/project-plan/task-planner.js")
  const plan = buildTaskPlan({ request: "corrigir bug no Checkout de pagamentos", hasIndex: true })
  const ids = plan.steps.map((s) => s.id)
  assert.ok(ids.includes("context:search"), "usa context search quando há índice")
  const related = plan.steps.find((s) => s.id === "context:related")
  assert.ok(related && related.command.includes("Checkout"), "extrai entidade do pedido")
})

test("task command: --json puro com plano persistido; detecta índice", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-task-"))
  try {
    // simula índice existente
    await mkdir(path.join(tmp, ".gstack", "context"), { recursive: true })
    await writeFile(path.join(tmp, ".gstack", "context", "context.db"), "x")
    const { taskCommand } = await imp("src/commands/task.js")
    const buf = await capture(() => taskCommand(["adicione", "checkout", "com", "Stripe", "--json"], { cwd: tmp }))
    const out = JSON.parse(buf.trim())
    assert.equal(out.plan.hasIndex, true)
    assert.ok(out.plan.steps.some((s) => s.id === "context:search"))
    assert.ok(existsSync(path.join(tmp, ".gstack", "tasks", out.plan.id, "task.json")))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("task command: sub status delega ao worktree lifecycle (PRD14 §4.3)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-task2-"))
  try {
    const { taskCommand } = await imp("src/commands/task.js")
    // fora de repo git: o lifecycle responde com erro honesto (prova o roteamento real)
    const buf = await capture(() => taskCommand(["status", "--json"], { cwd: tmp }))
    assert.equal(JSON.parse(buf.trim()).error, "not_a_git_repo")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
