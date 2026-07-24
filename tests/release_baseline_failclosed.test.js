import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.0C — baseline FAIL-CLOSED. O usuário achou 4 fail-opens no builder da
 * S51.0B: cada uma tratava AUSÊNCIA de evidência como aprovação. Aqui os controles
 * negativos que provam o fechamento — o builder nunca autoriza por omissão.
 */

const HEAD = "abc1234"
const proofAt = (commit = HEAD, ready = true) => ({ ready, commit })

// ---------- fail-open 1: programa vazio não é "completo" ----------
test("CONTROLE NEGATIVO (fail-open 1): programItems VAZIO NÃO é programComplete", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: HEAD, proof: proofAt(), programItems: [], flake: { runs: 30, failures: 0 } })
  assert.equal(b.programComplete, false, "lista vazia = ausência de evidência, nunca 'completo'")
})

test("programComplete só com itens declarados E todos fechados", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: HEAD, proof: proofAt(), programItems: [{ id: "x", status: "delivered" }], flake: { runs: 30, failures: 0 } })
  assert.equal(b.programComplete, true, "1 item entregue e nada aberto -> completo")
})

// ---------- fail-open 2 + 3: validação humana ausente e desacoplamento ----------
test("CONTROLE NEGATIVO (fail-open 2): humanValidation AUSENTE NÃO é fullyValidated", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: HEAD, proof: proofAt(), programItems: [{ id: "x", status: "delivered" }], flake: { runs: 30, failures: 0 } })
  assert.equal(b.fullyValidated, false, "sem registro de validação humana -> NÃO validado (não 'zero pendências')")
})

test("fullyValidated exige performed:true E zero pendências", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const semPerformed = buildReleaseBaseline({ commit: HEAD, proof: proofAt(), programItems: [{ id: "x", status: "delivered" }], flake: { runs: 30, failures: 0 }, humanValidation: { pending: 0 } })
  assert.equal(semPerformed.fullyValidated, false, "pending:0 por omissão de performed não vale")
  const ok = buildReleaseBaseline({ commit: HEAD, proof: proofAt(), programItems: [{ id: "x", status: "delivered" }], flake: { runs: 30, failures: 0 }, humanValidation: { performed: true, pending: 0 } })
  assert.equal(ok.fullyValidated, true, "validação declarada e sem pendência -> validado")
})

test("CONTROLE NEGATIVO (fail-open 3): fullyValidated é INDEPENDENTE de operationallyProven", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  // validação humana feita, MAS runtime não provado operacionalmente (flake baixo):
  const b = buildReleaseBaseline({ commit: HEAD, proof: proofAt(), programItems: [{ id: "x", status: "delivered" }], flake: { runs: 1, failures: 0 }, humanValidation: { performed: true, pending: 0 } })
  assert.equal(b.operationallyProven, false, "n=1 não prova operacionalmente")
  assert.equal(b.fullyValidated, true, "validação humana NÃO depende de operationallyProven (§3: estados independentes)")
})

// ---------- fail-open 4: prova precisa ser do commit ----------
test("CONTROLE NEGATIVO (fail-open 4): proof SEM commit não autoriza releaseReady", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: HEAD, proof: { ready: true }, programItems: [{ id: "x", status: "delivered" }], flake: { runs: 30, failures: 0 } })
  assert.equal(b.releaseReady, false, "proof sem commit é evidência não-atribuível -> não autoriza")
})

test("CONTROLE NEGATIVO (fail-open 4): proof de OUTRO commit não autoriza releaseReady", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: HEAD, proof: proofAt("outrocommit"), programItems: [{ id: "x", status: "delivered" }], flake: { runs: 30, failures: 0 } })
  assert.equal(b.releaseReady, false, "prova de A não vale para B")
})

test("releaseReady só com proof.ready E proof.commit === commit atual", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: HEAD, proof: proofAt(HEAD), programItems: [{ id: "x", status: "delivered" }], flake: { runs: 30, failures: 0 } })
  assert.equal(b.releaseReady, true, "prova do commit atual e verde -> pronto")
})

// ---------- scoreboard: proveniência de commit ----------
test("scoreboardFromAudit usa o commit do scope quando presente", async () => {
  const { scoreboardFromAudit } = await imp("src/dream/scoreboard.js")
  const board = scoreboardFromAudit({ summary: { REAL: 4, NOT_PROVED: 20 }, scope: { headCommit: "deadbeef" } })
  assert.equal(board.provenance.commit, "deadbeef")
})

test("CONTROLE NEGATIVO: sem scope, o scoreboard cai no commit INJETADO (nunca null por omissão)", async () => {
  const { scoreboardFromAudit } = await imp("src/dream/scoreboard.js")
  const board = scoreboardFromAudit({ summary: { REAL: 4, NOT_PROVED: 20 } }, { commit: "feedface" })
  assert.equal(board.provenance.commit, "feedface", "o comando injeta o HEAD real; commit não fica nulo por omissão")
  // e o invariante do 0A segue: NOT_PROVED nunca somado a REAL.
  assert.match(board.line, /4 REAL/)
  assert.match(board.line, /20 NOT_PROVED/)
})
