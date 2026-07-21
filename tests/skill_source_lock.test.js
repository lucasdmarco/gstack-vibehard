import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const COMMIT = "a".repeat(40)

test("hashContent: determinístico — mesmo conteúdo -> sempre o mesmo hash", async () => {
  const { hashContent } = await imp("src/skills/source-lock.js")
  assert.equal(hashContent("hello"), hashContent("hello"))
  assert.notEqual(hashContent("hello"), hashContent("world"))
  assert.match(hashContent("x"), /^sha256:[0-9a-f]{64}$/)
})

test("buildSourceLockId: determinístico por repo+commit+path — mesmo input -> mesmo id", async () => {
  const { buildSourceLockId } = await imp("src/skills/source-lock.js")
  const a = buildSourceLockId({ repository: "owner/repo", commit: COMMIT, path: "skills/x" })
  const b = buildSourceLockId({ repository: "owner/repo", commit: COMMIT, path: "skills/x" })
  const c = buildSourceLockId({ repository: "owner/repo", commit: COMMIT, path: "skills/y" })
  assert.match(a, /^sl_[0-9a-f]{16}$/)
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test("buildSourceLock: mesmo input produz lock byte-a-byte idêntico (determinismo fim-a-fim)", async () => {
  const { buildSourceLock } = await imp("src/skills/source-lock.js")
  const input = { repository: "owner/repo", commit: COMMIT, path: "skills/x", license: "MIT", artifactKind: "skill", originalContent: "conteúdo original" }
  const l1 = buildSourceLock(input)
  const l2 = buildSourceLock(input)
  assert.deepEqual(l1, l2)
  assert.equal(l1.status, "discovered")
})

test("validateSourceLock: commit precisa ser sha COMPLETO — branch/tag nunca passam", async () => {
  const { buildSourceLock, validateSourceLock } = await imp("src/skills/source-lock.js")
  const bad = buildSourceLock({ repository: "owner/repo", commit: "main", path: "skills/x", license: "MIT", artifactKind: "skill" })
  const v = validateSourceLock(bad)
  assert.equal(v.ok, false)
  assert.ok(v.reasons.some((r) => /commit/i.test(r)))
})

test("validateSourceLock: license ausente -> invalid", async () => {
  const { buildSourceLock, validateSourceLock } = await imp("src/skills/source-lock.js")
  const bad = buildSourceLock({ repository: "owner/repo", commit: COMMIT, path: "skills/x", artifactKind: "skill" })
  const v = validateSourceLock(bad)
  assert.equal(v.ok, false)
  assert.ok(v.reasons.some((r) => /license/i.test(r)))
})

test("validateSourceLock: path com travessia ou absoluto -> invalid", async () => {
  const { buildSourceLock, validateSourceLock } = await imp("src/skills/source-lock.js")
  const traversal = buildSourceLock({ repository: "owner/repo", commit: COMMIT, path: "../../etc/passwd", license: "MIT", artifactKind: "skill" })
  const absolute = buildSourceLock({ repository: "owner/repo", commit: COMMIT, path: "/etc/passwd", license: "MIT", artifactKind: "skill" })
  assert.equal(validateSourceLock(traversal).ok, false)
  assert.equal(validateSourceLock(absolute).ok, false)
})

test("validateSourceLock: artifactKind fora do enum -> invalid", async () => {
  const { buildSourceLock, validateSourceLock } = await imp("src/skills/source-lock.js")
  const bad = buildSourceLock({ repository: "owner/repo", commit: COMMIT, path: "skills/x", license: "MIT", artifactKind: "malware" })
  assert.equal(validateSourceLock(bad).ok, false)
})

test("canTransitionLock: discovered->quarantined->audited->approved é o caminho feliz; revoked é terminal", async () => {
  const { canTransitionLock } = await imp("src/skills/source-lock.js")
  assert.equal(canTransitionLock("discovered", "quarantined"), true)
  assert.equal(canTransitionLock("quarantined", "audited"), true)
  assert.equal(canTransitionLock("audited", "approved"), true)
  assert.equal(canTransitionLock("discovered", "approved"), false, "sem pular quarentena/auditoria")
  assert.equal(canTransitionLock("revoked", "approved"), false, "revoked é terminal — nunca reinstalação silenciosa")
})
