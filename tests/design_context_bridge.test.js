import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.1 — bridge de contexto canônico de design. GStack já é dono de
 * `.gstack/design-system.json` (design-system.js) e Product Brief v2 (PRD47 S47.2) — este
 * módulo só PROJETA esses artefatos em PRODUCT.md/DESIGN.md/.impeccable/design.json,
 * nunca cria uma segunda autoridade. Uma decisão canônica produz TODAS as projeções.
 */

test("classifySurface: copy de marketing sem fluxo de produto -> brand", async () => {
  const { classifySurface } = await imp("src/skills/design-context-schema.js")
  assert.equal(classifySurface({ hasMarketingCopy: true, hasProductFlow: false }), "brand")
})

test("classifySurface: fluxo de produto sem copy de marketing -> product", async () => {
  const { classifySurface } = await imp("src/skills/design-context-schema.js")
  assert.equal(classifySurface({ hasMarketingCopy: false, hasProductFlow: true }), "product")
})

test("classifySurface: ambos os sinais -> mixed; nenhum sinal -> product (default seguro, nunca 'brand' por omissão)", async () => {
  const { classifySurface } = await imp("src/skills/design-context-schema.js")
  assert.equal(classifySurface({ hasMarketingCopy: true, hasProductFlow: true }), "mixed")
  assert.equal(classifySurface({}), "product")
})

test("buildProjections: uma decisão canônica (design-system.json) produz as 3 projeções com sourceHash IGUAL", async () => {
  const { buildProjections } = await imp("src/skills/design-context.js")
  const ds = { schemaVersion: "gstack.design-system.v2", status: "generated", direction: "minimal-editorial", tokens: { colors: { primary: "#111" }, typography: { body: "Inter" } } }
  const p = buildProjections({ ds, brief: { objective: "SaaS com login" } })
  assert.ok(p.files["PRODUCT.md"])
  assert.ok(p.files["DESIGN.md"])
  assert.ok(p.files[".impeccable/design.json"])
  assert.match(p.sourceHash, /^sha256:/)
  assert.ok(p.generatedAt)
})

test("buildProjections: monorepo — owningApp fica registrado na projeção (child override)", async () => {
  const { buildProjections } = await imp("src/skills/design-context.js")
  const ds = { schemaVersion: "gstack.design-system.v2", status: "bypassed" }
  const p = buildProjections({ ds, owningApp: "apps/web" })
  assert.equal(p.owningApp, "apps/web")
})

test("buildProjections: mesma entrada -> mesmo sourceHash (determinístico, permite detectar drift)", async () => {
  const { buildProjections } = await imp("src/skills/design-context.js")
  const ds = { schemaVersion: "gstack.design-system.v2", status: "complete", direction: "bold-vibrant" }
  const a = buildProjections({ ds, brief: { objective: "x" } })
  const b = buildProjections({ ds, brief: { objective: "x" } })
  assert.equal(a.sourceHash, b.sourceHash)
})

test("buildProjections: opt-out (bypassed) nunca vira claim de design validado no DESIGN.md gerado", async () => {
  const { buildProjections } = await imp("src/skills/design-context.js")
  const ds = { schemaVersion: "gstack.design-system.v2", status: "bypassed" }
  const p = buildProjections({ ds })
  assert.match(p.files["DESIGN.md"], /não foi validad/i)
})

test("projectionDriftStatus: ausente -> 'absent'; hash igual -> 'fresh'; hash diferente -> 'stale'", async () => {
  const { projectionDriftStatus } = await imp("src/skills/design-context.js")
  assert.equal(projectionDriftStatus(null, "sha256:abc"), "absent")
  assert.equal(projectionDriftStatus("sha256:abc", "sha256:abc"), "fresh")
  assert.equal(projectionDriftStatus("sha256:abc", "sha256:def"), "stale")
})

test("detectHumanEdit: conteúdo em disco diverge do que o GStack teria gerado -> true (edição humana)", async () => {
  const { detectHumanEdit } = await imp("src/skills/design-context.js")
  assert.equal(detectHumanEdit("# Design\nversão editada à mão", "# Design\nversão gerada"), true)
  assert.equal(detectHumanEdit("# Design\nigual", "# Design\nigual"), false)
  assert.equal(detectHumanEdit(null, "# Design\ngerado"), false, "nunca existiu -> não é edição humana")
})

test("reconciliationPlan: edição humana detectada -> plano de reconciliação de 3 vias, NUNCA sobrescreve silenciosamente", async () => {
  const { reconciliationPlan } = await imp("src/skills/design-context.js")
  const plan = reconciliationPlan({ canonical: "estado canônico", existingOnDisk: "editado à mão", freshlyGenerated: "gerado agora" })
  assert.equal(plan.action, "reconciliation_required")
  assert.ok(plan.canonical && plan.existingOnDisk && plan.freshlyGenerated, "as 3 vias estão presentes")
})

test("malformed canonical artifact (design-system.json corrompido) -> buildProjections lança, nunca gera projeção de estado inválido", async () => {
  const { buildProjections } = await imp("src/skills/design-context.js")
  assert.throws(() => buildProjections({ ds: null }))
})

test("--design-system none: DESIGN.md registra a escolha como rastreável, nunca escondida", async () => {
  const { buildProjections } = await imp("src/skills/design-context.js")
  const ds = { schemaVersion: "gstack.design-system.v2", status: "bypassed", source: "--design-system none" }
  const p = buildProjections({ ds })
  assert.match(p.files["DESIGN.md"], /opt-out|--design-system none/i)
})
