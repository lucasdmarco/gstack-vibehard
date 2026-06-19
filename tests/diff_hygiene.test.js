import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "project-plan", "diff-hygiene.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function withFiles(files) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-dh-"))
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.join(cwd, path.dirname(rel)), { recursive: true })
    await writeFile(path.join(cwd, rel), content)
  }
  return cwd
}

test("diff-hygiene: pega debugger em código fonte (HIGH → fail)", async () => {
  const cwd = await withFiles({ "src/a.js": "function f(){\n  debugger\n  return 1\n}\n" })
  try {
    const { diffHygiene } = await imp()
    const r = diffHygiene({ cwd, files: ["src/a.js"] })
    assert.equal(r.status, "fail")
    assert.ok(r.findings.some((f) => f.rule === "debugger" && f.line === 2))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("diff-hygiene: pega segredo hardcoded (AWS key)", async () => {
  const cwd = await withFiles({ "src/cfg.js": "const k = 'AKIAIOSFODNN7EXAMPLE'\n" })
  try {
    const { diffHygiene } = await imp()
    const r = diffHygiene({ cwd, files: ["src/cfg.js"] })
    assert.equal(r.status, "fail")
    assert.ok(r.findings.some((f) => f.rule === "aws-key"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("diff-hygiene: .only em teste é HIGH", async () => {
  const cwd = await withFiles({ "tests/x.test.js": "test.only('a', () => {})\n" })
  try {
    const { diffHygiene } = await imp()
    const r = diffHygiene({ cwd, files: ["tests/x.test.js"] })
    assert.ok(r.findings.some((f) => f.rule === "test-only" && f.severity === "HIGH"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("diff-hygiene: catch vazio é MEDIUM (warn, não fail)", async () => {
  const cwd = await withFiles({ "src/b.js": "try { x() } catch {}\n" })
  try {
    const { diffHygiene } = await imp()
    const r = diffHygiene({ cwd, files: ["src/b.js"] })
    assert.equal(r.status, "warn")
    assert.ok(r.findings.some((f) => f.rule === "empty-catch"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("diff-hygiene: NÃO flagra console.log (produto de CLI) nem catch com comentário", async () => {
  const cwd = await withFiles({ "src/cli.js": "console.log('hi')\ntry { x() } catch { /* best-effort */ }\n" })
  try {
    const { diffHygiene } = await imp()
    const r = diffHygiene({ cwd, files: ["src/cli.js"] })
    assert.equal(r.status, "clean")
    assert.equal(r.findings.length, 0)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("diff-hygiene: ignora arquivos não-fonte e node_modules", async () => {
  const cwd = await withFiles({ "README.md": "debugger", "node_modules/x/a.js": "debugger" })
  try {
    const { diffHygiene } = await imp()
    const r = diffHygiene({ cwd, files: ["README.md", "node_modules/x/a.js"] })
    assert.equal(r.status, "clean")
    assert.equal(r.scannedFiles.length, 0)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("diff-hygiene: descobre arquivos via git status --porcelain (exec injetado)", async () => {
  const cwd = await withFiles({ "src/c.js": "debugger\n" })
  try {
    const { diffHygiene } = await imp()
    const exec = (file, args) => {
      if (file === "git" && args[0] === "status") return " M src/c.js\n?? other.txt\n"
      return ""
    }
    const r = diffHygiene({ cwd, exec })
    assert.ok(r.scannedFiles.includes("src/c.js"))
    assert.ok(r.findings.some((f) => f.rule === "debugger"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
