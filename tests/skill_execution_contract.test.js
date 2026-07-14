import test from "node:test"
import assert from "node:assert/strict"
import {
  createExecutionContract, advanceExecution, recordApplied, verifyExecution,
  hashContent, enforcementFor, contractsForRoute, SKILL_EXECUTION_SCHEMA,
} from "../src/skills/execution-contract.js"

// PRD42 S42.3 — Skill Execution Contract. Provado: (1) ciclo selected→loaded→applied→verified;
// (2) MUTATION TEST: remover/alterar um deliverable após applied reprova o verify; (3) transição
// fora de ordem é fail-closed; (4) enforcement honesto (só real_hooks bloqueia); (5) contrato vazio
// NÃO é sucesso vazio.

test("ciclo feliz: selected→loaded→applied→verified com hash batendo", () => {
  const c = createExecutionContract({ skill: "frontend-design", deliverables: ["src/App.tsx"], harnessEnforcement: "real_hooks" })
  assert.equal(c.schemaVersion, SKILL_EXECUTION_SCHEMA)
  assert.equal(c.state, "selected")
  advanceExecution(c, "loaded")
  const h = hashContent("<App/>")
  recordApplied(c, { "src/App.tsx": h })
  assert.equal(c.state, "applied")
  verifyExecution(c, { "src/App.tsx": h })
  assert.equal(c.state, "verified")
  assert.equal(c.verification.ok, true)
})

test("MUTATION: deliverable ausente na verificação reprova (state=failed)", () => {
  const c = createExecutionContract({ skill: "frontend-design", deliverables: ["src/App.tsx"] })
  advanceExecution(c, "loaded")
  recordApplied(c, { "src/App.tsx": hashContent("<App/>") })
  verifyExecution(c, {}) // deliverable sumiu
  assert.equal(c.state, "failed")
  assert.equal(c.verification.ok, false)
  assert.match(c.verification.failures[0].reason, /ausente|mutation/i)
})

test("MUTATION: conteúdo alterado após applied reprova (hash diverge)", () => {
  const c = createExecutionContract({ skill: "x", deliverables: ["a.css"] })
  advanceExecution(c, "loaded")
  recordApplied(c, { "a.css": hashContent("body{}") })
  verifyExecution(c, { "a.css": hashContent("body{color:red}") })
  assert.equal(c.verification.ok, false)
  assert.match(c.verification.failures[0].reason, /alterado|diverge/i)
})

test("CONTROLE NEGATIVO: transição fora de ordem é fail-closed", () => {
  const c = createExecutionContract({ skill: "x", deliverables: ["a"] })
  assert.throws(() => advanceExecution(c, "verified"), /invalid_transition: selected -> verified/)
  assert.throws(() => advanceExecution(c, "applied"), /invalid_transition/)
})

test("CONTROLE NEGATIVO: contrato sem deliverables NÃO é sucesso vazio", () => {
  const c = createExecutionContract({ skill: "x", deliverables: [] })
  advanceExecution(c, "loaded")
  recordApplied(c, {})
  verifyExecution(c, {})
  assert.equal(c.verification.ok, false, "vazio não pode verificar como sucesso")
  assert.equal(c.verification.empty, true)
  assert.equal(c.state, "failed")
})

test("enforcement honesto: só real_hooks é enforced; resto advisory", () => {
  assert.equal(enforcementFor("real_hooks"), "enforced")
  for (const e of ["instructional", "rules_only", "partial", null, undefined]) assert.equal(enforcementFor(e), "advisory")
  assert.equal(createExecutionContract({ skill: "x", harnessEnforcement: "instructional" }).enforcement, "advisory")
})

test("contractsForRoute: um contrato por skill selecionada (estado selected)", () => {
  const route = { selectedSkills: ["frontend-design", "chronicle"] }
  const cs = contractsForRoute(route, { harnessEnforcement: "instructional" })
  assert.equal(cs.length, 2)
  assert.deepEqual(cs.map((c) => c.skill), ["frontend-design", "chronicle"])
  assert.ok(cs.every((c) => c.state === "selected" && c.enforcement === "advisory"))
  assert.deepEqual(contractsForRoute({}, {}), [], "rota sem skills → sem contratos")
})
