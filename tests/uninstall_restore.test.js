import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const unMod = path.join(repoRoot, "src", "installer", "uninstall.js")
const mMod = path.join(repoRoot, "src", "installer", "manifest.js")

async function withHome(fn) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-unrest-"))
  const prevHome = process.env.HOME, prevUP = process.env.USERPROFILE
  process.env.HOME = home; process.env.USERPROFILE = home
  try { return await fn(home) } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevUP === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUP
    await rm(home, { recursive: true, force: true })
  }
}

test("uninstall --dry-run: mostra plano e NÃO altera nada", async () => {
  await withHome(async (home) => {
    const { saveManifest, freshManifest, recordItem } = await import(`${pathToFileURL(mMod)}?t=${Date.now()}`)
    const skill = path.join(home, ".agents", "skills", "g-demo")
    await mkdir(skill, { recursive: true })
    await writeFile(path.join(skill, "SKILL.md"), "# demo")
    const m = freshManifest()
    recordItem(m, { path: skill, kind: "skill", action: "created", component: "skills" })
    saveManifest(m, home)

    const { uninstall } = await import(`${pathToFileURL(unMod)}?t=${Date.now()}`)
    let buf = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf += String(s); return true }
    try { await uninstall(["--dry-run"]) } finally { process.stdout.write = orig }

    assert.match(buf, /DRY RUN/)
    assert.match(buf, /REMOVIDO/)
    assert.ok(existsSync(skill), "dry-run não removeu a skill")
  })
})

test("uninstall NORMAL --yes: restaura originais (manifest) ANTES de apagar o manifest", async () => {
  await withHome(async (home) => {
    const { saveManifest, freshManifest, recordItem } = await import(`${pathToFileURL(mMod)}?t=${Date.now()}`)
    // config que o gstack modificou: settings.json (pós-install) + .bak (original do usuário)
    const f = path.join(home, ".claude", "settings.json")
    await mkdir(path.dirname(f), { recursive: true })
    await writeFile(f, "{\"gstack\":true}")
    await writeFile(f + ".gstack_vibehard.bak", "{\"user\":1}")
    const m = freshManifest()
    recordItem(m, { path: f, kind: "config", action: "modified", component: "claude", backup: f + ".gstack_vibehard.bak", removeOnUninstall: false })
    saveManifest(m, home)

    const { uninstall } = await import(`${pathToFileURL(unMod)}?t=${Date.now()}`)
    await uninstall(["--yes"]) // fluxo NORMAL (não restore-only)

    // original restaurado E manifest apagado (rollback completo no fluxo normal)
    assert.equal(await readFile(f, "utf-8"), "{\"user\":1}", "config restaurada no uninstall normal")
    assert.ok(!existsSync(path.join(home, ".gstack_vibehard")), "manifest removido por último")
  })
})

test("uninstall --restore-only --yes: restaura backup do manifest, sem remover", async () => {
  await withHome(async (home) => {
    const { saveManifest, freshManifest, recordItem } = await import(`${pathToFileURL(mMod)}?t=${Date.now()}`)
    const f = path.join(home, ".claude", "settings.json")
    await mkdir(path.dirname(f), { recursive: true })
    await writeFile(f, "{\"gstack\":true}")          // estado pós-instalação
    const bak = f + ".gstack_vibehard.bak"
    await writeFile(bak, "{\"user\":1}")             // original do usuário
    const m = freshManifest()
    recordItem(m, { path: f, kind: "config", action: "modified", component: "claude", backup: bak, removeOnUninstall: false })
    saveManifest(m, home)

    const { uninstall } = await import(`${pathToFileURL(unMod)}?t=${Date.now()}`)
    await uninstall(["--restore-only", "--yes"])

    assert.equal(await readFile(f, "utf-8"), "{\"user\":1}", "config do usuário restaurada do backup")
    assert.ok(existsSync(f), "arquivo não foi removido (restore-only)")
  })
})
