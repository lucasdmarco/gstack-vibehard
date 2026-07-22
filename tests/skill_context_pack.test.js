import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtemp(path.join(tmpdir(), p))

async function approvedLock(originalContent = "conteúdo aprovado") {
  const { buildSourceLock } = await imp("src/skills/source-lock.js")
  const lock = buildSourceLock({ repository: "owner/repo", commit: "a".repeat(40), path: "skills/x", license: "MIT", artifactKind: "skill", originalContent })
  return { ...lock, status: "approved" }
}

test("validateFragmentEligibility: lock 'discovered'/'quarantined' (não aprovado) -> bloqueado", async () => {
  const { validateFragmentEligibility } = await imp("src/skills/skill-context-pack.js")
  const lock = await approvedLock()
  assert.equal(validateFragmentEligibility({ ...lock, status: "discovered" }).ok, false)
  assert.equal(validateFragmentEligibility({ ...lock, status: "quarantined" }).ok, false)
})

test("validateFragmentEligibility: lock 'stale'/'revoked' -> bloqueado (nunca materializa)", async () => {
  const { validateFragmentEligibility } = await imp("src/skills/skill-context-pack.js")
  const lock = await approvedLock()
  assert.equal(validateFragmentEligibility({ ...lock, status: "stale" }).ok, false)
  assert.equal(validateFragmentEligibility({ ...lock, status: "revoked" }).ok, false)
})

test("validateFragmentEligibility: hash divergente do lock -> bloqueado, mesmo com status aprovado", async () => {
  const { validateFragmentEligibility } = await imp("src/skills/skill-context-pack.js")
  const lock = await approvedLock("versão original")
  const r = validateFragmentEligibility(lock, "versão MUDOU sem re-auditoria")
  assert.equal(r.ok, false)
  assert.match(r.reason, /hash divergente/)
})

test("validateFragmentEligibility: status aprovado + hash batendo -> elegível", async () => {
  const { validateFragmentEligibility } = await imp("src/skills/skill-context-pack.js")
  const lock = await approvedLock("conteúdo estável")
  assert.equal(validateFragmentEligibility(lock, "conteúdo estável").ok, true)
})

test("materializeFragment: escreve DENTRO de .gstack/runs/<runId>/context/skills/ — nunca em HOME global", async () => {
  const { materializeFragment } = await imp("src/skills/skill-context-pack.js")
  const cwd = await mk("gstack-skillctx-")
  try {
    const lock = await approvedLock("conteúdo x")
    const r = materializeFragment({ cwd, runId: "run1", sourceLock: lock, content: "conteúdo x", currentContent: "conteúdo x" })
    assert.equal(r.ok, true)
    assert.equal(r.status, "materialized")
    assert.ok(r.path.startsWith(path.join(cwd, ".gstack", "runs", "run1", "context", "skills")))
    assert.ok(existsSync(r.path))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("materializeFragment: lock stale -> NUNCA escreve nada no disco (fail-closed antes da escrita)", async () => {
  const { materializeFragment, fragmentsDir } = await imp("src/skills/skill-context-pack.js")
  const cwd = await mk("gstack-skillctx-")
  try {
    const lock = await approvedLock("x")
    const r = materializeFragment({ cwd, runId: "run2", sourceLock: { ...lock, status: "stale" }, content: "x" })
    assert.equal(r.ok, false)
    assert.equal(existsSync(fragmentsDir(cwd, "run2")), false, "diretório nunca chega a ser criado")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("materializeFragment: id de source lock malformado (path escape) é bloqueado pela contenção", async () => {
  const { materializeFragment } = await imp("src/skills/skill-context-pack.js")
  const cwd = await mk("gstack-skillctx-")
  try {
    const lock = await approvedLock("x")
    const evilLock = { ...lock, id: "../../../etc/passwd" }
    const r = materializeFragment({ cwd, runId: "run3", sourceLock: evilLock, content: "x", currentContent: "x" })
    assert.equal(r.ok, false)
    assert.match(r.reason, /fora do workspace|escape/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("materializeFragment: NUNCA gera artefato fora do run (isolamento — dois runIds não colidem)", async () => {
  const { materializeFragment } = await imp("src/skills/skill-context-pack.js")
  const cwd = await mk("gstack-skillctx-")
  try {
    const lock = await approvedLock("conteúdo")
    const r1 = materializeFragment({ cwd, runId: "runA", sourceLock: lock, content: "conteúdo", currentContent: "conteúdo" })
    const r2 = materializeFragment({ cwd, runId: "runB", sourceLock: lock, content: "conteúdo", currentContent: "conteúdo" })
    assert.notEqual(r1.path, r2.path)
    assert.ok(r1.path.includes(path.join("runs", "runA")))
    assert.ok(r2.path.includes(path.join("runs", "runB")))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("purgeFragment: remove SÓ o arquivo do próprio run, sem tocar em nada mais", async () => {
  const { materializeFragment, purgeFragment } = await imp("src/skills/skill-context-pack.js")
  const cwd = await mk("gstack-skillctx-")
  try {
    const lock = await approvedLock("y")
    const r = materializeFragment({ cwd, runId: "run4", sourceLock: lock, content: "y", currentContent: "y" })
    assert.ok(existsSync(r.path))
    const purged = purgeFragment(cwd, "run4", lock.id)
    assert.equal(purged.status, "purged")
    assert.equal(existsSync(r.path), false)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("canTransitionFragment: materialized->consumed->expired->purged é o caminho feliz; purged é terminal", async () => {
  const { canTransitionFragment } = await imp("src/skills/skill-context-pack.js")
  assert.equal(canTransitionFragment("materialized", "consumed"), true)
  assert.equal(canTransitionFragment("consumed", "expired"), true)
  assert.equal(canTransitionFragment("expired", "purged"), true)
  assert.equal(canTransitionFragment("purged", "materialized"), false, "purged nunca reinstala")
  assert.equal(canTransitionFragment("materialized", "purged"), true, "materialized pode ir direto pra purged (descarte antecipado)")
})
