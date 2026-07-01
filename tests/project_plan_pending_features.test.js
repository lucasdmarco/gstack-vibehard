import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("pending-features: registro tem dashboard/deploy sem comando; runtime é REAL (PRD14)", async () => {
  const { isPendingFeature, getPendingFeature } = await imp("src/project-plan/pending-features.js")
  for (const id of ["dashboard:open", "deploy:preview", "deploy:production"]) {
    assert.ok(isPendingFeature(id), `${id} é pending`)
    const pf = getPendingFeature(id)
    assert.ok(pf.label && pf.explanation, "tem label e explicação")
    assert.ok(!("command" in pf), "nunca carrega comando")
  }
  // runtime saiu do registro: o supervisor (`dev`/`logs`/`open`) existe e o planner
  // expande para comando real — pending aqui seria claim falso de produto incompleto.
  for (const id of ["runtime:start", "runtime:logs", "runtime:open"]) {
    assert.equal(isPendingFeature(id), false, `${id} não é mais pending`)
  }
  assert.equal(isPendingFeature("doctor"), false)
})

test("planner: steps de roadmap aparecem como pendingFeature (sem comando) e válidos", async () => {
  const { buildPlan } = await imp("src/project-plan/planner.js")
  const { plan, validation } = buildPlan({ objective: "SaaS com login e Stripe", projectName: "x" })
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  const dep = plan.optionalSteps.find((s) => s.id === "deploy:preview")
  assert.ok(dep, "deploy:preview presente como opcional")
  assert.equal(dep.pendingFeature, true)
  assert.equal(dep.command, null, "feature futura não carrega comando")
  assert.match(dep.label, /ainda não implementado/)
})

test("executor: nunca executa um pending feature (pula com step_skipped)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-pf-"))
  try {
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { executePlan } = await imp("src/project-plan/executor.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "loja" })
    const planDir = path.join(tmp, ".gstack", "plans", plan.id)
    const ran = []
    const r = executePlan({ plan, planDir, cwd: tmp, exec: (c) => ran.push(c.join(" ")), includeOptional: true })
    assert.equal(r.status, "done")
    assert.ok(r.skipped.includes("deploy:preview"), "deploy segue pending → pulado")
    assert.ok(!ran.some((c) => /deploy/.test(c)), "nenhum pending feature foi executado")
    // runtime:start agora é comando REAL: executa `gstack_vibehard dev` no opt-in
    assert.ok(r.completed.includes("runtime:start"), "runtime:start executa como passo real")
    assert.ok(ran.includes("gstack_vibehard dev"), "runtime:start roda o supervisor real")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
