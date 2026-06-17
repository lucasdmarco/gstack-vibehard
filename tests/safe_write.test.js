import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const swMod = path.join(repoRoot, "src", "installer", "safe-write.js")
const mMod = path.join(repoRoot, "src", "installer", "manifest.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

async function tmpHome() { return mkdtemp(path.join(tmpdir(), "gstack-sw-")) }

test("safeWriteFile: cria arquivo novo, registra no manifest (created, sem backup)", async () => {
  const home = await tmpHome()
  try {
    const { safeWriteFile } = await imp(swMod)
    const { loadManifest } = await imp(mMod)
    const f = path.join(home, "cfg.json")
    const r = safeWriteFile(f, "{\"a\":1}", { home, component: "test", kind: "config" })
    assert.equal(readFileSync(f, "utf-8"), "{\"a\":1}")
    assert.equal(r.backup, null)
    assert.match(r.installedHash, /^sha256:/)
    const m = loadManifest(home)
    const item = m.items.find((x) => x.path === f)
    assert.equal(item.action, "created")
    assert.equal(item.removeOnUninstall, true, "arquivo criado por nós é removível")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("safeWriteFile: arquivo EXISTENTE → backup versionado + restore (não remove)", async () => {
  const home = await tmpHome()
  try {
    const { safeWriteFile } = await imp(swMod)
    const { loadManifest } = await imp(mMod)
    const f = path.join(home, "user.json")
    await writeFile(f, "ORIGINAL")
    safeWriteFile(f, "GSTACK-1", { home, component: "test" })
    safeWriteFile(f, "GSTACK-2", { home, component: "test" })
    // 1º backup preserva o ORIGINAL do usuário; 2º vira .bak.1
    assert.equal(readFileSync(f + ".gstack_vibehard.bak", "utf-8"), "ORIGINAL", "backup original intacto")
    assert.ok(existsSync(f + ".gstack_vibehard.bak.1"), "backup versionado criado")
    const item = loadManifest(home).items.find((x) => x.path === f)
    assert.equal(item.removeOnUninstall, false, "arquivo do usuário não é removido")
    assert.equal(item.restoreOnUninstall, true)
    assert.ok(item.originalHash && item.installedHash)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("safeAppendBlock: insere e substitui bloco marcado, preservando conteúdo do usuário", async () => {
  const home = await tmpHome()
  try {
    const { safeAppendBlock } = await imp(swMod)
    const f = path.join(home, ".env")
    await writeFile(f, "USER_VAR=1\n")
    const opts = { home, component: "test", beginMarker: "# >>> gstack", endMarker: "# <<< gstack" }
    safeAppendBlock(f, "A=1", opts)
    safeAppendBlock(f, "A=2", opts) // substitui o bloco
    const out = readFileSync(f, "utf-8")
    assert.match(out, /USER_VAR=1/, "conteúdo do usuário preservado")
    assert.match(out, /A=2/)
    assert.ok(!out.includes("A=1"), "bloco antigo substituído, não duplicado")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("safeCopyDir: registra ownership do diretório criado", async () => {
  const home = await tmpHome()
  try {
    const { safeCopyDir } = await imp(swMod)
    const { loadManifest } = await imp(mMod)
    const src = path.join(home, "src-skill")
    await mkdir(src, { recursive: true })
    await writeFile(path.join(src, "SKILL.md"), "# skill")
    const dst = path.join(home, ".agents", "skills", "minha")
    safeCopyDir(src, dst, { home, component: "skills", kind: "skill" })
    assert.ok(existsSync(path.join(dst, "SKILL.md")))
    const item = loadManifest(home).items.find((x) => x.path === dst)
    assert.equal(item.kind, "skill")
    assert.equal(item.removeOnUninstall, true)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("manifest: recordItem é idempotente por path+kind e conta backups", async () => {
  const home = await tmpHome()
  try {
    const { loadManifest, recordItem, saveManifest, freshManifest } = await imp(mMod)
    const m = freshManifest()
    recordItem(m, { path: "/x", kind: "file", action: "created", component: "t" })
    recordItem(m, { path: "/x", kind: "file", action: "modified", component: "t", backup: "/x.bak" })
    assert.equal(m.items.length, 1, "atualiza, não duplica")
    assert.equal(m.items[0].action, "modified")
    assert.equal(m.rollback.backupCount, 1)
    saveManifest(m, home)
    assert.equal(loadManifest(home).items.length, 1)
  } finally { await rm(home, { recursive: true, force: true }) }
})
