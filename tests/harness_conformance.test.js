import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("relatório real: nenhuma violação — a declaração é coerente com a matrix", async () => {
  const { buildConformanceReport } = await imp("src/harness/conformance.js")
  const r = buildConformanceReport()
  assert.equal(r.ok, true, `esperado 0 violações, veio: ${JSON.stringify(Object.entries(r.harnesses).filter(([, v]) => v.violations.length))}`)
  assert.equal(r.totalViolations, 0)
  assert.equal(r.schemaVersion, "gstack.conformance.v1")
})

test("cobre Claude/Cursor/OpenCode/Codex/Devin + um instrucional, com enforcement distinto", async () => {
  const { buildConformanceReport } = await imp("src/harness/conformance.js")
  const { harnesses } = buildConformanceReport()
  for (const h of ["claude", "cursor", "opencode", "codex", "devin", "gemini"]) {
    assert.ok(harnesses[h], `harness ${h} no relatório`)
    assert.equal(harnesses[h].declared, true)
  }
  // real_hooks pode ter enforced; instrucional JAMAIS
  assert.ok(harnesses.claude.enforcedEvents.length > 0, "claude (real_hooks) tem eventos enforced")
  assert.equal(harnesses.gemini.enforcedEvents.length, 0, "gemini instrucional sem enforced")
  assert.equal(harnesses.gemini.enforcement, "instructional")
})

test("forbidden_claim: harness instrucional declarando enforced é violação", async () => {
  const { checkDeclaration } = await imp("src/harness/conformance.js")
  const { EVENTS } = await imp("src/harness/events.js")
  const decl = { target: "x", residualRisk: "y", events: {} }
  for (const e of EVENTS) decl.events[e] = "advisory"
  decl.events["tool.before"] = "enforced" // mentira: gemini é instrucional
  const v = checkDeclaration("gemini", decl)
  assert.ok(v.some((x) => x.kind === "forbidden_claim" && x.event === "tool.before"), "deve acusar forbidden_claim")
})

test("forbidden_claim: exceder o teto do enforcement da matrix", async () => {
  const { checkDeclaration } = await imp("src/harness/conformance.js")
  const { EVENTS } = await imp("src/harness/events.js")
  // cursor é rules_only → teto = partial; declarar enforced é claim proibida
  const decl = { target: "x", residualRisk: "y", events: {} }
  for (const e of EVENTS) decl.events[e] = "advisory"
  decl.events["command.exec"] = "enforced"
  const v = checkDeclaration("cursor", decl)
  assert.ok(v.some((x) => x.kind === "forbidden_claim" && x.event === "command.exec"))
})

test("missing_event: evento do contrato ausente é drift", async () => {
  const { checkDeclaration } = await imp("src/harness/conformance.js")
  const decl = { target: "x", residualRisk: "y", events: { "session.start": "advisory" } }
  const v = checkDeclaration("claude", decl)
  assert.ok(v.some((x) => x.kind === "missing_event"), "faltando eventos = drift")
  // pelo menos 7 dos 8 eventos ausentes
  assert.ok(v.filter((x) => x.kind === "missing_event").length >= 7)
})

test("invalid_level: nível fora do vocabulário é drift", async () => {
  const { checkDeclaration } = await imp("src/harness/conformance.js")
  const { EVENTS } = await imp("src/harness/events.js")
  const decl = { target: "x", residualRisk: "y", events: {} }
  for (const e of EVENTS) decl.events[e] = "advisory"
  decl.events["file.write"] = "zero-trust" // vocabulário inexistente
  const v = checkDeclaration("claude", decl)
  assert.ok(v.some((x) => x.kind === "invalid_level" && x.event === "file.write"))
})
