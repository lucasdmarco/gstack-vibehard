import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("normalizeName + triggerTokens: determinístico, sem modelo remoto/embedding", async () => {
  const { normalizeName, triggerTokens } = await imp("src/dream/dedupe.js")
  assert.equal(normalizeName("  Fix Flaky Test!!  "), "fix flaky test")
  const t = triggerTokens("Resolver retry no deploy do Docker")
  assert.ok(t.has("resolver"))
  assert.ok(t.has("deploy"))
  assert.ok(!t.has("no"), "stopword curta removida")
})

test("tokenOverlap: Jaccard determinístico, 0 quando disjuntos, 1 quando idênticos", async () => {
  const { triggerTokens, tokenOverlap } = await imp("src/dream/dedupe.js")
  const a = triggerTokens("resolver retry docker deploy")
  const b = triggerTokens("resolver retry docker deploy")
  const c = triggerTokens("outra coisa completamente diferente")
  assert.equal(tokenOverlap(a, b), 1)
  assert.equal(tokenOverlap(a, c), 0)
})

const mkCandidate = (over = {}) => ({
  id: over.id || "lc_aaaa",
  title: over.title || "Resolver retry no deploy",
  failurePattern: over.failurePattern || null,
  dedupe: { signature: over.signature || "sha256:xxx", matches: [], decision: "unknown" },
})

test("classifyDedupe: assinatura IDÊNTICA a um existente -> update (candidato equivalente atualiza)", async () => {
  const { classifyDedupe } = await imp("src/dream/dedupe.js")
  const existing = [mkCandidate({ id: "lc_old", signature: "sha256:same" })]
  const candidate = mkCandidate({ signature: "sha256:same" })
  const r = classifyDedupe({ candidate, existing })
  assert.equal(r.decision, "update")
  assert.equal(r.matchId, "lc_old")
})

test("classifyDedupe: mesmo failurePattern.id (mas conteúdo diferente) -> merge (propõe fusão)", async () => {
  const { classifyDedupe } = await imp("src/dream/dedupe.js")
  const existing = [mkCandidate({ id: "lc_old", signature: "sha256:different", failurePattern: { id: "fp-1" } })]
  const candidate = mkCandidate({ signature: "sha256:another", failurePattern: { id: "fp-1" } })
  const r = classifyDedupe({ candidate, existing })
  assert.equal(r.decision, "merge")
  assert.equal(r.matchId, "lc_old")
})

test("classifyDedupe: título muito similar (token overlap alto) -> merge mesmo sem mesmo failure id", async () => {
  const { classifyDedupe } = await imp("src/dream/dedupe.js")
  const existing = [mkCandidate({ id: "lc_old", signature: "sha256:x1", title: "Resolver retry no deploy do Docker" })]
  const candidate = mkCandidate({ signature: "sha256:x2", title: "Resolver retry no deploy do Docker em prod" })
  const r = classifyDedupe({ candidate, existing })
  assert.equal(r.decision, "merge")
})

test("classifyDedupe: nada parecido -> new (nunca duplica sem necessidade, mas também nunca funde à força)", async () => {
  const { classifyDedupe } = await imp("src/dream/dedupe.js")
  const existing = [mkCandidate({ id: "lc_old", signature: "sha256:x1", title: "Configurar CI do zero" })]
  const candidate = mkCandidate({ signature: "sha256:x2", title: "Migrar banco de dados para Postgres" })
  const r = classifyDedupe({ candidate, existing })
  assert.equal(r.decision, "new")
  assert.equal(r.matchId, null)
})

test("classifyDedupe: catálogo vazio -> sempre new", async () => {
  const { classifyDedupe } = await imp("src/dream/dedupe.js")
  const r = classifyDedupe({ candidate: mkCandidate(), existing: [] })
  assert.equal(r.decision, "new")
})
