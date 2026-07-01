import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

async function withPlan(fn) {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-exec-"))
  try {
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "loja" })
    const planDir = path.join(tmp, ".gstack", "plans", plan.id)
    return await fn({ tmp, plan, planDir })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

test("executor: roda todos os passos obrigatórios em ordem e marca done", async () => {
  await withPlan(async ({ tmp, plan, planDir }) => {
    const { executePlan } = await imp("src/project-plan/executor.js")
    const ran = []
    const exec = (command) => { ran.push(command.join(" ")) }
    const r = executePlan({ plan, planDir, cwd: tmp, exec })
    assert.equal(r.status, "done")
    assert.equal(r.completed.length, plan.steps.length)
    assert.ok(ran[0].includes("gstack_vibehard doctor"))
    assert.ok(ran.some((c) => c.includes("create loja")))
  })
})

test("executor: para no primeiro erro de passo obrigatório (não esconde falha)", async () => {
  await withPlan(async ({ tmp, plan, planDir }) => {
    const { executePlan } = await imp("src/project-plan/executor.js")
    const { readState } = await imp("src/project-plan/state.js")
    let n = 0
    const exec = () => { n++; if (n === 2) throw new Error("create falhou: porta ocupada\nstack...") }
    const r = executePlan({ plan, planDir, cwd: tmp, exec })
    assert.equal(r.status, "failed")
    assert.equal(r.failed.stepId, "create")
    // resumo de erro só primeira linha (sem stack bruto no journal)
    assert.ok(!r.failed.summary.includes("stack"))
    const st = readState(planDir)
    assert.equal(st.status, "failed")
    assert.equal(st.steps["create"], "failed")
  })
})

test("executor: retoma — passos já concluídos viram journal_hit, não re-executam", async () => {
  await withPlan(async ({ tmp, plan, planDir }) => {
    const { executePlan } = await imp("src/project-plan/executor.js")
    // 1ª execução: falha no 3º passo
    let n = 0
    executePlan({ plan, planDir, cwd: tmp, exec: () => { n++; if (n === 3) throw new Error("falha temporária") } })
    // 2ª execução: agora tudo ok — os 2 primeiros não devem re-rodar
    const reRan = []
    const r2 = executePlan({ plan, planDir, cwd: tmp, exec: (cmd) => { reRan.push(cmd[1]) } })
    assert.equal(r2.status, "done")
    assert.ok(!reRan.includes("doctor"), "doctor já concluído não re-executa")
    assert.ok(reRan.includes("context"), "retoma a partir do passo que faltava")
  })
})

test("executor: passos opcionais só rodam com includeOptional; pendingFeature é pulado", async () => {
  await withPlan(async ({ tmp, plan, planDir }) => {
    const { executePlan } = await imp("src/project-plan/executor.js")
    // web-app tem optionals runtime:start (REAL → `dev`) e deploy:preview (pending).
    const ran = []
    const r = executePlan({ plan, planDir, cwd: tmp, exec: (c) => ran.push(c.join(" ")), includeOptional: true })
    assert.equal(r.status, "done")
    // deploy:preview segue pendingFeature → pulado (nunca vira comando)
    assert.ok(r.skipped.includes("deploy:preview"))
    assert.ok(!ran.some((c) => c.includes("deploy")))
    // runtime:start virou passo real (PRD14): roda `gstack_vibehard dev` no opt-in
    assert.ok(r.completed.includes("runtime:start"))
    assert.ok(ran.includes("gstack_vibehard dev"))
  })
})
