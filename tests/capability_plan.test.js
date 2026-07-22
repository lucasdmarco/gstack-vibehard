import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("buildCapabilityPlan: schema gstack.capability-plan.v1, reusa buildSkillRoute (repo real)", async () => {
  const { buildCapabilityPlan } = await imp("src/project-plan/capability-plan.js")
  const plan = buildCapabilityPlan({ objective: "criar landing page com stripe", root: repoRoot })
  assert.equal(plan.schemaVersion, "gstack.capability-plan.v1")
  assert.ok(plan.skills.length > 0, "detectou skills reais via route.js")
  assert.ok(plan.route.schemaVersion, "carrega a rota original — nunca duplica a lógica de detecção")
})

test("buildCapabilityPlan: toda skill selecionada nasce com receipt 'selected' e razão rastreada", async () => {
  const { buildCapabilityPlan } = await imp("src/project-plan/capability-plan.js")
  const plan = buildCapabilityPlan({ objective: "criar landing page", root: repoRoot })
  for (const id of plan.skills) {
    assert.ok(plan.receipts.some((r) => r.capabilityId === id && r.status === "selected"), `${id} sem receipt selected`)
    assert.ok(plan.reasons.some((r) => r.id === id && r.reason), `${id} sem razão`)
  }
})

test("buildCapabilityPlan: contextCost é sempre 'estimated' — nunca REAL sem benchmark", async () => {
  const { buildCapabilityPlan } = await imp("src/project-plan/capability-plan.js")
  const plan = buildCapabilityPlan({ objective: "criar landing page", root: repoRoot })
  assert.equal(plan.contextCost.basis, "estimated")
  assert.equal(typeof plan.contextCost.tokens, "number")
})

test("canTransitionReceipt: só selected->loaded->applied->verified é o caminho feliz; nenhum salto", async () => {
  const { canTransitionReceipt } = await imp("src/project-plan/capability-plan.js")
  assert.equal(canTransitionReceipt("selected", "loaded"), true)
  assert.equal(canTransitionReceipt("loaded", "applied"), true)
  assert.equal(canTransitionReceipt("applied", "verified"), true)
  assert.equal(canTransitionReceipt("selected", "applied"), false, "não pode pular loaded")
  assert.equal(canTransitionReceipt("selected", "verified"), false)
  assert.equal(canTransitionReceipt("verified", "applied"), false, "verified é terminal")
  assert.equal(canTransitionReceipt("failed", "loaded"), false, "failed é terminal")
})

test("recordReceipt: aplica transição válida sem mutar o plano original", async () => {
  const { buildCapabilityPlan, recordReceipt } = await imp("src/project-plan/capability-plan.js")
  const plan = buildCapabilityPlan({ objective: "criar landing page", root: repoRoot })
  const id = plan.skills[0]
  const next = recordReceipt(plan, id, "loaded")
  assert.ok(next.receipts.some((r) => r.capabilityId === id && r.status === "loaded"))
  assert.equal(plan.receipts.filter((r) => r.capabilityId === id).length, 1, "plano original intacto")
})

test("recordReceipt: lança em salto inválido (fail-closed, nunca silencioso)", async () => {
  const { buildCapabilityPlan, recordReceipt } = await imp("src/project-plan/capability-plan.js")
  const plan = buildCapabilityPlan({ objective: "criar landing page", root: repoRoot })
  const id = plan.skills[0]
  assert.throws(() => recordReceipt(plan, id, "verified"), /transição inválida/)
})

test("criticalSkillIgnored: skill crítica selecionada mas NUNCA aplicada -> lista de bloqueio (DoD)", async () => {
  const { buildCapabilityPlan, recordReceipt, criticalSkillIgnored } = await imp("src/project-plan/capability-plan.js")
  const plan = buildCapabilityPlan({ objective: "criar landing page", root: repoRoot })
  const critical = plan.skills[0]
  assert.deepEqual(criticalSkillIgnored(plan, [critical]), [critical], "ainda não aplicada -> ignorada")
  const applied = recordReceipt(recordReceipt(plan, critical, "loaded"), critical, "applied")
  assert.deepEqual(criticalSkillIgnored(applied, [critical]), [], "aplicada -> não está mais ignorada")
})

test("isSelected: capacidade fora do plano nunca é considerada selecionada (DoD: não entra no prompt)", async () => {
  const { buildCapabilityPlan, isSelected } = await imp("src/project-plan/capability-plan.js")
  const plan = buildCapabilityPlan({ objective: "criar landing page", root: repoRoot })
  assert.equal(isSelected(plan, "skill-que-nao-existe-inventada"), false)
  assert.equal(isSelected(plan, plan.skills[0]), true)
})
