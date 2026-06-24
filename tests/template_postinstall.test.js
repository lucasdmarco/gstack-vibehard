import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const tplRoot = path.join(repoRoot, "templates", "templates", "fullstack-monorepo")
const script = path.join(tplRoot, "scripts", "postinstall-fallow.mjs")

test("template postinstall existe e o package.json o referencia (não usa `|| true`)", () => {
  assert.ok(existsSync(script), "postinstall-fallow.mjs presente no template")
  const pkg = JSON.parse(readFileSync(path.join(tplRoot, "package.json"), "utf-8"))
  assert.equal(pkg.scripts.postinstall, "node scripts/postinstall-fallow.mjs")
  assert.doesNotMatch(pkg.scripts.postinstall, /\|\| true/, "sem `|| true` (quebrava no cmd.exe)")
})

test("template postinstall SEMPRE sai com exit 0 (não quebra o pnpm install no Windows)", () => {
  // Com ou sem fallow no PATH, o postinstall nunca pode falhar o install do projeto.
  const r = spawnSync(process.execPath, [script], { encoding: "utf-8", timeout: 30000 })
  assert.equal(r.status, 0, `esperado exit 0, veio ${r.status}: ${r.stderr || ""}`)
})
