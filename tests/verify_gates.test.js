import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const runnerMod = path.join(repoRoot, "src", "project-plan", "verify-runner.js")
const cmdMod = path.join(repoRoot, "src", "commands", "verify.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

async function projectWith(scripts) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-verify-"))
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "x", scripts }))
  return cwd
}

test("runVerify: gates ausentes viram not_applicable, presentes rodam; runtime é pending", async () => {
  const cwd = await projectWith({ lint: "x", test: "x" }) // sem typecheck/build
  try {
    const { runVerify } = await imp(runnerMod)
    const ran = []
    const r = runVerify({ cwd, profile: "full", home: cwd, exec: (f, a) => ran.push([f, ...a].join(" ")) })
    const byId = Object.fromEntries(r.steps.map((s) => [s.id, s.status]))
    assert.equal(byId.lint, "passed")
    assert.equal(byId.test, "passed")
    assert.equal(byId.typecheck, "not_applicable", "sem script typecheck")
    assert.equal(byId.build, "not_applicable")
    assert.equal(byId["runtime:start"], "pending_feature")
    assert.equal(byId["qg-l1"], "not_applicable", "sem hook qg neste HOME")
    assert.equal(r.ready, true, "nada falhou")
    assert.ok(ran.some((c) => c.includes("npm run lint")))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("runVerify: gate que falha → ready=false e id em failed", async () => {
  const cwd = await projectWith({ lint: "x" })
  try {
    const { runVerify } = await imp(runnerMod)
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, exec: (f, a) => { if (a.includes("lint")) throw new Error("eslint: 3 erros\nstack") } })
    assert.equal(r.ready, false)
    assert.ok(r.failed.includes("lint"))
    const lint = r.steps.find((s) => s.id === "lint")
    assert.ok(!lint.detail.includes("stack"), "só primeira linha do erro")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verifyCommand --json: persiste verify.json e emite JSON puro", async () => {
  const cwd = await projectWith({ test: "x" })
  try {
    const { verifyCommand } = await imp(cmdMod)
    let buf = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf += String(s); return true }
    try { await verifyCommand(["--json", "--profile", "scaffold"], { cwd, home: cwd, runId: "run1", exec: () => {} }) }
    finally { process.stdout.write = orig }
    const out = JSON.parse(buf.trim())
    assert.equal(out.runId, "run1")
    assert.equal(out.ready, true)
    assert.ok(existsSync(path.join(cwd, ".gstack", "runs", "run1", "verify.json")))
    const saved = JSON.parse(readFileSync(path.join(cwd, ".gstack", "runs", "run1", "verify.json"), "utf-8"))
    assert.equal(saved.profile, "scaffold")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
