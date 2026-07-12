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

// git/gh mock via TABELA de rotas (cc baixo). `remote` vazio por padrão →
// release-source-parity fica not_applicable (não interfere nos casos legados);
// `parity` liga o cenário de paridade real.
function ghRoute(hasGh) {
  return [
    [(f, a) => f === "gh" && a[0] === "--version", () => { if (hasGh) return "gh 2"; throw new Error("no gh") }],
    [(f, a) => f === "gh" && a[0] === "run", () => "success"],
  ]
}
function parityRoute(parity) {
  const p = parity || {}
  return [
    [(f, a) => f === "git" && a[0] === "remote" && a.length === 1, () => (parity ? "origin" : "")],
    [(f, a) => parity && f === "git" && a.join(" ").startsWith("branch -r --contains"), () => p.contains ?? "origin/master"],
    [(f, a) => parity && f === "git" && a.join(" ").startsWith("rev-list --count"), () => p.ahead ?? "0"],
    [(f, a) => parity && f === "git" && a[0] === "rev-parse" && a[1] !== "HEAD", () => p.tagLocal ?? "master"],
    [(f, a) => parity && f === "git" && a[0] === "ls-remote", () => p.tagRemote ?? "master\trefs/tags/vX"],
  ]
}
function gitExec({ tags = [], porcelain = "", hasGh = false, parity = null } = {}) {
  const routes = [
    [(f, a) => f === "git" && a[0] === "status", () => porcelain],
    [(f, a) => f === "git" && a[0] === "tag", () => tags.join("\n")],
    [(f, a) => f === "git" && a[0] === "rev-parse" && a[1] === "HEAD", () => "master"],
    ...ghRoute(hasGh),
    ...parityRoute(parity),
  ]
  return (file, args) => {
    const hit = routes.find(([match]) => match(file, args))
    return hit ? hit[1]() : ""
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
    // PRD25 25.1: detalhe ACIONÁVEL — lista os arquivos, não só a contagem
    const detail = r.checks.find((c) => c.id === "tree-clean").detail
    assert.match(detail, /M src\/a\.js/, "lista o arquivo modificado")
    assert.match(detail, /\?\? b\.js/, "lista o untracked")
    assert.match(detail, /nada é apagado/, "reporta estado sem ameaçar apagar")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: tree suja com >5 arquivos → lista 5 e resume o resto", async () => {
  const cwd = await repo("2.29.0", "## [2.29.0]")
  try {
    const { publishGuard } = await imp()
    const many = Array.from({ length: 7 }, (_, i) => `?? f${i}.js`).join("\n")
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v2.28.1"], porcelain: many }) })
    const detail = r.checks.find((c) => c.id === "tree-clean").detail
    assert.match(detail, /7 arquivo/)
    assert.match(detail, /\(\+2\)/, "resume os 2 além dos 5 listados")
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

test("publish-guard: sem remoto → release-source-parity not_applicable (casos legados intactos)", async () => {
  const cwd = await repo("2.29.0", "## [2.29.0]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v2.28.1"] }) })
    assert.equal(r.checks.find((c) => c.id === "release-source-parity").status, "not_applicable")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: DEFEITO v4.0.0 — commit fora do remoto → fail HARD (bloqueia publish)", async () => {
  const cwd = await repo("4.0.1", "## [4.0.1]")
  try {
    const { publishGuard } = await imp()
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v4.0.0"], parity: { contains: "" } }), readQgVersion: () => "4.0.1" })
    assert.equal(r.status, "fail")
    assert.ok(r.failed.includes("release-source-parity"), "paridade fonte↔release bloqueia")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: paridade completa (commit no remoto + tag corresponde) → pass", async () => {
  const cwd = await repo("4.0.1", "## [4.0.1]")
  try {
    const { publishGuard } = await imp()
    const parity = { contains: "origin/master", ahead: "0", tagLocal: "deadbeef", tagRemote: "deadbeef\trefs/tags/v4.0.1" }
    const r = publishGuard({ cwd, exec: gitExec({ tags: ["v4.0.0"], parity }), readQgVersion: () => "4.0.1" })
    assert.equal(r.checks.find((c) => c.id === "release-source-parity").status, "passed")
    assert.equal(r.status, "pass")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
