import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// exec fake: git status devolve `porcelain`; qualquer outro comando registra e passa/falha.
function makeExec({ porcelain = "", failIds = [] } = {}) {
  const calls = []
  const exec = (file, args) => {
    if (file === "git" && args[0] === "status") return Buffer.from(porcelain)
    calls.push([file, ...args].join(" "))
    const target = args[args.length - 1]
    if (failIds.some((f) => String(target).includes(f) || args.includes(f))) { const e = new Error("check falhou"); e.status = 1; throw e }
    return Buffer.from("")
  }
  return { exec, calls }
}

test("changed-files: nada alterado → clean, zero steps", async () => {
  const { runChangedFilesVerify } = await imp("src/project-plan/changed-files.js")
  const m = makeExec({ porcelain: "" })
  const r = runChangedFilesVerify({ cwd: "/x", exec: m.exec })
  assert.equal(r.status, "clean")
  assert.equal(r.steps.length, 0)
  assert.equal(m.calls.length, 0, "não roda nenhum check")
})

test("changed-files: sem git → fallback declarado (não inventa resultado)", async () => {
  const { runChangedFilesVerify } = await imp("src/project-plan/changed-files.js")
  const r = runChangedFilesVerify({ cwd: "/x", exec: () => { throw new Error("not a git repo") } })
  assert.equal(r.status, "fallback")
  assert.equal(r.fallback, "full")
})

test("changed-files: só docs → ready sem gates de código", async () => {
  const { runChangedFilesVerify } = await imp("src/project-plan/changed-files.js")
  const m = makeExec({ porcelain: " M README.md\n M docs/guia.md\n" })
  const r = runChangedFilesVerify({ cwd: "/x", exec: m.exec })
  assert.equal(r.status, "ready")
  assert.equal(r.steps[0].id, "docs-only")
  assert.equal(m.calls.length, 0)
})

test("changed-files: js alterado → node --check por arquivo; teste alterado roda SÓ ele", async () => {
  const { runChangedFilesVerify } = await imp("src/project-plan/changed-files.js")
  const m = makeExec({ porcelain: " M src/a.js\n M tests/b.test.js\nR  old.js -> src/c.js\n" })
  const r = runChangedFilesVerify({ cwd: "/x", exec: m.exec })
  assert.equal(r.status, "ready")
  assert.ok(m.calls.some((c) => c.includes("--check src/a.js")))
  assert.ok(m.calls.some((c) => c.includes("--check src/c.js")), "rename usa o destino")
  assert.ok(m.calls.some((c) => c.includes("--test") && c.includes("tests/b.test.js")), "só o teste alterado")
  assert.ok(!m.calls.some((c) => c.includes("npm")), "não roda a suíte inteira")
  assert.match(r.note, /NÃO substitui/)
})

test("changed-files: check falhando → blocked com failed nomeado", async () => {
  const { runChangedFilesVerify } = await imp("src/project-plan/changed-files.js")
  const m = makeExec({ porcelain: " M src/quebrado.js\n", failIds: ["quebrado"] })
  const r = runChangedFilesVerify({ cwd: "/x", exec: m.exec })
  assert.equal(r.status, "blocked")
  assert.deepEqual(r.failed, ["syntax:src/quebrado.js"])
})

test("verify --changed-files --json: stdout é JSON PURO", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cf-"))
  try {
    await writeFile(path.join(cwd, "x.md"), "# doc")
    const { verifyCommand } = await imp("src/commands/verify.js")
    const m = makeExec({ porcelain: " M x.md\n" })
    let out = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { out += s; return true }
    try { await verifyCommand(["--changed-files", "--json"], { cwd, exec: m.exec }) }
    finally { process.stdout.write = orig }
    const parsed = JSON.parse(out.trim())
    assert.equal(parsed.mode, "changed_files")
    assert.equal(parsed.status, "ready")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
