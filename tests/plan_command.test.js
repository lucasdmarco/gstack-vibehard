import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "plan.js")

async function capture(fn) {
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await fn() } finally { process.stdout.write = orig }
  return buf
}

test("plan --json: JSON puro com plano de comandos reais, e persiste em disco", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-plan-"))
  try {
    const { planCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    const buf = await capture(() => planCommand(["SaaS com login e Stripe", "--name", "academiapro", "--json"], { cwd: tmp }))
    const out = JSON.parse(buf.trim())
    assert.equal(out.plan.intent, "saas-auth-stripe")
    const create = out.plan.steps.find((s) => s.id === "create")
    assert.deepEqual(create.command, ["gstack_vibehard", "create", "academiapro", "--template", "saas-auth-stripe"])
    // persistido
    const planFile = path.join(tmp, ".gstack", "plans", out.plan.id, "plan.json")
    assert.ok(existsSync(planFile), "plan.json persistido")
    const saved = JSON.parse(await readFile(planFile, "utf-8"))
    assert.equal(saved.id, out.plan.id)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("plan sem objetivo: erro em JSON puro", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-plan2-"))
  try {
    const { planCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    const buf = await capture(() => planCommand(["--json"], { cwd: tmp }))
    assert.equal(JSON.parse(buf.trim()).error, "missing objective")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("plan run <id>: honesto sobre executor pendente (não finge executar)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-plan3-"))
  try {
    const { planCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    const buf = await capture(() => planCommand(["run", "plan_x", "--json"], { cwd: tmp }))
    assert.equal(JSON.parse(buf.trim()).error, "executor_pending")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
