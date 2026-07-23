import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..", "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.7 — E2E com provider FAKE: prova a rota completa (intake ->
 * gate de gasto -> cap de iteração -> geração -> manifesto) sem gastar
 * crédito real e sem qualquer provider pago configurado. Cada gate usado é o
 * MESMO gate real (media-budget.js/scroll-world.js) — só o provider é fake.
 *
 * Escopo honesto: NÃO prova os gates determinísticos/operacionais reais do
 * plano original (continuidade de seam entre frames renderizados, viewport
 * mobile, reduced-motion, orçamento de performance/LCP, detector Impeccable +
 * gate visual) — esses exigiriam um pipeline de mídia/Playwright real que não
 * existe nesta sessão. Ver docs/guides/scroll-world.md para o backlog.
 */

const FULL_INTAKE = Object.freeze({
  businessSubject: "loja de velas artesanais",
  brandKitOrProposal: "brand kit aprovado v2",
  brandRegisterAndDirection: "minimalista, tons pastel",
  orderedScenesAndCopy: [{ scene: 1, copy: "Acenda sua rotina" }, { scene: 2, copy: "Feito à mão" }],
  mobileChain: "desktop_only",
  providerAndTier: { provider: "fake-provider", tier: "standard" },
  estimatedGenerations: { stills: 2, videos: 0, rerollHeadroom: 1, balanceRisk: "low" },
  spendConfirmed: true,
})

async function loadDeps() {
  const budget = await imp("src/capabilities/media-budget.js")
  return {
    canProceedWithMediaSpend: budget.canProceedWithMediaSpend,
    enforceIterationCap: budget.enforceIterationCap,
    oneProviderPerChain: budget.oneProviderPerChain,
    buildMediaManifestEntry: budget.buildMediaManifestEntry,
  }
}

test("E2E fake-provider: intake completo + gasto confirmado -> gera manifesto SEM chamar provider real", async () => {
  const { runFakeProviderChain } = await imp("src/capabilities/scroll-world.js")
  const deps = await loadDeps()
  const r = await runFakeProviderChain({
    intake: FULL_INTAKE, budget: { estimatedCost: 5, attempted: 2, cap: 10 }, deps,
  })
  assert.equal(r.ok, true)
  assert.equal(r.mode, "generate")
  assert.equal(r.scenes.length, 2)
  for (const s of r.scenes) {
    assert.equal(s.manifest.provider, "fake-provider")
    assert.ok(s.manifest.promptHash.startsWith("sha256:"))
    assert.match(s.manifest.licenseNote, /synthetic fixture, no real provider called/)
  }
})

test("CONTROLE NEGATIVO: intake incompleto -> recusa ANTES de qualquer geração, nunca 'quase gera'", async () => {
  const { runFakeProviderChain } = await imp("src/capabilities/scroll-world.js")
  const deps = await loadDeps()
  const { spendConfirmed, ...withoutConfirm } = FULL_INTAKE
  const r = await runFakeProviderChain({ intake: withoutConfirm, budget: { estimatedCost: 5, attempted: 1, cap: 10 }, deps })
  assert.equal(r.ok, false)
  assert.equal(r.stage, "intake")
})

test("CONTROLE NEGATIVO: gasto não confirmado -> recusa mesmo com intake completo em tudo mais", async () => {
  const { runFakeProviderChain } = await imp("src/capabilities/scroll-world.js")
  const deps = await loadDeps()
  const r = await runFakeProviderChain({
    intake: { ...FULL_INTAKE, spendConfirmed: true },
    budget: { estimatedCost: 5, attempted: 1, cap: 10 },
    deps: { ...deps, canProceedWithMediaSpend: () => "blocked" },
  })
  assert.equal(r.ok, false)
  assert.equal(r.stage, "spend")
})

test("CONTROLE NEGATIVO: cap de iteração excedido -> recusa antes de gerar", async () => {
  const { runFakeProviderChain } = await imp("src/capabilities/scroll-world.js")
  const deps = await loadDeps()
  const r = await runFakeProviderChain({ intake: FULL_INTAKE, budget: { estimatedCost: 5, attempted: 20, cap: 10 }, deps })
  assert.equal(r.ok, false)
  assert.equal(r.stage, "iteration_cap")
})

test("dependência ausente (ex.: ffmpeg) -> fallback estático, projeto NUNCA marcado falsamente completo", async () => {
  const { runFakeProviderChain } = await imp("src/capabilities/scroll-world.js")
  const deps = await loadDeps()
  const r = await runFakeProviderChain({
    intake: FULL_INTAKE, budget: { estimatedCost: 5, attempted: 1, cap: 10 },
    deps: { ...deps, dependencies: { authOk: true, creditsOk: true, ffmpegOk: false, pillowOk: true, providerCapable: true } },
  })
  assert.equal(r.ok, true)
  assert.equal(r.mode, "static_fallback")
  for (const s of r.scenes) assert.equal(s.manifest, null, "fallback estático nunca fabrica um manifesto de geração")
})
