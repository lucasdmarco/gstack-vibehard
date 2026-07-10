import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("gateEvent: fallback ship → 'ship', o resto → 'pre-write'", async () => {
  const { gateEvent } = await imp("src/skills/harness-projection.js")
  assert.equal(gateEvent({ fallback: "block_before_ship" }), "ship")
  assert.equal(gateEvent({ fallback: "block_before_delegate" }), "ship")
  assert.equal(gateEvent({ fallback: "block_before_write" }), "pre-write")
  assert.equal(gateEvent({ fallback: "warn_and_log" }), "pre-write")
})

// io injetado: a "prova" citada existe e contém o nome do teste negativo
const provedIo = { readTest: () => "conteudo com: teste negativo prova o bloqueio" }
const provedRef = { test: "tests/fake.test.js", name: "teste negativo prova o bloqueio" }

test("projectGate (PRD36): enforced SÓ com impl+bloqueio+prova; declarado-apenas NUNCA é enforced", async () => {
  const { projectGate } = await imp("src/skills/harness-projection.js")
  const advisory = { id: "a", mode: "advisory", fallback: "warn_and_log" }
  const preWriteProved = { id: "b", mode: "blocking", fallback: "block_before_write", implementedBy: "src/x.js", provedBy: provedRef }
  const preWriteDeclared = { id: "b2", mode: "blocking", fallback: "block_before_write" }
  const shipProved = { id: "c", mode: "blocking", fallback: "block_before_ship", implementedBy: "src/y.js", provedBy: provedRef }
  const shipDeclared = { id: "c2", mode: "blocking", fallback: "block_before_ship" }

  assert.equal(projectGate(advisory, "claude"), "advisory")
  assert.equal(projectGate(advisory, "codex"), "advisory")

  // pre-write provado: só claude (hook file.write enforced) impõe; codex/opencode advisory
  assert.equal(projectGate(preWriteProved, "claude", provedIo), "enforced")
  assert.equal(projectGate(preWriteProved, "codex", provedIo), "advisory")
  assert.equal(projectGate(preWriteProved, "opencode", provedIo), "advisory")

  // o claim antigo morreu: blocking pre-write SEM impl+prova não é enforced nem no claude
  assert.equal(projectGate(preWriteDeclared, "claude"), "advisory")

  // ship provado: CLI nega em qualquer harness → enforced em todos
  assert.equal(projectGate(shipProved, "claude", provedIo), "enforced")
  assert.equal(projectGate(shipProved, "codex", provedIo), "enforced")

  // ship declarado-apenas (sem implementação): advisory — não finge
  assert.equal(projectGate(shipDeclared, "codex"), "advisory")

  // harness desconhecido → unsupported
  assert.equal(projectGate(shipProved, "windsurf", provedIo), "unsupported")
})

test("buildHarnessProjection: matriz por harness com schema, event e level", async () => {
  const { buildHarnessProjection, HARNESS_GATE_PROJECTION_SCHEMA, KNOWN_HARNESSES } = await imp("src/skills/harness-projection.js")
  const gates = [
    { id: "secret-deny-gate", mode: "blocking", fallback: "block_always", implementedBy: "src/s.js", provedBy: provedRef },
    { id: "verify-proof-gate", mode: "blocking", fallback: "block_before_ship", implementedBy: "src/p.js", provedBy: provedRef },
    { id: "skill-route-gate", mode: "advisory", fallback: "warn_and_log" },
  ]
  const p = buildHarnessProjection(gates, undefined, provedIo)
  assert.equal(p.schemaVersion, HARNESS_GATE_PROJECTION_SCHEMA)
  assert.deepEqual(p.harnesses, [...KNOWN_HARNESSES])
  // claude impõe os dois blocking; codex só o ship
  const claude = p.matrix.claude
  assert.equal(claude.find((r) => r.gate === "secret-deny-gate").level, "enforced")
  assert.equal(claude.find((r) => r.gate === "verify-proof-gate").level, "enforced")
  const codex = p.matrix.codex
  assert.equal(codex.find((r) => r.gate === "secret-deny-gate").level, "advisory")
  assert.equal(codex.find((r) => r.gate === "verify-proof-gate").level, "enforced")
  assert.equal(codex.find((r) => r.gate === "skill-route-gate").level, "advisory")
})

test("projectionSummary: conta níveis por harness", async () => {
  const { buildHarnessProjection, projectionSummary } = await imp("src/skills/harness-projection.js")
  const gates = [
    { id: "g1", mode: "blocking", fallback: "block_before_write", implementedBy: "src/g1.js", provedBy: provedRef },
    { id: "g2", mode: "blocking", fallback: "block_before_ship", implementedBy: "src/g2.js", provedBy: provedRef },
    { id: "g3", mode: "advisory", fallback: "warn_and_log" },
  ]
  const s = projectionSummary(buildHarnessProjection(gates, ["claude", "codex"], provedIo))
  assert.deepEqual(s.claude, { enforced: 2, advisory: 1, unsupported: 0 })
  assert.deepEqual(s.codex, { enforced: 1, advisory: 2, unsupported: 0 })
})

test("skills harness (real): projeta os SKILL_GATES do repo e escreve .gstack/skills", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await skillsCommand(["harness", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.harness-gate-projection.v1")
  assert.ok(parsed.matrix.claude.length >= 12, `esperado ≥12 gates, veio ${parsed.matrix.claude.length}`)
  // honestidade: o pre-write secret-deny é enforced no claude, advisory no codex
  const cl = parsed.matrix.claude.find((r) => r.gate === "secret-deny-gate")
  const cx = parsed.matrix.codex.find((r) => r.gate === "secret-deny-gate")
  assert.equal(cl.level, "enforced")
  assert.equal(cx.level, "advisory")
})
