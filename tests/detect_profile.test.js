import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "project-plan", "detect-profile.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function fixture(pkg, files = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-arch-"))
  if (pkg) await writeFile(path.join(cwd, "package.json"), JSON.stringify(pkg))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(cwd, name), content)
  }
  return cwd
}

async function expectProfile(pkg, files, expected) {
  const cwd = await fixture(pkg, files)
  try {
    const { detectProfile } = await imp()
    const r = detectProfile(cwd)
    assert.equal(r.profile, expected, `esperava ${expected}, veio ${r.profile} (signals: ${r.signals})`)
    return r
  } finally { await rm(cwd, { recursive: true, force: true }) }
}

test("cli: package.json com bin → cli (e alsoLibrary quando publicável)", async () => {
  const r = await expectProfile({ name: "x", bin: { x: "src/i.js" }, main: "src/i.js" }, {}, "cli")
  assert.equal(r.alsoLibrary, true)
})

test("library: main/exports e não private → library", async () => {
  await expectProfile({ name: "x", main: "index.js" }, {}, "library")
  await expectProfile({ name: "x", exports: { ".": "./index.js" } }, {}, "library")
})

test("library NÃO classifica private:true sem outros sinais → unknown", async () => {
  await expectProfile({ name: "x", main: "index.js", private: true }, {}, "unknown")
})

test("web-app: dep de front (next/vite/react) → web-app", async () => {
  await expectProfile({ name: "x", dependencies: { next: "14" } }, {}, "web-app")
  await expectProfile({ name: "x", devDependencies: { vite: "5" }, bin: { x: "i" } }, {}, "web-app")
})

test("service: express/fastify ou Dockerfile → service", async () => {
  await expectProfile({ name: "x", dependencies: { express: "4" } }, {}, "service")
  await expectProfile({ name: "x", main: "i.js" }, { Dockerfile: "FROM node" }, "service")
})

test("mobile-backend: expo/react-native → mobile-backend", async () => {
  await expectProfile({ name: "x", dependencies: { expo: "50" } }, {}, "mobile-backend")
})

test("monorepo: workspaces ou turbo.json → monorepo (precede tudo)", async () => {
  await expectProfile({ name: "x", workspaces: ["packages/*"], dependencies: { next: "14" } }, {}, "monorepo")
  await expectProfile({ name: "x", bin: { x: "i" } }, { "turbo.json": "{}" }, "monorepo")
})

test("data-ml: Python sem package.json → data-ml", async () => {
  await expectProfile(null, { "requirements.txt": "numpy\n" }, "data-ml")
})

test("unknown: sem package.json e sem sinais → unknown", async () => {
  await expectProfile(null, {}, "unknown")
})

test("este repo (cli+library) é detectado como cli", async () => {
  const { detectProfile } = await imp()
  const r = detectProfile(repoRoot)
  assert.equal(r.profile, "cli")
  assert.equal(r.alsoLibrary, true)
})
