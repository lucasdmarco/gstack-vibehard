import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.2 — discovery READ-ONLY de projeto existente. Nunca escreve, nunca executa
// script do repositório, nunca lê .env*. Projeto desconhecido recebe diagnóstico, não chute.

function makeGitRepo(dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
}

test("discoverProject: projeto Node com scripts reais — detecta stack, dev/test/build, package manager", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-discovery-node-"))
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name: "x", scripts: { dev: "vite", test: "vitest", build: "vite build" },
    }))
    writeFileSync(path.join(dir, "package-lock.json"), "{}")
    makeGitRepo(dir)
    execFileSync("git", ["add", "-A"], { cwd: dir })
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir })
    const d = discoverProject(dir)
    assert.deepEqual(d.languages, ["javascript"])
    assert.equal(d.packageManager.pm, "npm")
    assert.equal(d.commands.dev, "vite")
    assert.equal(d.commands.test, "vitest")
    assert.equal(d.commands.build, "vite build")
    assert.equal(d.git.isRepo, true)
    assert.equal(d.git.dirty, false)
    assert.equal(d.gstackActivated, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("discoverProject: dirty tree é detectado (git real) e NUNCA descartado/tocado", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-discovery-dirty-"))
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }))
    makeGitRepo(dir)
    execFileSync("git", ["add", "-A"], { cwd: dir })
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir })
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { dev: "x" } }))
    const before = JSON.parse(String(await (await import("node:fs/promises")).readFile(path.join(dir, "package.json"))))
    const d = discoverProject(dir)
    assert.equal(d.git.dirty, true)
    const after = JSON.parse(String(await (await import("node:fs/promises")).readFile(path.join(dir, "package.json"))))
    assert.deepEqual(before, after, "discovery nunca altera o arquivo")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("discoverProject: monorepo (workspaces no package.json) é detectado", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-discovery-mono-"))
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", workspaces: ["apps/*"] }))
    mkdirSync(path.join(dir, "apps"))
    const d = discoverProject(dir)
    assert.equal(d.monorepo, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("discoverProject: projeto Python (requirements.txt) é reconhecido, nunca chutado como Node", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-discovery-py-"))
  try {
    writeFileSync(path.join(dir, "requirements.txt"), "flask\n")
    writeFileSync(path.join(dir, "app.py"), "print('hi')\n")
    const d = discoverProject(dir)
    assert.deepEqual(d.languages, ["python"])
    assert.equal(d.packageManager, null, "sem package.json, não inventa PM node")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("discoverProject: repo DESCONHECIDO (sem sinal nenhum) recebe diagnóstico honesto, nunca chute", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-discovery-unknown-"))
  try {
    writeFileSync(path.join(dir, "README.txt"), "nada aqui")
    const d = discoverProject(dir)
    assert.deepEqual(d.languages, [])
    assert.equal(d.commands.dev, null)
    assert.equal(d.recognized, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("discoverProject: projeto GStack já ativado é reconhecido (reusa classifyWorkspace)", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-discovery-gstack-"))
  try {
    mkdirSync(path.join(dir, ".gstack"))
    writeFileSync(path.join(dir, ".gstack", "app.json"), "{}")
    const d = discoverProject(dir)
    assert.equal(d.gstackActivated, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("discoverProject: NUNCA lê .env* (segurança — nem existência é reportada como conteúdo)", async () => {
  const { discoverProject } = await imp("src/onboarding/project-discovery.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-discovery-env-"))
  try {
    writeFileSync(path.join(dir, ".env"), "SECRET=abc123realvalue\n")
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }))
    const d = discoverProject(dir)
    assert.equal(JSON.stringify(d).includes("abc123realvalue"), false, "conteúdo de .env NUNCA aparece no discovery")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
