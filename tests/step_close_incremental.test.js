import test from "node:test"
import assert from "node:assert/strict"
import { surfaceOf, classifySurface } from "../src/project-plan/change-surface.js"
import { runStepClose, STEP_CLOSE_SCHEMA } from "../src/project-plan/step-close.js"

// PRD42 S42.7 — Step-close incremental. INVARIANTE central: uma edição NUNCA roda a suíte inteira
// (ranFullSuite sempre false). Superfícies de risco gateiam; runner ausente ≠ pass; runner falho reprova.

test("surfaceOf: mapeia caminho → superfície; fallback other", () => {
  assert.equal(surfaceOf("src/runtime/manifest.js"), "runtime")
  assert.equal(surfaceOf("migrations/001_init.sql"), "migrations")
  assert.equal(surfaceOf("src/components/Button.tsx"), "frontend")
  assert.equal(surfaceOf("README.md"), "docs")
  assert.equal(surfaceOf("src/services/auth.js"), "backend")
  assert.equal(surfaceOf("weird.bin"), "other")
})

test("classifySurface: superfície de risco gateia; docs-only não", () => {
  const risky = classifySurface(["src/runtime/manifest.js", "README.md"])
  assert.equal(risky.blocking, true, "runtime gateia")
  assert.equal(risky.primary, "runtime")
  const docsOnly = classifySurface(["README.md", "CHANGELOG.md"])
  assert.equal(docsOnly.blocking, false, "docs-only não gateia release")
})

test("INVARIANTE: step-close NUNCA roda a suíte inteira (mesmo diff enorme)", () => {
  const huge = Array.from({ length: 500 }, (_, i) => `src/mod${i}.js`)
  const r = runStepClose(huge, {})
  assert.equal(r.schema, STEP_CLOSE_SCHEMA)
  assert.equal(r.ranFullSuite, false, "edição nunca dispara a suíte inteira")
})

test("runner ausente → skipped (NÃO conta como pass)", () => {
  const r = runStepClose(["src/api/handler.js"], {}) // sem runners
  assert.ok(r.checks.length > 0)
  assert.ok(r.checks.every((c) => c.status === "skipped"))
  assert.equal(r.ok, true, "skipped não é failed (mas também não é pass forjado)")
  assert.ok(r.checks.every((c) => c.detail.includes("não conta como pass")))
})

test("CONTROLE NEGATIVO: runner que falha reprova o step-close", () => {
  const r = runStepClose(["src/api/handler.js"], {
    "incremental-tests": () => ({ ok: false, detail: "2 testes vermelhos" }),
    typecheck: () => ({ ok: true }),
  })
  assert.equal(r.ok, false)
  assert.ok(r.failed.includes("incremental-tests"))
  assert.equal(r.ranFullSuite, false)
})

test("runner que lança vira failed (não trava o step-close)", () => {
  const r = runStepClose(["src/x.js"], { "incremental-tests": () => { throw new Error("boom") } })
  const inc = r.checks.find((c) => c.name === "incremental-tests")
  assert.equal(inc.status, "failed")
  assert.match(inc.detail, /boom/)
})

test("checks incrementais selecionados pelo tipo do diff (frontend → visual-evidence)", () => {
  const r = runStepClose(["src/components/Nav.tsx"], {})
  assert.ok(r.checks.some((c) => c.name === "visual-evidence"), "frontend pede evidência visual")
})
