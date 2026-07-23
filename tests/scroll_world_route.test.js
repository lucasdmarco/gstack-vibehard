import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.7 — Scroll World: capacidade distribuída, NUNCA um novo skill ID/
 * comando/catálogo público. As regras são mapeadas para papéis de especialista
 * JÁ EXISTENTES (frontend/UX/a11y/performance/QA) — o Agent Factory materializa
 * por run, não instala nada globalmente.
 */

const FULL_INTAKE = Object.freeze({
  businessSubject: "loja de velas artesanais",
  brandKitOrProposal: "brand kit aprovado v2",
  brandRegisterAndDirection: "minimalista, tons pastel",
  orderedScenesAndCopy: [{ scene: 1, copy: "Acenda sua rotina" }, { scene: 2, copy: "Feito à mão" }],
  mobileChain: "desktop_only",
  providerAndTier: { provider: "stub-provider", tier: "standard" },
  estimatedGenerations: { stills: 4, videos: 1, rerollHeadroom: 2, balanceRisk: "low" },
  spendConfirmed: true,
})

test("validateScrollWorldIntake: intake completo -> ok", async () => {
  const { validateScrollWorldIntake } = await imp("src/capabilities/scroll-world.js")
  const r = validateScrollWorldIntake(FULL_INTAKE)
  assert.equal(r.ok, true)
  assert.deepEqual(r.missing, [])
})

test("CONTROLE NEGATIVO: qualquer um dos 8 itens obrigatórios ausente -> bloqueado, nunca prossegue", async () => {
  const { validateScrollWorldIntake } = await imp("src/capabilities/scroll-world.js")
  for (const field of Object.keys(FULL_INTAKE)) {
    const partial = { ...FULL_INTAKE, [field]: undefined }
    const r = validateScrollWorldIntake(partial)
    assert.equal(r.ok, false, `${field} ausente deveria bloquear`)
    assert.ok(r.missing.includes(field))
  }
})

test("CONTROLE NEGATIVO: spendConfirmed:false NUNCA passa, mesmo com todo o resto completo", async () => {
  const { validateScrollWorldIntake } = await imp("src/capabilities/scroll-world.js")
  const r = validateScrollWorldIntake({ ...FULL_INTAKE, spendConfirmed: false })
  assert.equal(r.ok, false)
  assert.ok(r.missing.includes("spendConfirmed"))
})

test("routeScrollWorldFragment: mapeia pra papel de especialista JÁ EXISTENTE, nunca cria skill novo", async () => {
  const { routeScrollWorldFragment, EXISTING_SPECIALIST_ROLES } = await imp("src/capabilities/scroll-world.js")
  for (const domain of ["frontend", "ux", "accessibility", "performance", "qa"]) {
    const role = routeScrollWorldFragment(domain)
    assert.ok(EXISTING_SPECIALIST_ROLES.includes(role), `${domain} -> ${role} deve ser um papel já existente`)
  }
})

test("routeScrollWorldFragment: domínio desconhecido -> null honesto, nunca fabrica papel", async () => {
  const { routeScrollWorldFragment } = await imp("src/capabilities/scroll-world.js")
  assert.equal(routeScrollWorldFragment("nao-existe"), null)
})

test("PROVENANCE REAL: EXISTING_SPECIALIST_ROLES são personas REAIS em agents/agents/*.md, nunca fabricadas", async () => {
  const { EXISTING_SPECIALIST_ROLES } = await imp("src/capabilities/scroll-world.js")
  for (const role of EXISTING_SPECIALIST_ROLES) {
    assert.ok(existsSync(path.join(repoRoot, "agents", "agents", `${role}.md`)), `${role} deve existir de verdade em agents/agents/`)
  }
})

test("SCROLL_WORLD publica ZERO novo skill/comando/catálogo público", async () => {
  const mod = await imp("src/capabilities/scroll-world.js")
  assert.equal(mod.PUBLIC_SKILL_ID, null, "nenhum skill ID público — capacidade distribuída, não um catálogo novo")
})

test("resolveGenerationFallback: tudo disponível -> generate; qualquer dependência ausente -> static_fallback", async () => {
  const { resolveGenerationFallback } = await imp("src/capabilities/scroll-world.js")
  const allOk = resolveGenerationFallback({ authOk: true, creditsOk: true, ffmpegOk: true, pillowOk: true, providerCapable: true })
  assert.equal(allOk.mode, "generate")
  for (const missing of ["authOk", "creditsOk", "ffmpegOk", "pillowOk", "providerCapable"]) {
    const deps = { authOk: true, creditsOk: true, ffmpegOk: true, pillowOk: true, providerCapable: true, [missing]: false }
    const r = resolveGenerationFallback(deps)
    assert.equal(r.mode, "static_fallback", `${missing} ausente deve cair pro fallback estático`)
    assert.equal(r.preservesApprovedBrief, true, "projeto nunca é destruído/marcado falsamente completo")
  }
})
