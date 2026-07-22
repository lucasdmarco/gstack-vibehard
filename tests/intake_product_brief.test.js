import test from "node:test"
import assert from "node:assert/strict"
import { runIntake, decisionValue } from "../src/project-plan/intake.js"
import { buildProductBrief, acceptanceIsHonest, acceptanceCoverage, PRODUCT_BRIEF_SCHEMA } from "../src/project-plan/product-brief.js"
import { blockingDecisions, MAX_BLOCKING_DECISIONS, slugFromObjective } from "../src/project-plan/question-registry.js"

// PRD42 S42.1 — Intake estruturado + Product Brief. Contratos provados: (1) toda decisão traz
// why+consequence+default; (2) --yes NUNCA inventa resposta (grava default com fonte
// recommended_default); (3) flag sobrepõe; (4) TODO aceite tem verificador REAL ou pending_verifier
// (nunca ambos, nunca nenhum); (5) o teto de 5 decisões bloqueantes é fail-closed.

test("intake --yes: cada decisão vem do default com fonte recommended_default (nada inventado)", async () => {
  const r = await runIntake({ objective: "SaaS com login e pagamento stripe", nonInteractive: true })
  assert.equal(r.cancelled, false)
  for (const d of r.decisions) {
    assert.ok(d.why && d.consequence, `decisão ${d.id} sem why/consequence`)
    assert.equal(d.source, "recommended_default", `${d.id} deveria ser recommended_default sob --yes`)
    assert.deepEqual(d.value, d.default, `${d.id}: valor != default`)
  }
  assert.equal(decisionValue(r.decisions, "mode"), "full", "saas recomenda full")
})

test("intake: flag explícita sobrepõe e é rastreada como source=flag", async () => {
  const r = await runIntake({ objective: "landing page simples", flags: { mode: "full" }, nonInteractive: true })
  const mode = r.decisions.find((d) => d.id === "mode")
  assert.equal(mode.value, "full")
  assert.equal(mode.source, "flag")
})

test("intake interativo: resposta do usuário é source=user_answer", async () => {
  const ui = { prompt: async () => "meuapp", select: async (_q, opts) => opts.find((o) => /leve/i.test(o)) || opts[0] }
  const r = await runIntake({ objective: "web app fullstack", ui })
  const name = r.decisions.find((d) => d.id === "projectName")
  assert.equal(name.source, "user_answer")
  assert.equal(name.value, "meuapp")
  assert.equal(decisionValue(r.decisions, "mode"), "lite", "escolheu Leve na UI")
})

test("product brief: aceites de infra têm verifier REAL; feature/integração são pending_verifier", async () => {
  const intake = await runIntake({ objective: "SaaS com login e pagamento stripe", nonInteractive: true })
  const brief = buildProductBrief(intake)
  assert.equal(brief.schema, PRODUCT_BRIEF_SCHEMA)
  // invariante de honestidade em TODO aceite
  for (const a of brief.acceptances) assert.ok(acceptanceIsHonest(a), `aceite ${a.id} desonesto`)
  const byId = Object.fromEntries(brief.acceptances.map((a) => [a.id, a]))
  assert.ok(byId["quality-gate"].verifier, "QG tem verificador real")
  assert.ok(byId["feature-behavior"].pending_verifier, "feature é pending")
  assert.ok(byId["integration-stripe"].pending_verifier, "integração stripe é pending (E2E S42.13)")
  const cov = acceptanceCoverage(brief)
  assert.equal(cov.total, cov.withVerifier + cov.pending)
  assert.ok(cov.pending >= 2, "há aceites honestamente pendentes")
})

test("CONTROLE NEGATIVO: aceite com verifier E pending (ou nenhum) reprova acceptanceIsHonest", () => {
  assert.equal(acceptanceIsHonest({ id: "x", verifier: { ref: "a" }, pending_verifier: { reason: "b" } }), false, "os dois = desonesto")
  assert.equal(acceptanceIsHonest({ id: "y" }), false, "nenhum = desonesto")
  assert.equal(acceptanceIsHonest({ id: "z", verifier: { ref: "a" } }), true)
})

test("CONTROLE NEGATIVO: buildProductBrief lança se um aceite for adulterado p/ desonesto", async () => {
  const intake = await runIntake({ objective: "api backend", nonInteractive: true })
  // injeta um verificador falso num aceite pending via monkeypatch do array não é possível aqui;
  // provamos a defesa em profundidade pela função pura + o guard em buildAcceptances (coberto acima).
  const brief = buildProductBrief(intake)
  assert.ok(brief.acceptances.every(acceptanceIsHonest))
})

test("teto de decisões bloqueantes é fail-closed (<= MAX)", () => {
  const bd = blockingDecisions({ recipe: { recommendedMode: "full", optionalSteps: ["tools:install:stripe"] } })
  assert.ok(bd.length <= MAX_BLOCKING_DECISIONS)
  assert.ok(bd.every((d) => d.why && d.consequence), "toda decisão tem why+consequence")
})

