import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const integMod = path.join(repoRoot, "src", "installer", "integrity.js")
const mMod = path.join(repoRoot, "src", "installer", "manifest.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

test("checkInstallIntegrity: manifest ausente → não seguro", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-int-"))
  try {
    const { checkInstallIntegrity } = await imp(integMod)
    const r = checkInstallIntegrity(home)
    assert.equal(r.manifestExists, false)
    assert.equal(r.safeToUninstall, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("checkInstallIntegrity: backup presente + sem drift → seguro; backup sumido → issue", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-int2-"))
  try {
    const { saveManifest, freshManifest, recordItem } = await imp(mMod)
    const { checkInstallIntegrity } = await imp(integMod)
    const f = path.join(home, "cfg.json")
    const bak = f + ".gstack_vibehard.bak"
    await writeFile(f, "{\"a\":1}")
    await writeFile(bak, "ORIGINAL")
    // hash de instalação == hash atual de f (sem drift)
    const { createHash } = await import("node:crypto")
    const installedHash = "sha256:" + createHash("sha256").update(await (await import("node:fs/promises")).readFile(f)).digest("hex")
    const m = freshManifest()
    recordItem(m, { path: f, kind: "config", action: "modified", component: "t", backup: bak, installedHash, removeOnUninstall: false })
    saveManifest(m, home)

    let r = checkInstallIntegrity(home)
    assert.equal(r.safeToUninstall, true)
    assert.equal(r.drift, 0)
    assert.equal(r.backupsOk, 1)

    // edita o arquivo → drift detectado
    await writeFile(f, "{\"a\":999}")
    r = checkInstallIntegrity(home)
    assert.equal(r.drift, 1)

    // remove o backup → issue, não-seguro
    await rm(bak)
    r = checkInstallIntegrity(home)
    assert.ok(r.issues.some((i) => /backup ausente/.test(i)))
    assert.equal(r.safeToUninstall, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})
