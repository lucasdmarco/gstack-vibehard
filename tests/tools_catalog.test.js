import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/** Captura process.stdout.write durante fn. */
async function capture(fn) {
  const orig = process.stdout.write
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try { await fn() } finally { process.stdout.write = orig }
  return buf
}

test("annotateCatalogEntry: risco por origem, sem auto-install, comando sugerido", async () => {
  const { annotateCatalogEntry } = await imp("src/tools/catalog.js")
  const local = annotateCatalogEntry({ slug: "x", origin: "local" })
  assert.equal(local.risk, "low")
  assert.equal(local.autoInstall, false)
  assert.equal(local.installCommand, null)
  const remote = annotateCatalogEntry({ slug: "y", origin: "remote" })
  assert.equal(remote.risk, "medium")
  assert.match(remote.installCommand, /tools install y/)
  assert.equal(remote.provenanceRequired, true)
  const dangerous = annotateCatalogEntry({ slug: "z", origin: "remote", mcpCompanion: true })
  assert.equal(dangerous.risk, "high")
  assert.equal(dangerous.mcpCompanionOptIn, true)
})

test("tools catalog --json: JSON PURO com origem e risco (offline, nada instalado)", async () => {
  const { toolsCommand } = await imp("src/commands/tools.js")
  const out = await capture(() => toolsCommand(["catalog", "--json"], { exec: () => "[]" }))
  const d = JSON.parse(out)
  assert.ok(Array.isArray(d.catalog) && d.catalog.length)
  for (const e of d.catalog) {
    assert.ok(["local", "bundled", "remote"].includes(e.origin))
    assert.ok(["low", "medium", "high"].includes(e.risk))
    assert.equal(e.autoInstall, false)
  }
})

test("tools list --json: JSON PURO mesmo offline (available:false, items:[])", async () => {
  const { toolsCommand } = await imp("src/commands/tools.js")
  // exec injetado que falha → catálogo indisponível, mas saída é JSON puro
  const out = await capture(() => toolsCommand(["list", "--json"], { exec: () => { throw new Error("sem rede") } }))
  const d = JSON.parse(out)
  assert.equal(typeof d.available, "boolean")
  assert.ok(Array.isArray(d.items))
})
