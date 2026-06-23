import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "project-plan", "publish-guard.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function repo(version, changelog) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pg-"))
  if (version !== undefined) await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "x", version }))
  if (changelog !== undefined) await writeFile(path.join(cwd, "CHANGELOG.md"), changelog)
  return cwd
}

// git mock: tags, status porcelain, branch configuráveis
function gitExec({ tags = [], porcelain = "", hasGh = false } = {}) {
  return (file, args) => {
    if (file === "git" && args[0] === "status") return porcelain
    if (file === "git" && args[0] === "tag") return tags.join("\n")
    if (file === "git" && args[0] === "rev-parse") return "master"
    if (file === "gh" && args[0] === "--version") { if (hasGh) return "gh 2"; throw new Error("no gh") }
    if (file === "gh" && args[0] === "run") return "success"
    return ""
  }
}

test("publish-guard: tudo ok → pass (tag ausente vira warning, não bloqueia)", async () => {
  const cwd = await repo("2.29.0", "## [2.29.0]\nnovo")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v2.28.1"] }) })
    assert.equal(r.status, "pass")
    assert.deepEqual(r.failed, [])
    assert.ok(r.warnings.includes("tag-exists"), "tag ainda não existe → warning")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: working tree suja → fail", async () => {
  const cwd = await repo("2.29.0", "## [2.29.0]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v2.28.1"], porcelain: " M src/a.js\n?? b.js" }) })
    assert.equal(r.status, "fail")
    assert.ok(r.failed.includes("tree-clean"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: versão não bumpada vs última tag → fail", async () => {
  const cwd = await repo("2.28.1", "## [2.28.1]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v2.28.1", "v2.28.0"] }) })
    assert.equal(r.status, "fail")
    assert.ok(r.failed.includes("version-bump"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: CHANGELOG sem entrada da versão → fail", async () => {
  const cwd = await repo("2.29.0", "## [2.28.1]\nvelho")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v2.28.1"] }) })
    assert.equal(r.status, "fail")
    assert.ok(r.failed.includes("changelog-entry"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: primeira release (sem tags) → version-bump passa", async () => {
  const cwd = await repo("0.1.0", "## [0.1.0]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: [] }) })
    assert.equal(r.status, "pass")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: sem package.json version → fail imediato", async () => {
  const cwd = await repo(undefined, "x")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({}) })
    assert.equal(r.status, "fail")
    assert.ok(r.failed.includes("package-version"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: gh presente e CI success → ci-green passed", async () => {
  const cwd = await repo("2.29.0", "## [2.29.0]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v2.28.1"], hasGh: true }) })
    const ci = r.checks.find((c) => c.id === "ci-green")
    assert.equal(ci.status, "passed")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: qg.py sincronizado com a versão → qg-version passed", async () => {
  const cwd = await repo("3.0.17", "## [3.0.17]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v3.0.16"] }), readQgVersion: () => "3.0.17" })
    assert.equal(r.status, "pass")
    assert.equal(r.checks.find((c) => c.id === "qg-version").status, "passed")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: qg.py divergente do package → fail HARD (bloqueia release)", async () => {
  const cwd = await repo("3.0.17", "## [3.0.17]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v3.0.16"] }), readQgVersion: () => "3.0.3" })
    assert.equal(r.status, "fail")
    assert.ok(r.failed.includes("qg-version"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: sem qg.py → qg-version not_applicable (não bloqueia)", async () => {
  const cwd = await repo("3.0.17", "## [3.0.17]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v3.0.16"] }), readQgVersion: () => null })
    assert.equal(r.status, "pass")
    assert.equal(r.checks.find((c) => c.id === "qg-version").status, "not_applicable")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