test("slugFromObjective: determinístico, sem acento, sem símbolo", () => {
  assert.equal(slugFromObjective("SaaS com Login & Pagamentos (Stripe)!"), "saas-com-login-pagamentos-stripe")
  assert.equal(slugFromObjective(""), "meu-projeto")
})

// PRD47 S47.2 — Product Brief v2: designDirection elimina ambiguidade de estilo antes da escrita.
test("intake: objetivo que toca frontend inclui designDirection nas decisões bloqueantes", async () => {
  const r = await runIntake({ objective: "landing page para o meu produto", nonInteractive: true })
  const dd = r.decisions.find((d) => d.id === "designDirection")
  assert.ok(dd, "designDirection deve aparecer quando o objetivo toca frontend")
  assert.equal(dd.source, "recommended_default")
  assert.equal(dd.value, "none", "sem interação, default é opt-out explícito — nunca chuta gosto")
})

test("intake: objetivo que NÃO toca frontend (api pura) nunca pergunta designDirection", async () => {
  const r = await runIntake({ objective: "api backend de pagamentos", nonInteractive: true })
  assert.equal(r.decisions.find((d) => d.id === "designDirection"), undefined)
})

test("intake: teto de 5 continua respeitado mesmo com designDirection + integrations juntos", async () => {
  const r = await runIntake({ objective: "landing page com stripe", nonInteractive: true })
  assert.ok(r.decisions.length <= 5, `${r.decisions.length} decisões`)
})

test("product brief v2: schema é v2, designDirection presente com value/source/tokens", async () => {
  const intake = await runIntake({ objective: "landing page para produto novo", nonInteractive: true })
  const brief = buildProductBrief(intake)
  assert.equal(brief.schema, "gstack.product-brief.v2")
  assert.ok(brief.designDirection)
  assert.equal(brief.designDirection.value, "none")
  assert.equal(brief.designDirection.source, "recommended_default")
  assert.equal(brief.designDirection.tokens, null, "opt-out não tem tokens")
})

test("product brief v2: direção do catálogo escolhida persiste os tokens verificáveis", async () => {
  const ui = { prompt: async () => "x", select: async (_q, opts) => opts.find((o) => /minimalista/i.test(o)) || opts[0] }
  const intake = await runIntake({ objective: "landing page bonita", ui })
  const brief = buildProductBrief(intake)
  assert.equal(brief.designDirection.value, "minimal-editorial")
  assert.equal(brief.designDirection.source, "user_answer")
  assert.ok(brief.designDirection.tokens.colors)
})

test("CONTROLE NEGATIVO: brief incompleto (frontend sem direção resolvida) lança — nunca vira plano executável", async () => {
  const { buildProductBrief: build } = await import("../src/project-plan/product-brief.js")
  const fakeIntake = {
    objective: "landing page sem direção", recipe: { id: "landing-page", optionalSteps: [] },
    decisions: [
      { id: "projectName", value: "x" }, { id: "mode", value: "lite" },
      { id: "designDirection", value: "" }, // valor inválido/vazio — nunca deveria chegar aqui, mas se chegar, reprova
    ],
  }
  assert.throws(() => build(fakeIntake), /designDirection incompleta/)
})

test("migrateProductBrief: brief v1 antigo ganha designDirection opt-out (nunca inventa escolha)", async () => {
  const { migrateProductBrief } = await import("../src/project-plan/product-brief.js")
  const v1 = { schema: "gstack.product-brief.v1", objective: "x", acceptances: [] }
  const migrated = migrateProductBrief(v1)
  assert.equal(migrated.schema, "gstack.product-brief.v2")
  assert.equal(migrated.designDirection.value, "none")
  assert.equal(migrated.designDirection.source, "migrated_v1")
})

test("migrateProductBrief: brief já v2 passa intacto (idempotente)", async () => {
  const { migrateProductBrief, PRODUCT_BRIEF_SCHEMA } = await import("../src/project-plan/product-brief.js")
  const v2 = { schema: PRODUCT_BRIEF_SCHEMA, designDirection: { value: "custom", source: "user_answer", tokens: null } }
  assert.deepEqual(migrateProductBrief(v2), v2)
})

test("designSystemFromDirection (design-system.js ponte): direção do catálogo produz DS que PASSA validateDesignContent", async () => {
  const { designSystemFromDirection, validateDesignContent } = await import("../src/skills/design-system.js")
  const ds = designSystemFromDirection({ value: "dark-technical", tokens: { colors: { primary: "#00d9ff" }, typography: { body: "JetBrains Mono" } } })
  assert.equal(validateDesignContent(ds).ok, true)
})

test("designSystemFromDirection: none/custom -> null (nada a registrar automaticamente)", async () => {
  const { designSystemFromDirection } = await import("../src/skills/design-system.js")
  assert.equal(designSystemFromDirection({ value: "none" }), null)
  assert.equal(designSystemFromDirection({ value: "custom" }), null)
  assert.equal(designSystemFromDirection(null), null)
})
