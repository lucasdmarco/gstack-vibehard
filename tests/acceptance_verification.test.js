import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("mapJourney: método desconhecido lança (só playwright/api/command/schema)", async () => {
  const { mapJourney } = await imp("src/project-plan/acceptance-verification.js")
  assert.throws(() => mapJourney({ acceptanceId: "x", method: "vibes", ref: "y" }), /método de jornada desconhecido/)
})

test("mapJourney: monta a jornada com os 4 métodos válidos", async () => {
  const { mapJourney, JOURNEY_METHODS } = await imp("src/project-plan/acceptance-verification.js")
  for (const method of JOURNEY_METHODS) {
    const j = mapJourney({ acceptanceId: "login", method, ref: "tests/e2e/login.spec.js" })
    assert.equal(j.method, method)
  }
})

test("resolvePendingVerifier: SEM journey mapeada -> continua pending (DoD: nunca funcional por decreto)", async () => {
  const { resolvePendingVerifier } = await imp("src/project-plan/acceptance-verification.js")
  const acceptance = { id: "feature-behavior", pending_verifier: { reason: "sem verificador automatizado" } }
  const r = resolvePendingVerifier(acceptance, [])
  assert.ok(r.pending_verifier, "sem journey, continua pending")
  assert.equal(r.verifier, undefined)
})

test("resolvePendingVerifier: COM journey real mapeada -> vira verifier de verdade", async () => {
  const { resolvePendingVerifier, mapJourney } = await imp("src/project-plan/acceptance-verification.js")
  const acceptance = { id: "login-flow", pending_verifier: { reason: "sem verificador automatizado" } }
  const journey = mapJourney({ acceptanceId: "login-flow", method: "playwright", ref: "tests/e2e/login.spec.js", files: ["src/auth/login.js"] })
  const r = resolvePendingVerifier(acceptance, [journey])
  assert.equal(r.pending_verifier, undefined, "pending_verifier sai quando há engine real")
  assert.deepEqual(r.verifier, { kind: "playwright", ref: "tests/e2e/login.spec.js", files: ["src/auth/login.js"] })
})

test("resolvePendingVerifier: aceite SEM pending_verifier (já tem verifier real) passa intacto", async () => {
  const { resolvePendingVerifier } = await imp("src/project-plan/acceptance-verification.js")
  const acceptance = { id: "lint", verifier: { kind: "gate", ref: "lint" } }
  assert.deepEqual(resolvePendingVerifier(acceptance, []), acceptance)
})

test("checkCompliance: aceite ainda pending -> status 'pending' (nunca finge compliant)", async () => {
  const { checkCompliance } = await imp("src/project-plan/acceptance-verification.js")
  const r = checkCompliance({ acceptance: { id: "x", pending_verifier: { reason: "y" } } })
  assert.equal(r.status, "pending")
})

test("checkCompliance: verifier real mas diff NÃO tocou arquivos relevantes -> unverified", async () => {
  const { checkCompliance } = await imp("src/project-plan/acceptance-verification.js")
  const acceptance = { id: "login-flow", verifier: { kind: "playwright", ref: "x", files: ["src/auth/login.js"] } }
  const r = checkCompliance({ acceptance, changedFiles: ["src/outro-arquivo.js"] })
  assert.equal(r.status, "unverified")
  assert.match(r.reason, /não tocou/)
})

test("checkCompliance: diff tocou os arquivos MAS sem resultado de teste correspondente -> unverified (nunca presume ok)", async () => {
  const { checkCompliance } = await imp("src/project-plan/acceptance-verification.js")
  const acceptance = { id: "login-flow", verifier: { kind: "playwright", ref: "x", files: ["src/auth/login.js"] } }
  const r = checkCompliance({ acceptance, changedFiles: ["src/auth/login.js"], testResults: {} })
  assert.equal(r.status, "unverified")
})

test("checkCompliance: diff tocou + teste passou -> compliant DE VERDADE", async () => {
  const { checkCompliance } = await imp("src/project-plan/acceptance-verification.js")
  const acceptance = { id: "login-flow", verifier: { kind: "playwright", ref: "x", files: ["src/auth/login.js"] } }
  const r = checkCompliance({ acceptance, changedFiles: ["src/auth/login.js"], testResults: { "login-flow": true } })
  assert.equal(r.status, "compliant")
})

test("checkCompliance: teste correspondente FALHOU -> failed, nunca compliant", async () => {
  const { checkCompliance } = await imp("src/project-plan/acceptance-verification.js")
  const acceptance = { id: "login-flow", verifier: { kind: "playwright", ref: "x", files: ["src/auth/login.js"] } }
  const r = checkCompliance({ acceptance, changedFiles: ["src/auth/login.js"], testResults: { "login-flow": false } })
  assert.equal(r.status, "failed")
})

test("complianceReport: 'produto completo' (allCompliant) SÓ quando TODO aceite é compliant — um pending já derruba (DoD)", async () => {
  const { complianceReport } = await imp("src/project-plan/acceptance-verification.js")
  const acceptances = [
    { id: "lint", verifier: { kind: "gate", ref: "lint" } },
    { id: "login-flow", verifier: { kind: "playwright", ref: "x", files: ["a.js"] } },
    { id: "payment-flow", pending_verifier: { reason: "sem engine" } }, // pagamento SEM verifier real
  ]
  const r = complianceReport({ acceptances, changedFiles: ["a.js"], testResults: { lint: true, "login-flow": true } })
  assert.equal(r.allCompliant, false, "payment-flow pending derruba o produto inteiro — nunca declarado completo")
})

test("integração real: artifact-review.js — reviewer NUNCA aprova o próprio artefato (reuso do PRD42 S42.5, não duplicado)", async () => {
  const { validateReview } = await imp("src/project-plan/artifact-review.js")
  const r = validateReview({ stage: "spec", producer: "agent-a", reviewer: "agent-a" })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /não pode revisar o próprio/.test(e)))
})
