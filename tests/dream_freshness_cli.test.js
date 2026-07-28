import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtempSync(path.join(tmpdir(), p))

/**
 * PRD51 S51.6.7 — controle negativo REAL e novo do claim `dream-freshness`.
 *
 * O próprio codebase se auto-documentava honesto: `dream_freshness.test.js`
 * tinha um teste dizendo NOT_PROVED porque "não há CLI E2E de revoke ainda"
 * — não existia nenhum comando CLI que disparasse `revokeCandidate`/
 * `markStale` (freshness.js) e persistisse a transição de volta no disco.
 * Este arquivo fecha esse gap: `dream revoke`/`dream stale` são comandos
 * REAIS agora, que localizam o candidate no closeout.json do run que o
 * detectou e regravam SÓ esse arquivo — provado ponta a ponta via CLI.
 */

function mkRun(dir, runId, candidate) {
  const runDir = path.join(dir, ".gstack", "runs", runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(path.join(runDir, "closeout.json"), JSON.stringify({ learning: { candidate } }))
  return path.join(runDir, "closeout.json")
}
const promotedCandidate = (id) => ({ id, classification: "skill", title: "algo aprendido", validity: { status: "eligible" }, status: "promoted" })

test("dream revoke <id>: transição REAL persiste no closeout.json (re-lido do disco, não só em memória)", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-freshness-revoke-")
  try {
    const closeoutPath = mkRun(dir, "run-a", promotedCandidate("lc_revoke"))
    const r = await dreamCommand(["revoke", "lc_revoke", "--reason", "superado por lc_novo", "--json"], { cwd: dir })
    assert.equal(r.ok, true)
    assert.equal(r.candidate.status, "revoked")
    assert.equal(r.candidate.revokedReason, "superado por lc_novo")
    assert.ok(r.candidate.revokedAt, "provenance: timestamp da revogação registrado")
    // NUNCA confiar só no retorno em memória — relê do disco de verdade.
    const onDisk = JSON.parse(readFileSync(closeoutPath, "utf-8"))
    assert.equal(onDisk.learning.candidate.status, "revoked")
    assert.equal(onDisk.learning.candidate.revokedReason, "superado por lc_novo")
    // provenance preservada: id/title/classification originais intactos, nunca apagados.
    assert.equal(onDisk.learning.candidate.id, "lc_revoke")
    assert.equal(onDisk.learning.candidate.title, "algo aprendido")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("dream stale <id>: transição REAL persiste no closeout.json", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-freshness-stale-")
  try {
    const closeoutPath = mkRun(dir, "run-b", promotedCandidate("lc_stale"))
    const r = await dreamCommand(["stale", "lc_stale", "--json"], { cwd: dir })
    assert.equal(r.ok, true)
    assert.equal(r.candidate.status, "stale")
    const onDisk = JSON.parse(readFileSync(closeoutPath, "utf-8"))
    assert.equal(onDisk.learning.candidate.status, "stale")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// CONTROLE NEGATIVO: a máquina de estados (candidate.js) só permite
// promoted->stale/revoked/superseded — nunca um salto (ex.: observed->revoked
// direto). Prova que o CLI RESPEITA o fail-closed da máquina de estados, não
// só a função pura isolada.
test("CONTROLE NEGATIVO: dream revoke recusa candidate que NÃO está 'promoted' (sem salto de estado)", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-freshness-invalid-")
  try {
    const closeoutPath = mkRun(dir, "run-c", { id: "lc_observed", status: "observed" })
    const r = await dreamCommand(["revoke", "lc_observed", "--json"], { cwd: dir })
    assert.equal(r.error, "invalid_transition")
    assert.match(r.message, /observed -> revoked/)
    // nada foi escrito — o arquivo original continua intacto.
    const onDisk = JSON.parse(readFileSync(closeoutPath, "utf-8"))
    assert.equal(onDisk.learning.candidate.status, "observed", "candidate NÃO foi mutado por uma transição inválida")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// CONTROLE NEGATIVO: candidate inexistente nunca finge sucesso.
test("CONTROLE NEGATIVO: dream revoke em candidate inexistente devolve erro honesto (nunca 'ok' silencioso)", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-freshness-missing-")
  try {
    const r = await dreamCommand(["revoke", "lc_nao_existe", "--json"], { cwd: dir })
    assert.equal(r.error, "candidate_not_found")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// Fecha o ciclo: depois de revogar via CLI, `dream metrics`/`dream candidates`
// (que só LEEM o closeout.json) refletem a transição real, ponta a ponta.
test("ponta a ponta: revoke via CLI muda o que dream metrics/candidates reportam depois", async () => {
  const { dreamCommand } = await imp("src/commands/dream.js")
  const dir = mk("gstack-freshness-e2e-")
  try {
    mkRun(dir, "run-d", promotedCandidate("lc_e2e"))
    const before = await dreamCommand(["metrics", "--json"], { cwd: dir })
    assert.equal(before.promoted, 1)
    assert.equal(before.revoked, 0)

    await dreamCommand(["revoke", "lc_e2e", "--json"], { cwd: dir })

    const after = await dreamCommand(["metrics", "--json"], { cwd: dir })
    assert.equal(after.promoted, 0, "candidate revogado não conta mais como promoted")
    assert.equal(after.revoked, 1)

    const candidates = await dreamCommand(["candidates", "--json"], { cwd: dir })
    assert.equal(candidates.candidates[0].status, "revoked")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
