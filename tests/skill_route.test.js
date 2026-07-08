import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── detectores ───────────────────────────────────────────────────────────────────
test("detectCapabilities: dashboard+login toca frontend E dados (acceptance 29.2)", async () => {
  const { detectCapabilities } = await imp("src/skills/route.js")
  const caps = detectCapabilities("criar dashboard de imóveis com login e Supabase")
  assert.equal(caps.touchesFrontend, true)
  assert.equal(caps.touchesData, true)
  assert.equal(caps.touchesDeploy, false)
  const puro = detectCapabilities("refatorar função de parse")
  assert.equal(puro.touchesFrontend, false)
  assert.equal(puro.touchesSecrets, false)
})

// ── rota ─────────────────────────────────────────────────────────────────────────
test("buildSkillRoute: frontend seleciona skills dos gates aplicáveis + questions", async () => {
  const { buildSkillRoute } = await imp("src/skills/route.js")
  const r = buildSkillRoute({ objective: "criar painel de imóveis novos", template: "react-vite", root: repoRoot })
  assert.equal(r.schemaVersion, "gstack.skill-route.v1")
  assert.equal(r.detectedCapabilities.touchesFrontend, true)
  assert.ok(r.selectedSkills.includes("frontend-design"), `frontend-design na rota: ${r.selectedSkills}`)
  assert.ok(r.blockingGates.includes("design-system-gate"))
  assert.ok(r.requiredQuestions.some((q) => /design system/i.test(q)))
  assert.equal(r.selectionSource, "gate_matrix")
})

test("buildSkillRoute: --skills tem precedência total (user_flag)", async () => {
  const { buildSkillRoute } = await imp("src/skills/route.js")
  const r = buildSkillRoute({ objective: "criar site", root: repoRoot, selectedSkillsOverride: ["frontend-design", "react-vite"] })
  assert.deepEqual(r.selectedSkills, ["frontend-design", "react-vite"])
  assert.equal(r.selectionSource, "user_flag")
})

test("modelIntake: complete com fontes vs explicitly_skipped com autor do skip", async () => {
  const { buildModelIntake } = await imp("src/skills/route.js")
  const c = buildModelIntake({ sources: ["screenshot", "schema_supabase"] })
  assert.equal(c.status, "complete"); assert.equal(c.hasExistingModel, true)
  const s = buildModelIntake({ skipped: true, skippedBy: "--yes" })
  assert.equal(s.status, "explicitly_skipped"); assert.equal(s.skippedBy, "--yes")
})

test("gateApplies: só quando TODAS as capacidades booleanas exigidas são true", async () => {
  const { gateApplies } = await imp("src/skills/route.js")
  const g = { appliesWhen: { touchesFrontend: true } }
  assert.equal(gateApplies(g, { touchesFrontend: true }), true)
  assert.equal(gateApplies(g, { touchesFrontend: false }), false)
  assert.equal(gateApplies({ appliesWhen: {} }, { touchesFrontend: true }), false, "gate de runtime não entra na rota estática")
})

// ── wiring no start ──────────────────────────────────────────────────────────────
const startOpts = (dir, extra = {}) => ({
  cwd: dir,
  classify: () => ({ state: "empty_dir", description: "", signals: {}, actions: [] }),
  exec: () => ({ ok: true }), gateExec: () => ({ ok: true, code: 0 }),
  devRunner: () => ({ services: [] }),
  verifyRunner: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
  // scout real spawna python (era o HANG do teste original) — sempre injetado.
  scoutRunner: () => ({ status: "not_applicable", detail: "teste" }),
  ...extra,
})
// REGRA (PRD34 §2.1): fake de select imita o CONTRATO REAL — retorna a STRING
// da opção escolhida (como src/cli/index.js), nunca índice numérico.
const selectLike = (rules) => async (q, choices) => {
  for (const [match, pick] of rules) if (match.test(q)) return choices.find((c) => pick.test(c)) ?? choices[0]
  return choices[0]
}

test("start interativo com frontend: pergunta modelIntake ANTES de confirmar (select REAL=string)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-route-"))
  const questions = []
  try {
    const r = await startCommand([], startOpts(dir, {
      objective: "criar dashboard de vendas",
      prompt: async () => "meu-dash",
      select: async (q, choices) => { questions.push(q); return selectLike([[/modelo\/artefato/, /Figma/]])(q, choices) },
      confirm: async () => false, // não executa — só declara
    }))
    assert.ok(questions.some((q) => /modelo\/artefato/.test(q)), `perguntou intake: ${questions}`)
    assert.equal(r.skillRoute.modelIntake.status, "complete")
    assert.deepEqual(r.skillRoute.modelIntake.sources, ["figma"])
    assert.equal(r.executed, false)
    // artefato persistido no plano mesmo sem executar
    const planDirs = path.join(dir, ".gstack", "plans")
    const planId = (await import("node:fs")).readdirSync(planDirs)[0]
    assert.ok(existsSync(path.join(planDirs, planId, "skill-route.json")), "plans/<id>/skill-route.json")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("start --yes: intake vira explicitly_skipped(--yes) e runs/<runId>/skill-route.json existe", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-route-yes-"))
  try {
    // --yes NÃO pula o gate P0 de design system sozinho — opt-out é explícito (F2-B).
    const r = await startCommand(["--yes", "--design-system", "none"], startOpts(dir, { objective: "criar landing page", prompt: async () => "lp" }))
    assert.equal(r.skillRoute.modelIntake.status, "explicitly_skipped")
    assert.equal(r.skillRoute.modelIntake.skippedBy, "--yes")
    assert.equal(r.executed, true)
    const routePath = path.join(dir, ".gstack", "runs", r.pipeline.runId, "skill-route.json")
    assert.ok(existsSync(routePath), "runs/<runId>/skill-route.json declarado")
    const persisted = JSON.parse(readFileSync(routePath, "utf-8"))
    assert.ok(persisted.selectedSkills.length > 0, "skillsUsed declaradas no run")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("start: pergunta de intake é COERENTE com a rota (só quando touchesFrontend)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-route-nf-"))
  const questions = []
  try {
    const r = await startCommand([], startOpts(dir, {
      objective: "refatorar parser de logs", // objetivo neutro — mas o TEMPLATE do plano pode ativar frontend
      prompt: async () => "parser",
      select: async (q, choices) => { questions.push(q); return choices[0] }, // contrato real: string
      confirm: async () => false,
    }))
    // invariante: perguntou ⟺ a rota detectou frontend (objective+template+intent)
    const asked = questions.filter((q) => /modelo\/artefato/.test(q)).length
    assert.equal(asked > 0, r.skillRoute.detectedCapabilities.touchesFrontend === true,
      `pergunta (${asked}) coerente com touchesFrontend=${r.skillRoute.detectedCapabilities.touchesFrontend}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("parseRouteFlags: --skills lista e --assume-no-existing-model", async () => {
  const { parseRouteFlags } = await imp("src/skills/route.js")
  const f = parseRouteFlags(["--skills", "a, b,c", "--assume-no-existing-model"])
  assert.deepEqual(f.skills, ["a", "b", "c"])
  assert.equal(f.assumeNoExistingModel, true)
})
