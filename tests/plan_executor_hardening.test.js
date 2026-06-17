import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("sanitizeCommand: redige tokens, KEY=VALUE sensível e credencial em URL", async () => {
  const { sanitizeCommand } = await imp("src/project-plan/executor.js")
  assert.equal(sanitizeCommand(["gstack_vibehard", "tools", "install", "x", "--token", "abc123"]),
    "gstack_vibehard tools install x --token ***")
  assert.equal(sanitizeCommand(["run", "API_KEY=supersecret"]), "run API_KEY=***")
  assert.match(sanitizeCommand(["clone", "https://user:pass@host/repo"]), /\/\/\*\*\*:\*\*\*@host/)
  // comando normal não é alterado
  assert.equal(sanitizeCommand(["gstack_vibehard", "doctor"]), "gstack_vibehard doctor")
})

test("executor (defaultRunner): rejeita comando fora da allowlist, sem shell", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-allow-"))
  try {
    const { executePlan } = await imp("src/project-plan/executor.js")
    const { makePlan, makeStep } = await imp("src/project-plan/schema.js")
    // plano adulterado: command[0] não é gstack_vibehard
    const plan = makePlan({ objective: "x", steps: [makeStep({ id: "evil", label: "evil", command: ["rm", "-rf", "/"] })] })
    const planDir = path.join(tmp, ".gstack", "plans", plan.id)
    // SEM exec injetado → usa defaultRunner, que deve REJEITAR antes de rodar nada
    const r = executePlan({ plan, planDir, cwd: tmp })
    assert.equal(r.status, "failed")
    assert.equal(r.failed.stepId, "evil")
    assert.match(r.failed.summary, /não permitido|nao permitido/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("executor: journal grava comando SANITIZADO (sem segredo bruto)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-jsan-"))
  try {
    const { executePlan } = await imp("src/project-plan/executor.js")
    const { makePlan, makeStep } = await imp("src/project-plan/schema.js")
    const plan = makePlan({ objective: "x", steps: [makeStep({ id: "s1", label: "s1", command: ["gstack_vibehard", "tools", "install", "x", "--token", "SECRET123"] })] })
    const planDir = path.join(tmp, ".gstack", "plans", plan.id)
    executePlan({ plan, planDir, cwd: tmp, exec: () => {} }) // exec injetado, não roda de verdade
    const journal = readFileSync(path.join(planDir, "journal.jsonl"), "utf-8")
    assert.ok(!journal.includes("SECRET123"), "segredo não vaza para o journal")
    assert.ok(journal.includes("--token ***"), "valor redigido")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
