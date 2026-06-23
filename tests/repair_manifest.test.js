import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const repairMod = path.join(repoRoot, "src", "installer", "repair-manifest.js")
const integrityMod = path.join(repoRoot, "src", "installer", "integrity.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

// HOME temp com manifest inseguro de propósito:
//  - válido: config.json + backup REAL (deve ser preservado)
//  - morto: ghost.py (path inexistente → podar)
//  - backup faltando: orphan.py existe, mas seu backup não (→ marcar não-restaurável)
async function setupHome() {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-repair-"))
  const gdir = path.join(home, ".gstack_vibehard")
  await mkdir(gdir, { recursive: true })
  const validCfg = path.join(home, "config.json"); await writeFile(validCfg, "{}\n")
  const validBak = path.join(gdir, "config.json.bak"); await writeFile(validBak, "{}\n")
  const orphan = path.join(home, "orphan.py"); await writeFile(orphan, "x\n")
  const manifest = {
    version: 1,
    items: [
      { owner: "gstack", path: validCfg, kind: "file", backup: validBak, restoreOnUninstall: true, removeOnUninstall: true },
      { owner: "gstack", path: path.join(home, "ghost.py"), kind: "file", removeOnUninstall: true },
      { owner: "gstack", path: orphan, kind: "file", backup: path.join(gdir, "orphan.bak"), restoreOnUninstall: true, removeOnUninstall: true },
    ],
    rollback: { available: true, backupCount: 2 },
  }
  await writeFile(path.join(gdir, "install-manifest.json"), JSON.stringify(manifest, null, 2))
  return { home, gdir, validBak }
}

test("repair-manifest --dry-run: lista o plano e NÃO altera o manifest", async () => {
  const { home, gdir } = await setupHome()
  try {
    const { repairManifest } = await imp(repairMod)
    const before = await readFile(path.join(gdir, "install-manifest.json"), "utf-8")
    const r = repairManifest(home, { dryRun: true })
    assert.equal(r.applied, false)
    assert.ok(r.plan.some((a) => a.action === "prune"), "planeja podar o morto")
    assert.ok(r.plan.some((a) => a.action === "mark-unrestorable"), "planeja marcar não-restaurável")
    const after = await readFile(path.join(gdir, "install-manifest.json"), "utf-8")
    assert.equal(after, before, "dry-run não toca o manifest")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("repair-manifest aplica: poda morto, marca não-restaurável, preserva backups e válidos", async () => {
  const { home, gdir, validBak } = await setupHome()
  try {
    const { repairManifest } = await imp(repairMod)
    const { checkInstallIntegrity } = await imp(integrityMod)
    const before = checkInstallIntegrity(home)
    assert.ok(before.issues.length >= 2, "manifest começa inseguro")

    const r = repairManifest(home, { dryRun: false })
    assert.equal(r.applied, true)
    assert.equal(r.after.items, 2, "morto podado (3 → 2)")
    assert.ok(existsSync(r.backup), "fez backup do próprio manifest antes de reescrever")
    assert.ok(existsSync(validBak), "backup REAL do usuário preservado (nunca apagado)")

    const manifest = JSON.parse(await readFile(path.join(gdir, "install-manifest.json"), "utf-8"))
    assert.ok(!manifest.items.some((i) => i.path.endsWith("ghost.py")), "item morto removido")
    const orphan = manifest.items.find((i) => i.path.endsWith("orphan.py"))
    assert.equal(orphan.restoreOnUninstall, false, "orphan marcado não-restaurável")

    const after = checkInstallIntegrity(home)
    assert.ok(after.issues.length < before.issues.length, "menos problemas após o reparo")
    assert.equal(after.safeToUninstall, true, "uninstall volta a ser seguro")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("repair-manifest: manifest ausente → manifestExists false, nada a aplicar", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-repair-none-"))
  try {
    const { repairManifest } = await imp(repairMod)
    const r = repairManifest(home, { dryRun: true })
    assert.equal(r.manifestExists, false)
    assert.equal(r.applied, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})
