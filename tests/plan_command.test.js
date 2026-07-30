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

test("plan run <id> inexistente: erro not_found em JSON", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-plan3-"))
  try {
    const { planCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    const buf = await capture(() => planCommand(["run", "plan_inexistente", "--json", "--yes"], { cwd: tmp }))
    assert.equal(JSON.parse(buf.trim()).error, "not_found")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// PRD51 S51.10.0: com o Golden Run como default, um run de `exec` INJETADO não
// cria projeto de verdade e não resolve acceptance — o veredito honesto do motor
// é `handoff`, não `done`. O que este teste sempre provou (e segue provando) é o
// round-trip: o status que `plan run` reporta é o mesmo que `plan status` lê do
// disco depois. O valor concreto do status é consequência do modo, não a claim.
test("plan run: gera, executa com exec injetado (--yes) e o status persistido bate com o reportado", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-plan4-"))
  try {
    const { planCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    // 1) gera e persiste o plano
    const genBuf = await capture(() => planCommand(["web app", "--name", "loja", "--json"], { cwd: tmp }))
    const planId = JSON.parse(genBuf.trim()).plan.id
    // 2) executa com exec injetado (não roda comandos reais)
    const ran = []
    // PRD51 S51.4.1: plan run passa pelo MESMO design-system gate do start —
    // "web app" toca frontend, precisa de --design-system (none = opt-out honesto).
    const runBuf = await capture(() => planCommand(["run", planId, "--json", "--yes", "--design-system", "none"], { cwd: tmp, exec: (c) => ran.push(c.join(" ")) }))
    const res = JSON.parse(runBuf.trim())
    assert.equal(res.status, "handoff", "default Golden Run: exec fake não entrega — handoff honesto")
    assert.ok(ran.some((c) => c.includes("create loja")), "o pipeline REALMENTE executou o create")
    // 3) o status lido do disco é o mesmo reportado pelo run (a claim real deste teste)
    const stBuf = await capture(() => planCommand(["status", planId, "--json"], { cwd: tmp }))
    assert.equal(JSON.parse(stBuf.trim()).status, res.status)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("plan run: PRD51 S51.4.1 -- vai além do create (mesmo pipeline do start: review/verify/preview reais, não só create)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-plan5-"))
  try {
    const { planCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
    const genBuf = await capture(() => planCommand(["cli tool", "--name", "ferramenta", "--json"], { cwd: tmp }))
    const planId = JSON.parse(genBuf.trim()).plan.id
    const runBuf = await capture(() => planCommand(["run", planId, "--json", "--yes"], { cwd: tmp, exec: () => {} }))
    const res = JSON.parse(runBuf.trim())
    assert.ok(res.stages, "resultado agora tem os estágios do pipeline completo (não só {planId,status,completed,skipped})")
    assert.ok("review" in res.stages && "verify" in res.stages && "preview" in res.stages, "review/verify/preview presentes -- antes plan run nunca chegava neles")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
