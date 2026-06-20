import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const ocMod = path.join(repoRoot, "src", "harness", "opencode.js")
const mMod = path.join(repoRoot, "src", "installer", "manifest.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

const PLUGINS = ["gstack-security.js", "gstack-session.js", "gstack-prompt.js"]

test("installOpenCode: 3 plugins copiados E registrados no manifest (manifest-owned)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-ocp-"))
  try {
    const { installOpenCode } = await imp(ocMod)
    const report = { added: [], updated: [], skipped: [], errors: [] }
    await installOpenCode({ hooks: true }, report, { home })
    const pluginsDir = path.join(home, ".config", "opencode", "plugins")
    for (const f of PLUGINS) assert.ok(existsSync(path.join(pluginsDir, f)), `plugin ${f} copiado`)
    const { loadManifest } = await imp(mMod)
    const m = loadManifest(home)
    const owned = (m.items || []).filter((it) => it.component === "opencode-plugin")
    assert.equal(owned.length, 3, "3 plugins no manifest")
    for (const it of owned) assert.equal(it.removeOnUninstall, true, "plugin novo é removível no uninstall")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("installOpenCode: plugin homônimo do usuário é BACKUPED e restaurável", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-ocp-"))
  try {
    const pluginsDir = path.join(home, ".config", "opencode", "plugins")
    await mkdir(pluginsDir, { recursive: true })
    await writeFile(path.join(pluginsDir, "gstack-security.js"), "// plugin do USUÁRIO\n")
    const { installOpenCode } = await imp(ocMod)
    await installOpenCode({ hooks: true }, { added: [], updated: [], skipped: [], errors: [] }, { home })
    assert.ok(existsSync(path.join(pluginsDir, "gstack-security.js.gstack_vibehard.bak")), "backup do plugin do usuário")
    const { loadManifest } = await imp(mMod)
    const it = (loadManifest(home).items || []).find((x) => x.path.endsWith("gstack-security.js"))
    assert.equal(it.restoreOnUninstall, true, "restaurável no uninstall")
    assert.equal(it.removeOnUninstall, false, "não remove um arquivo que já era do usuário")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("kill switch GSTACK_OPENCODE_DISABLE=1 desliga os plugins (sem hooks)", async () => {
  const prev = process.env.GSTACK_OPENCODE_DISABLE
  process.env.GSTACK_OPENCODE_DISABLE = "1"
  try {
    const sec = await imp(path.join(repoRoot, "src", "plugins", "opencode", "gstack-security.js"))
    const prompt = await imp(path.join(repoRoot, "src", "plugins", "opencode", "gstack-prompt.js"))
    const session = await imp(path.join(repoRoot, "src", "plugins", "opencode", "gstack-session.js"))
    assert.deepEqual(await sec.GstackSecurity(), {})
    assert.deepEqual(await prompt.GstackPrompt(), {})
    assert.deepEqual(await session.GstackSession({ $: () => {} }), {})
  } finally {
    if (prev === undefined) delete process.env.GSTACK_OPENCODE_DISABLE; else process.env.GSTACK_OPENCODE_DISABLE = prev
  }
})
