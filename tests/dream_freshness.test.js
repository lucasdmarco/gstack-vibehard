import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function promotedCandidate() {
  return {
    id: "lc_x", schemaVersion: "gstack.learning-candidate.v1", status: "promoted",
    scope: "project", classification: "skill", title: "t",
    source: { runId: "r1", chainHash: "h1", evidenceRefs: [] },
    validity: { status: "eligible", expiresAt: null, freshnessProbes: [] },
    procedure: { steps: [] }, deadEnds: [], secretRefs: [],
    dedupe: { signature: "sha256:x", matches: [], decision: "unknown" },
  }
}

test("evaluateFreshness: comando citado que sumiu -> stale", async () => {
  const { evaluateFreshness } = await imp("src/dream/freshness.js")
  const r = evaluateFreshness({ citedCommands: ["start", "ghostcmd"], existingCommands: ["start", "verify"] })
  assert.equal(r.stale, true)
  assert.deepEqual(r.staleCommands, ["ghostcmd"])
})

test("evaluateFreshness: todos os comandos citados ainda existem -> não stale", async () => {
  const { evaluateFreshness } = await imp("src/dream/freshness.js")
  const r = evaluateFreshness({ citedCommands: ["start", "verify"], existingCommands: ["start", "verify", "dev"] })
  assert.equal(r.stale, false)
  assert.deepEqual(r.staleCommands, [])
})

test("evaluateFreshness: source hash divergente (content mudou upstream) -> stale", async () => {
  const { evaluateFreshness } = await imp("src/dream/freshness.js")
  const { buildSourceLock } = await imp("src/skills/source-lock.js")
  const lock = buildSourceLock({ repository: "o/r", commit: "a".repeat(40), path: "skills/x", license: "MIT", artifactKind: "skill", originalContent: "v1" })
  const r = evaluateFreshness({ sourceLock: lock, currentContent: "v2 mudou" })
  assert.equal(r.stale, true)
  assert.equal(r.hashDrifted, true)
})

test("evaluateFreshness: nem comando nem hash mudaram -> fresh", async () => {
  const { evaluateFreshness } = await imp("src/dream/freshness.js")
  const { buildSourceLock } = await imp("src/skills/source-lock.js")
  const lock = buildSourceLock({ repository: "o/r", commit: "a".repeat(40), path: "skills/x", license: "MIT", artifactKind: "skill", originalContent: "v1" })
  const r = evaluateFreshness({ citedCommands: ["start"], existingCommands: ["start"], sourceLock: lock, currentContent: "v1" })
  assert.equal(r.stale, false)
})

test("isRoutable: eligible/proposed/promoted são roteáveis; stale/revoked/rejected NUNCA", async () => {
  const { isRoutable } = await imp("src/dream/freshness.js")
  for (const status of ["eligible", "proposed", "promoted"]) assert.equal(isRoutable({ status }), true, status)
  for (const status of ["stale", "revoked", "rejected", "observed", "tentative", "skipped", "blocked_secret"]) {
    assert.equal(isRoutable({ status }), false, status)
  }
})

test("markStale: só válido a partir de 'promoted' (segue a máquina de estados do S46.1)", async () => {
  const { markStale } = await imp("src/dream/freshness.js")
  const staled = markStale(promotedCandidate())
  assert.equal(staled.status, "stale")
  assert.equal(staled.source.runId, "r1", "provenance preservado")
})

test("markStale: item stale NUNCA é roteado (DoD)", async () => {
  const { markStale, isRoutable } = await imp("src/dream/freshness.js")
  const staled = markStale(promotedCandidate())
  assert.equal(isRoutable(staled), false)
})

test("revokeCandidate: preserva provenance (source/runId/chainHash intactos) e registra motivo", async () => {
  const { revokeCandidate } = await imp("src/dream/freshness.js")
  const c = promotedCandidate()
  const revoked = revokeCandidate(c, "comando referenciado foi removido")
  assert.equal(revoked.status, "revoked")
  assert.equal(revoked.source.runId, c.source.runId, "provenance preservado — nunca apagado")
  assert.equal(revoked.source.chainHash, c.source.chainHash)
  assert.equal(revoked.revokedReason, "comando referenciado foi removido")
  assert.ok(revoked.revokedAt)
})

test("revokeCandidate: NUNCA volta ao roteamento depois de revogado (fail-closed)", async () => {
  const { revokeCandidate, isRoutable } = await imp("src/dream/freshness.js")
  const revoked = revokeCandidate(promotedCandidate(), "x")
  assert.equal(isRoutable(revoked), false)
})

test("markStale/revokeCandidate: lançam se o candidate NÃO estiver promoted (sem salto de estado)", async () => {
  const { markStale, revokeCandidate } = await imp("src/dream/freshness.js")
  const eligible = { ...promotedCandidate(), status: "eligible" }
  assert.throws(() => markStale(eligible), /transição inválida/)
  assert.throws(() => revokeCandidate(eligible, "x"), /transição inválida/)
})

test("candidateCommandDrift (drift-doctor.js ampliado): comando citado no procedure que sumiu do CLI vira stale", async () => {
  const { candidateCommandDrift } = await imp("src/skills/drift-doctor.js")
  const c = { title: "algo", procedure: { steps: ["rode `gstack_vibehard start`", "depois `gstack_vibehard ghostcmd`"] } }
  const d = candidateCommandDrift(c)
  assert.ok(d.cited.includes("start"))
  assert.ok(d.cited.includes("ghostcmd"))
  assert.deepEqual(d.stale, ["ghostcmd"])
})

test("candidateCommandDrift: candidate sem procedure/steps não quebra (fail-safe)", async () => {
  const { candidateCommandDrift } = await imp("src/skills/drift-doctor.js")
  const d = candidateCommandDrift({ title: "sem passos" })
  assert.deepEqual(d.cited, [])
  assert.deepEqual(d.stale, [])
})

test("dream audit: claim dream-freshness existe e é NOT_PROVED em modo comportamental (honesto — sem CLI E2E de revoke ainda)", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const behavioral = audit({ root: repoRoot, behavioral: true })
  const claim = behavioral.claims.find((c) => c.id === "dream-freshness")
  assert.ok(claim, "claim registrada")
  assert.equal(claim.status, "NOT_PROVED")
  const filesOnly = audit({ root: repoRoot, behavioral: false })
  assert.equal(filesOnly.claims.find((c) => c.id === "dream-freshness").status, "REAL", "arquivo+CLI existem de verdade")
})
