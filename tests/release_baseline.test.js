import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.0B — freeze e baseline reproduzível (§3).
 *
 * Núcleo: `ready:true` deixou de significar "concluído". Quatro estados
 * separados, provenance por commit (prova de A não vale para B), e a baseline
 * registra a evidência de FLAKE (N execuções), nunca uma única run.
 */

const RELEASE_STATES = ["releaseReady", "programComplete", "operationallyProven", "fullyValidated"]

test("§3: os 4 estados existem e são INDEPENDENTES (nenhum implica o outro)", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({
    commit: "abc1234",
    proof: { ready: true },
    programItems: [{ id: "P0.1", status: "delivered" }, { id: "P1.1", status: "partial" }],
    flake: { runs: 3, failures: 1 },
    humanValidation: { pending: 2 },
  })
  for (const s of RELEASE_STATES) assert.ok(s in b, `estado ${s} presente`)
  assert.equal(b.releaseReady, true, "gates passaram")
  assert.equal(b.programComplete, false, "há item partial -> não completo")
  assert.equal(b.operationallyProven, false, "flake > 0 -> não provado operacionalmente")
  assert.equal(b.fullyValidated, false, "validação humana pendente")
})

test("CONTROLE NEGATIVO: item partial/pending impede programComplete (§3)", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  for (const bad of ["partial", "pending", "not_executed", "blocked"]) {
    const b = buildReleaseBaseline({ commit: "c", proof: { ready: true }, programItems: [{ id: "x", status: bad }], flake: { runs: 1, failures: 0 } })
    assert.equal(b.programComplete, false, `status ${bad} não pode ser completo`)
  }
})

test("programComplete só com residual REMOVIDO explicitamente (non-goal)", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({
    commit: "c", proof: { ready: true },
    programItems: [{ id: "x", status: "delivered" }, { id: "y", status: "partial", nonGoal: true, nonGoalReason: "removido do escopo por decisão explícita" }],
    flake: { runs: 30, failures: 0 },
  })
  assert.equal(b.programComplete, true, "partial convertido em non-goal explícito não bloqueia")
})

// --- provenance por commit ---
test("CONTROLE NEGATIVO: prova do commit A NÃO vale para o commit B (§ Sprint 51.0)", async () => {
  const { evidenceValidForCommit } = await imp("src/release/baseline.js")
  assert.equal(evidenceValidForCommit({ commit: "aaaa" }, "aaaa"), true)
  assert.equal(evidenceValidForCommit({ commit: "aaaa" }, "bbbb"), false, "proof de outro commit nunca autoriza")
  assert.equal(evidenceValidForCommit({ commit: null }, "aaaa"), false, "prova sem commit nunca autoriza")
})

// --- flake honesto (a lição da calibração) ---
test("operationallyProven exige MÚLTIPLAS execuções sem falha, nunca n=1", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const oneGreen = buildReleaseBaseline({ commit: "c", proof: { ready: true }, programItems: [], flake: { runs: 1, failures: 0 } })
  assert.equal(oneGreen.operationallyProven, false, "1 execução verde NÃO prova operacionalmente (lição da calibração)")
  const many = buildReleaseBaseline({ commit: "c", proof: { ready: true }, programItems: [], flake: { runs: 30, failures: 0 } })
  assert.equal(many.operationallyProven, true, "30 execuções sem falha prova")
})

test("CONTROLE NEGATIVO: qualquer flake > 0 derruba operationallyProven", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: "c", proof: { ready: true }, programItems: [], flake: { runs: 30, failures: 1 } })
  assert.equal(b.operationallyProven, false, "1 falha em 30 ainda é flaky")
  assert.ok(b.flakeRate > 0)
})

// --- anti-render: ready não é "concluído" (§3) ---
test("CONTROLE NEGATIVO: ready:true com programComplete:false NÃO pode ser dito 'concluído'", async () => {
  const { canRenderAsComplete, buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: "c", proof: { ready: true }, programItems: [{ id: "x", status: "partial" }], flake: { runs: 30, failures: 0 } })
  const r = canRenderAsComplete(b)
  assert.equal(r.ok, false)
  assert.match(r.reason, /programComplete/i)
})

test("canRenderAsComplete: só com os 3 estados de fechamento verdes", async () => {
  const { canRenderAsComplete, buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({
    commit: "c", proof: { ready: true },
    programItems: [{ id: "x", status: "delivered" }],
    flake: { runs: 30, failures: 0 }, humanValidation: { pending: 0 },
  })
  assert.equal(canRenderAsComplete(b).ok, true)
})

// --- snapshot fixo de dream audit não autoriza release ---
test("CONTROLE NEGATIVO: snapshot FIXO de dream audit não autoriza release (§ Sprint 51.0)", async () => {
  const { dreamEvidenceIsLive } = await imp("src/release/baseline.js")
  assert.equal(dreamEvidenceIsLive({ source: "hardcoded", commit: null }), false, "número fixo nunca autoriza")
  assert.equal(dreamEvidenceIsLive({ source: "live_audit", commit: "abc1234" }), true)
})

test("baseline schema tem proveniência e é serializável (JSON puro)", async () => {
  const { buildReleaseBaseline } = await imp("src/release/baseline.js")
  const b = buildReleaseBaseline({ commit: "abc1234", proof: { ready: true }, programItems: [], flake: { runs: 2, failures: 0 } })
  assert.equal(b.schemaVersion, "gstack.release-baseline.v1")
  assert.equal(b.provenance.commit, "abc1234")
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(b)))
})

// --- fixture REAL da baseline: prova que registramos pass E fail, não só verde ---
test("FIXTURE REAL: a baseline registrada é honesta — proof verde MAS não concluída", async () => {
  const { readFileSync } = await import("node:fs")
  const path = await import("node:path")
  const fx = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "release", "baseline-v5.57.0.json"), "utf-8"))
  // O ponto da calibração: registrar flake (pass E fail), nunca uma execução.
  assert.ok(fx.evidence.flake.runtimeE2E.failures > 0, "a baseline registra a falha real do runtime, não só os verdes")
  assert.ok(fx.evidence.flake.runtimeE2E.runs > 1, "múltiplas execuções, nunca n=1")
  // E o veredito é honesto: releaseReady sim, mas os 3 de fechamento não.
  assert.equal(fx.verdict.releaseReady, true)
  assert.equal(fx.verdict.programComplete, false)
  assert.equal(fx.verdict.operationallyProven, false)
  assert.equal(fx.verdict.canRenderAsComplete, false)
})

test("FIXTURE REAL passa pelo buildReleaseBaseline e bate com o veredito registrado", async () => {
  const { buildReleaseBaseline, canRenderAsComplete } = await imp("src/release/baseline.js")
  const { readFileSync } = await import("node:fs")
  const path = await import("node:path")
  const fx = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "release", "baseline-v5.57.0.json"), "utf-8"))
  const b = buildReleaseBaseline({
    commit: fx.commitAtFreeze,
    proof: fx.evidence.proof,
    programItems: fx.evidence.programCompleteness.residuals.map((r) => ({ id: r.prd, status: "partial" })),
    flake: { runs: fx.evidence.flake.runtimeE2E.runs, failures: fx.evidence.flake.runtimeE2E.failures },
    humanValidation: { pending: 1 },
  })
  assert.equal(b.releaseReady, fx.verdict.releaseReady)
  assert.equal(b.programComplete, fx.verdict.programComplete)
  assert.equal(b.operationallyProven, fx.verdict.operationallyProven)
  assert.equal(canRenderAsComplete(b).ok, fx.verdict.canRenderAsComplete)
})
