import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

// PRD36 36.10 — documentação pública empacotada no npm. As guias públicas
// (first-run/examples/skill-gates/...) precisam entrar no tarball: sem isso, o
// usuário que instala não recebe a doc que a própria CLI referencia.

const repoRoot = path.resolve(import.meta.dirname, "..")
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))

test("package.json files inclui docs/guides/ (doc pública vai ao npm)", () => {
  assert.ok(pkg.files.includes("docs/guides/"), "docs/guides/ deve estar em files")
})

test("as guias públicas referenciadas existem no repo (não é entrada morta)", () => {
  for (const g of ["first-run.md", "examples.md", "skill-gates.md", "quickstart.md"]) {
    assert.ok(existsSync(path.join(repoRoot, "docs", "guides", g)), `docs/guides/${g} ausente`)
  }
})
