import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const read = (rel) => readFileSync(path.join(root, rel), "utf-8")
const has = (rel) => existsSync(path.join(root, rel))

test("governance: SECURITY.md com política de report + postura de defesas", () => {
  assert.ok(has("SECURITY.md"))
  const s = read("SECURITY.md")
  assert.match(s, /Report a vulnerability|Reportar uma vulnerabilidade/i)
  assert.match(s, /Secrets Broker/) // referencia defesas reais
  assert.match(s, /AgentShield/)
})

test("governance: THREAT_MODEL mapeia ameaças → mitigações determinísticas", () => {
  assert.ok(has("THREAT_MODEL.md"))
  const t = read("THREAT_MODEL.md")
  for (const m of ["Prompt injection", "Exfiltração de segredo", "Challenge-Response", "VFA Provenance", "Supply chain"]) {
    assert.match(t, new RegExp(m), `threat model cobre: ${m}`)
  }
})

test("governance: CODEOWNERS, CONTRIBUTING e CodeQL workflow presentes", () => {
  assert.ok(has(".github/CODEOWNERS"), "CODEOWNERS")
  assert.ok(has("CONTRIBUTING.md"), "CONTRIBUTING")
  assert.ok(has(".github/workflows/codeql.yml"), "CodeQL workflow")
  assert.match(read(".github/workflows/codeql.yml"), /codeql-action\/analyze/)
})

test("governance: script SBOM (CycloneDX) declarado", () => {
  const pkg = JSON.parse(read("package.json"))
  assert.ok(pkg.scripts.sbom && /sbom/.test(pkg.scripts.sbom), "npm run sbom")
  assert.match(pkg.scripts.sbom, /cyclonedx/i)
})
