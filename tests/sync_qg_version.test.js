import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "scripts", "sync-qg-version.mjs")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function fixture(version, qgBody) {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-syncqg-"))
  const pkgPath = path.join(dir, "package.json")
  const qgPath = path.join(dir, "qg.py")
  await writeFile(pkgPath, JSON.stringify({ version }))
  await writeFile(qgPath, qgBody)
  return { dir, pkgPath, qgPath }
}

test("sync-qg-version: reescreve QG_VERSION p/ a versão do package, preservando o resto", async () => {
  const { dir, pkgPath, qgPath } = await fixture("3.0.17", 'import x\nQG_VERSION = "3.0.3"\nFOO = 1\n')
  try {
    const { syncQgVersion } = await imp()
    const r = syncQgVersion({ pkgPath, qgPath })
    assert.equal(r.version, "3.0.17")
    assert.equal(r.changed, true)
    const body = await readFile(qgPath, "utf-8")
    assert.match(body, /^QG_VERSION = "3.0.17"$/m)
    assert.doesNotMatch(body, /3\.0\.3/)
    assert.match(body, /^FOO = 1$/m, "outras linhas intactas")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("sync-qg-version: idempotente (2ª chamada não muda nada)", async () => {
  const { dir, pkgPath, qgPath } = await fixture("3.0.17", 'QG_VERSION = "3.0.17"\n')
  try {
    const { syncQgVersion } = await imp()
    assert.equal(syncQgVersion({ pkgPath, qgPath }).changed, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("sync-qg-version: linha QG_VERSION ausente → erro (falha loud no release)", async () => {
  const { dir, pkgPath, qgPath } = await fixture("3.0.17", "sem a linha\n")
  try {
    const { syncQgVersion } = await imp()
    assert.throws(() => syncQgVersion({ pkgPath, qgPath }), /não encontrada/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
