import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("stableCandidateId: mesmos receipts (runId+chainHash) produzem SEMPRE o mesmo id", async () => {
  const { stableCandidateId } = await imp("src/dream/candidate.js")
  const a = stableCandidateId({ runId: "run-1", chainHash: "sha256:aaa" })
  const b = stableCandidateId({ runId: "run-1", chainHash: "sha256:aaa" })
  const c = stableCandidateId({ runId: "run-2", chainHash: "sha256:aaa" })
  assert.match(a, /^lc_[0-9a-f]{16}$/)
  assert.equal(a, b, "mesmo input -> mesmo id")
  assert.notEqual(a, c, "input diferente -> id diferente")
})

test("candidateSignature: determinística e normaliza título/passos p/ dedupe estável", async () => {
  const { candidateSignature } = await imp("src/dream/candidate.js")
  const base = { title: "Fix Flaky Test", failurePattern: { id: "fp1" }, procedure: { steps: ["Do X", "Do Y"] } }
  const s1 = candidateSignature(base)
  const s2 = candidateSignature({ title: "  fix flaky test  ", failurePattern: { id: "fp1" }, procedure: { steps: ["do x", "DO Y"] } })
  assert.match(s1, /^sha256:[0-9a-f]{64}$/)
  assert.equal(s1, s2, "normalização (case/espaço) produz a MESMA assinatura")
})

test("CANDIDATE_TRANSITIONS: só as arestas do §7.2 são permitidas — nenhum salto", async () => {
  const { canTransition } = await imp("src/dream/candidate.js")
  assert.equal(canTransition("observed", "eligible"), true)
  assert.equal(canTransition("observed", "tentative"), true)
  assert.equal(canTransition("observed", "skipped"), true)
  assert.equal(canTransition("eligible", "proposed"), true)
  assert.equal(canTransition("proposed", "promoted"), true)
  assert.equal(canTransition("promoted", "revoked"), true)
  // saltos proibidos
  assert.equal(canTransition("observed", "promoted"), false, "observed não pode pular direto pra promoted")
  assert.equal(canTransition("tentative", "promoted"), false)
  assert.equal(canTransition("revoked", "promoted"), false, "revoked é terminal — nunca volta ao roteamento")
})

test("transition: aplica só arestas válidas; lança em salto inválido", async () => {
  const { buildCandidate, transition } = await imp("src/dream/candidate.js")
  const c = buildCandidate({ runId: "r1", chainHash: "sha256:x", title: "algo" })
  assert.equal(c.status, "observed")
  const next = transition(c, "eligible")
  assert.equal(next.status, "eligible")
  assert.equal(c.status, "observed", "transition NUNCA muta o candidate original")
  assert.throws(() => transition(c, "promoted"), /transição inválida/)
})

test("validateCandidate: candidate fora de bounds (steps demais) -> invalid", async () => {
  const { buildCandidate, validateCandidate } = await imp("src/dream/candidate.js")
  const tooMany = Array.from({ length: 50 }, (_, i) => `passo ${i}`)
  const c = buildCandidate({ runId: "r1", chainHash: "sha256:x", title: "t", procedure: { steps: tooMany } })
  const v = validateCandidate(c)
  assert.equal(v.ok, false)
  assert.ok(v.reasons.some((r) => /steps/.test(r)))
})

test("validateCandidate: NENHUM campo aceita valor de segredo (nested/array) — bloqueia, não só mascara", async () => {
  const { validateCandidate, CANDIDATE_SCHEMA } = await imp("src/dream/candidate.js")
  const withSecretNested = {
    schemaVersion: CANDIDATE_SCHEMA,
    id: "lc_0000000000000000",
    createdAt: new Date().toISOString(),
    source: { runId: "r1", chainHash: "h", head: "a", harness: "claude", evidenceRefs: ["e1"] },
    scope: "project",
    classification: "memory",
    title: "ok",
    failurePattern: { id: "fp", summary: "ok" },
    procedure: { steps: ['passo com auth_token="totally-fake-example-secret-000" embutido'], verification: [] },
    passingCheck: { name: "test", exitCode: 0, receiptHash: "sha256:aa" },
    deadEnds: [],
    secretRefs: [],
    dedupe: { signature: "sha256:aa", matches: [], decision: "unknown" },
    validity: { status: "tentative", expiresAt: null, freshnessProbes: [] },
    status: "observed",
  }
  const v = validateCandidate(withSecretNested)
  assert.equal(v.ok, false)
  assert.ok(v.reasons.some((r) => /segredo/i.test(r)))
})

test("validateCandidate: secretRefs deve referenciar NOME de env var, nunca o valor", async () => {
  const { buildCandidate, validateCandidate } = await imp("src/dream/candidate.js")
  const c = buildCandidate({ runId: "r1", chainHash: "sha256:x", title: "t", secretRefs: ["not a valid ref value!!"] })
  const v = validateCandidate(c)
  assert.equal(v.ok, false)
  assert.ok(v.reasons.some((r) => /secretRefs/.test(r)))
})

test("buildCandidate: redige segredo do procedure/failurePattern/deadEnds ao construir", async () => {
  const { buildCandidate } = await imp("src/dream/candidate.js")
  const c = buildCandidate({
    runId: "r1", chainHash: "sha256:x", title: "t",
    procedure: { steps: ["usar api_key=\"abcdefghijklmnop\" no header"] },
    failurePattern: { id: "fp", summary: "token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa vazou" },
    deadEnds: [{ signature: "d1", reason: "tentou com password=\"segredo12\" e falhou" }],
  })
  const blob = JSON.stringify(c)
  assert.doesNotMatch(blob, /abcdefghijklmnop/)
  assert.doesNotMatch(blob, /ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/)
  assert.doesNotMatch(blob, /segredo12/)
  assert.match(blob, /REDACTED/)
})
