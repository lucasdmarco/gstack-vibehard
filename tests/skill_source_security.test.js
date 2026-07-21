import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD46 S46.4 — suíte adversarial da cadeia discovery -> source-lock: cobre os
 * vetores que o vendoring de conteúdo externo precisa recusar antes de qualquer
 * escrita (path traversal, symlink escape, nome duplicado, manifest malformado,
 * licença não suportada, hash de conteúdo divergente). Integra os módulos do
 * S46.1 (discovery.js) com as adições do S46.4 (source-lock.js).
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const COMMIT = "b".repeat(40)

function fakeIo({ dirs, files, realpaths = {} }) {
  return {
    listDir: (dir) => dirs[dir] || [],
    read: (p) => (p in files ? files[p] : null),
    realpath: (p) => (p in realpaths ? realpaths[p] : p),
  }
}
const SKILL = (name) => `---\nname: ${name}\ndescription: faz algo\n---\n\n# ${name}\n`

test("path traversal: nome do manifest com travessia é bloqueado pela discovery ANTES de virar source lock", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const root = path.join("C:", "vend-root")
  const dir = path.join(root, "evil")
  const io = fakeIo({ dirs: { [root]: [{ name: "evil", isDirectory: true }], [dir]: [{ name: "SKILL.md", isDirectory: false }] }, files: { [path.join(dir, "SKILL.md")]: SKILL("../../etc/passwd") } })
  const r = discoverArtifacts({ root, io })
  assert.equal(r.ok, false)
  assert.equal(r.found.length, 0, "nunca chega a virar candidato a source lock")
})

test("symlink escape: diretório vendorizado que escapa do root nunca é seguido", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const root = path.join("C:", "vend-root2")
  const dir = path.join(root, "linked")
  const io = fakeIo({
    dirs: { [root]: [{ name: "linked", isDirectory: true }], [dir]: [{ name: "SKILL.md", isDirectory: false }] },
    files: { [path.join(dir, "SKILL.md")]: SKILL("linked") },
    realpaths: { [dir]: path.join("C:", "fora-do-root", "linked") },
  })
  const r = discoverArtifacts({ root, io })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /symlink/i.test(p.reason)))
})

test("nome duplicado (shadowing): dois artefatos reivindicando o mesmo nome — só o primeiro vira source lock", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const root = path.join("C:", "vend-root3")
  const dirA = path.join(root, "a")
  const dirB = path.join(root, "b")
  const io = fakeIo({
    dirs: { [root]: [{ name: "a", isDirectory: true }, { name: "b", isDirectory: true }], [dirA]: [{ name: "SKILL.md", isDirectory: false }], [dirB]: [{ name: "SKILL.md", isDirectory: false }] },
    files: { [path.join(dirA, "SKILL.md")]: SKILL("mesmo-nome"), [path.join(dirB, "SKILL.md")]: SKILL("mesmo-nome") },
  })
  const r = discoverArtifacts({ root, io })
  assert.equal(r.found.length, 1)
  assert.ok(r.problems.some((p) => /shadowing/i.test(p.reason)))
})

test("manifest de plugin malformado (JSON inválido) nunca vira artefato descoberto", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const root = path.join("C:", "vend-root4")
  const dir = path.join(root, "plug")
  const io = fakeIo({ dirs: { [root]: [{ name: "plug", isDirectory: true }], [dir]: [{ name: "plugin.json", isDirectory: false }] }, files: { [path.join(dir, "plugin.json")]: "{ isto não é json válido" } })
  const r = discoverArtifacts({ root, io })
  assert.equal(r.ok, false)
  assert.equal(r.found.length, 0)
})

test("unsupported license: source lock com licença fora do SPDX permitido é bloqueado", async () => {
  const { buildSourceLock, validateSourceLock } = await imp("src/skills/source-lock.js")
  const lock = buildSourceLock({ repository: "owner/repo", commit: COMMIT, path: "skills/x", license: "WTFPL", artifactKind: "skill" })
  const v = validateSourceLock(lock)
  assert.equal(v.ok, false)
  assert.ok(v.reasons.some((r) => /license não suportada/.test(r)))
})

test("unsupported license: licenças da allowlist (MIT/Apache-2.0/BSD/ISC) passam", async () => {
  const { buildSourceLock, validateSourceLock, SUPPORTED_LICENSES } = await imp("src/skills/source-lock.js")
  assert.ok(SUPPORTED_LICENSES.includes("Apache-2.0"))
  for (const license of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"]) {
    const lock = buildSourceLock({ repository: "owner/repo", commit: COMMIT, path: "skills/x", license, artifactKind: "skill" })
    assert.equal(validateSourceLock(lock).ok, true, license)
  }
})

test("content-hash mismatch: conteúdo mudou desde o lock -> hashDrifted true, nunca reinstalação silenciosa", async () => {
  const { buildSourceLock, hashDrifted } = await imp("src/skills/source-lock.js")
  const lock = buildSourceLock({ repository: "owner/repo", commit: COMMIT, path: "skills/x", license: "MIT", artifactKind: "skill", originalContent: "versão 1 do conteúdo" })
  assert.equal(hashDrifted(lock, "versão 1 do conteúdo"), false, "mesmo conteúdo — sem drift")
  assert.equal(hashDrifted(lock, "versão 2, alguém mudou o arquivo upstream"), true, "conteúdo mudou — drift detectado")
})
