import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("hashDecision: mesma decisao produz sempre o mesmo hash (retomada estavel)", async () => {
  const { hashDecision } = await imp("src/project-plan/context-delta.js")
  const a = hashDecision({ id: "designDirection", value: "minimal-editorial" })
  const b = hashDecision({ id: "designDirection", value: "minimal-editorial" })
  assert.equal(a, b)
  assert.match(a, /^sha256:/)
})

test("hashDecision: valor diferente produz hash diferente", async () => {
  const { hashDecision } = await imp("src/project-plan/context-delta.js")
  const a = hashDecision({ id: "designDirection", value: "minimal-editorial" })
  const b = hashDecision({ id: "designDirection", value: "bold-vibrant" })
  assert.notEqual(a, b)
})

test("extractGotchas: le dead_end/remember do MESMO journal que o detector do PRD46 le (S46.2), sem duplicar formato", async () => {
  const { extractGotchas } = await imp("src/project-plan/context-delta.js")
  const events = [
    { event: "attempt_failed", attempt: 1 },
    { event: "dead_end", signature: "sig-1", reason: "porta ocupada" },
    { event: "remember", summary: "usar --force-port" },
    { event: "pipeline_ended", status: "done" },
  ]
  const gotchas = extractGotchas(events)
  assert.equal(gotchas.length, 2)
  assert.deepEqual(gotchas[0], { event: "dead_end", signature: "sig-1", reason: "porta ocupada" })
  assert.deepEqual(gotchas[1], { event: "remember", signature: null, reason: "usar --force-port" })
})

test("buildContextDelta: exclui arquivos .env* da lista de tocados (DoD: exclusao explicita)", async () => {
  const { buildContextDelta } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({ touchedFiles: ["src/index.js", ".env", ".env.production", "config/.env.local"] })
  assert.deepEqual(delta.touchedFiles, ["src/index.js"])
})

test("buildContextDelta: NUNCA aceita transcript bruto — lanca se o caller tentar injetar (DoD)", async () => {
  const { buildContextDelta } = await imp("src/project-plan/context-delta.js")
  assert.throws(() => buildContextDelta({ transcript: "conversa inteira aqui" }), /transcript/)
})

test("buildContextDelta: acumula aceites provados/falhos/pendentes a partir do compliance report real (S47.5), sem duplicar logica", async () => {
  const { buildContextDelta } = await imp("src/project-plan/context-delta.js")
  const { complianceReport } = await imp("src/project-plan/acceptance-verification.js")
  const acceptances = [
    { id: "a1", verifier: { kind: "command", ref: "npm test", files: ["src/x.js"] } },
    { id: "a2", pending_verifier: true },
    { id: "a3", verifier: { kind: "command", ref: "npm test", files: ["src/y.js"] } },
  ]
  const report = complianceReport({ acceptances, changedFiles: ["src/x.js", "src/y.js"], testResults: { a1: true, a3: false } })
  const delta = buildContextDelta({ complianceItems: report.items })
  assert.deepEqual(delta.acceptances.proved, ["a1"])
  assert.deepEqual(delta.acceptances.failed, ["a3"])
  assert.deepEqual(delta.acceptances.pending, ["a2"])
})

test("buildContextDelta: capacidades referenciadas por ID/hash, nunca o corpus integral da skill", async () => {
  const { buildContextDelta } = await imp("src/project-plan/context-delta.js")
  const capabilityPlan = { skills: ["skill-a", "skill-b"], gates: ["design-system-gate"] }
  const capabilityLocks = [{ id: "lock-1", artifactKind: "skill", hash: "sha256:abc" }]
  const delta = buildContextDelta({ capabilityPlan, capabilityLocks })
  assert.deepEqual(delta.capabilities.skills, ["skill-a", "skill-b"])
  assert.deepEqual(delta.capabilities.gates, ["design-system-gate"])
  assert.deepEqual(delta.capabilities.locks, [{ id: "lock-1", artifactKind: "skill", hash: "sha256:abc" }])
  assert.equal(JSON.stringify(delta).includes("corpus"), false)
})

test("validateContextDelta: rejeita se algum campo carregar VALOR de segredo (fail-closed, mesma disciplina do candidate.js)", async () => {
  const { buildContextDelta, validateContextDelta } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({ diagnosis: { code: "auth_fail", summary: 'token="totally-fake-example-secret-000" falhou' } })
  const r = validateContextDelta(delta)
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(" "), /segredo/)
})

test("validateContextDelta: delta limpo passa", async () => {
  const { buildContextDelta, validateContextDelta } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({ brief: { objective: "SaaS com login", mode: "delivery" } })
  const r = validateContextDelta(delta)
  assert.equal(r.ok, true)
  assert.deepEqual(r.reasons, [])
})

test("resolveContextDeltaLoad: grafo fresh -> reuse (retomar nao exige reler o repo, DoD)", async () => {
  const { buildContextDelta, resolveContextDeltaLoad } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({})
  const r = resolveContextDeltaLoad(delta, { graphState: "fresh" })
  assert.equal(r.action, "reuse")
})

test("resolveContextDeltaLoad: grafo stale -> regenerate, NUNCA reuso silencioso de texto velho (DoD)", async () => {
  const { buildContextDelta, resolveContextDeltaLoad } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({})
  const r = resolveContextDeltaLoad(delta, { graphState: "stale" })
  assert.equal(r.action, "regenerate")
})

test("resolveContextDeltaLoad: lock de capacidade revogado/hash divergente -> block (bloqueia paralelismo, DoD)", async () => {
  const { buildContextDelta, resolveContextDeltaLoad } = await imp("src/project-plan/context-delta.js")
  const capabilityPlan = { skills: [], gates: [] }
  const capabilityLocks = [{ id: "lock-1", artifactKind: "skill", hash: "sha256:abc" }]
  const delta = buildContextDelta({ capabilityPlan, capabilityLocks })
  const sourceLocks = [{ id: "lock-1", status: "revoked", artifactKind: "skill", hash: "sha256:abc" }]
  const r = resolveContextDeltaLoad(delta, { graphState: "fresh", sourceLocks })
  assert.equal(r.action, "block")
  assert.equal(r.blockedCapabilities.length, 1)
  assert.equal(r.blockedCapabilities[0].id, "lock-1")
})

test("resolveContextDeltaLoad: sem capacidades referenciadas e grafo fresh -> nunca bloqueia por engano", async () => {
  const { buildContextDelta, resolveContextDeltaLoad } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({})
  const r = resolveContextDeltaLoad(delta, { graphState: "fresh", sourceLocks: [] })
  assert.equal(r.action, "reuse")
  assert.deepEqual(r.blockedCapabilities, [])
})

test("economia de retomada permanece 'estimated' sem telemetria medida (reusa handoff.js, S42.10, sem duplicar)", async () => {
  const { buildContextDelta } = await imp("src/project-plan/context-delta.js")
  const { resumeBenchmark } = await imp("src/project-plan/handoff.js")
  const delta = buildContextDelta({ brief: { objective: "SaaS com login", mode: "delivery" } })
  const bench = resumeBenchmark({ handoffText: JSON.stringify(delta), fullText: "x".repeat(50000) })
  assert.equal(bench.handoffTokens.source, "estimated")
  assert.equal(bench.savings.source, "estimated")
})
