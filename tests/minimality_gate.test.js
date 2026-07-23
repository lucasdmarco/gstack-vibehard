import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD49 S49.5 — minimality gate: bloqueia dependência/abstração nova SEM
 * justificativa quando um caminho local/nativo já provado existe. NUNCA
 * bloqueia concern protegido (segurança/validação/testes/a11y/observabilidade/
 * escopo explícito do usuário). Diff/LOC é só sinal, nunca o veredito — código
 * menor e QUEBRADO nunca supera código completo e verificado.
 */

test("evaluateMinimality: nada introduzido -> pass, nada a avaliar", async () => {
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const r = evaluateMinimality({ introducesNewDependency: false, introducesNewAbstraction: false })
  assert.equal(r.verdict, "pass")
})

test("evaluateMinimality: dependência nova SEM motivo -> blocked", async () => {
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const r = evaluateMinimality({ introducesNewDependency: true, newDependencyReason: null, protectedConcerns: [] })
  assert.equal(r.verdict, "blocked")
  assert.equal(r.reason, "unexplained_new_dependency")
})

test("evaluateMinimality: dependência nova COM motivo real -> pass", async () => {
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const r = evaluateMinimality({ introducesNewDependency: true, newDependencyReason: "sem equivalente nativo/stdlib provado", protectedConcerns: [] })
  assert.equal(r.verdict, "pass")
})

test("CONTROLE NEGATIVO: qualquer protectedConcern -> SEMPRE exempt, mesmo sem motivo", async () => {
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  for (const concern of ["security", "validation", "tests", "accessibility", "observability", "explicit_user_scope"]) {
    const r = evaluateMinimality({ introducesNewDependency: true, newDependencyReason: null, protectedConcerns: [concern] })
    assert.equal(r.verdict, "exempt", `${concern} deve isentar mesmo sem motivo`)
    assert.match(r.reason, new RegExp(concern))
  }
})

test("evaluateMinimality: abstração nova quando reuse/stdlib comprovadamente disponível -> blocked", async () => {
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const r = evaluateMinimality({
    introducesNewAbstraction: true, existingReuse: true, platformOrStdlib: false,
    smallestCompleteApproach: false, protectedConcerns: [],
  })
  assert.equal(r.verdict, "blocked")
  assert.equal(r.reason, "existing_reuse_available")
})

test("evaluateMinimality: abstração nova, SEM reuse comprovado disponível -> pass (não há o que reusar)", async () => {
  const { evaluateMinimality } = await imp("src/skills/minimality.js")
  const r = evaluateMinimality({
    introducesNewAbstraction: true, existingReuse: false, platformOrStdlib: false,
    smallestCompleteApproach: true, protectedConcerns: [],
  })
  assert.equal(r.verdict, "pass")
})

test("CONTROLE NEGATIVO: diff/LOC pequeno NUNCA supera código verificado -- minimality nunca reescreve um veredito de correção", async () => {
  const { minimalityNeverOutranksCorrectness } = await imp("src/skills/minimality.js")
  // código pequeno mas com testes falhando: correção sempre vence, minimality nunca "resgata" o veredito
  assert.equal(minimalityNeverOutranksCorrectness({ correctnessVerdict: "failed", minimalityVerdict: "pass", diffSize: 3 }), "failed")
  assert.equal(minimalityNeverOutranksCorrectness({ correctnessVerdict: "passed", minimalityVerdict: "blocked", diffSize: 500 }), "passed", "minimality blocked não pode fingir que a correção falhou")
})

test("MINIMALITY_SCHEMA/DECISION_EVIDENCE_FIELDS: schema real, campos do DoD presentes", async () => {
  const { MINIMALITY_SCHEMA, DECISION_EVIDENCE_FIELDS, PROTECTED_CONCERNS } = await imp("src/skills/minimality-schema.js")
  assert.equal(MINIMALITY_SCHEMA, "gstack.minimality.v1")
  for (const f of ["necessary", "existingReuse", "platformOrStdlib", "installedDependency", "newDependencyReason", "smallestCompleteApproach", "protectedConcerns"]) {
    assert.ok(DECISION_EVIDENCE_FIELDS.includes(f), `campo ${f} do DoD ausente`)
  }
  assert.ok(PROTECTED_CONCERNS.includes("security"))
  assert.ok(PROTECTED_CONCERNS.includes("explicit_user_scope"))
})

test("buildMinimalityReviewItem: item de scorecard NÃO-P0 (advisory) -- nunca gera um P0 falso ainda", async () => {
  const { buildMinimalityReviewItem } = await imp("src/skills/minimality.js")
  const item = buildMinimalityReviewItem({ verdict: "blocked", reason: "unexplained_new_dependency" })
  assert.equal(item.id, "minimality")
  assert.equal(item.p0, false)
  assert.equal(item.status, "failed")
})

test("buildMinimalityReviewItem: exempt/pass -> status passed (nunca conta abstenção como falha)", async () => {
  const { buildMinimalityReviewItem } = await imp("src/skills/minimality.js")
  assert.equal(buildMinimalityReviewItem({ verdict: "pass" }).status, "passed")
  assert.equal(buildMinimalityReviewItem({ verdict: "exempt", reason: "protected_concern:security" }).status, "passed")
})
