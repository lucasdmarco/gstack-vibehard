import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "installer", "package-manager.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

// io fake: `files` = sufixos que existem; `json` = conteúdo por sufixo; `bins` = no PATH.
function io({ files = [], json = {}, bins = [] } = {}) {
  const norm = (p) => p.replace(/\\/g, "/")
  return {
    exists: (p) => files.some((f) => norm(p).endsWith(f)),
    readJson: (p) => { const k = Object.keys(json).find((f) => norm(p).endsWith(f)); return k ? json[k] : null },
    hasBinary: (b) => bins.includes(b),
  }
}

test("packageManager field define o PM (ok)", async () => {
  const { resolvePackageManager } = await imp()
  const r = resolvePackageManager("/proj", io({ json: { "package.json": { packageManager: "pnpm@10.33.0" } }, bins: ["pnpm"] }))
  assert.equal(r.pm, "pnpm"); assert.equal(r.state, "ok"); assert.equal(r.version, "10.33.0")
})

test("múltiplos lockfiles → lockfile_conflict", async () => {
  const { resolvePackageManager } = await imp()
  const r = resolvePackageManager("/proj", io({ files: ["/pnpm-lock.yaml", "/package-lock.json"], bins: ["pnpm", "npm"] }))
  assert.equal(r.state, "lockfile_conflict")
  assert.deepEqual([...r.locks].sort(), ["package-lock.json", "pnpm-lock.yaml"])
})

test("pnpm sem layout .pnpm em node_modules → node_modules_mismatch", async () => {
  const { resolvePackageManager } = await imp()
  const r = resolvePackageManager("/proj", io({ files: ["/node_modules"], json: { "package.json": { packageManager: "pnpm@1.0.0" } }, bins: ["pnpm"] }))
  assert.equal(r.state, "node_modules_mismatch")
})

test("pnpm ausente do PATH → missing_binary com reparo `npm install -g pnpm`", async () => {
  const { resolvePackageManager } = await imp()
  const r = resolvePackageManager("/proj", io({ json: { "package.json": { packageManager: "pnpm@1.0.0" } }, bins: [] }))
  assert.equal(r.state, "missing_binary")
  assert.match(r.repair, /npm install -g pnpm/)
})

test("sem package.json/lock → fallback npm (ok se npm presente)", async () => {
  const { resolvePackageManager } = await imp()
  const r = resolvePackageManager("/proj", io({ bins: ["npm"] }))
  assert.equal(r.pm, "npm"); assert.equal(r.source, "fallback (npm)"); assert.equal(r.state, "ok")
})

test("lockfile único define o PM quando não há packageManager field", async () => {
  const { resolvePackageManager } = await imp()
  const r = resolvePackageManager("/proj", io({ files: ["/pnpm-lock.yaml", "/node_modules", "/node_modules/.pnpm"], bins: ["pnpm"] }))
  assert.equal(r.pm, "pnpm"); assert.equal(r.state, "ok")
})
