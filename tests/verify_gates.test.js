import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, copyFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const runnerMod = path.join(repoRoot, "src", "project-plan", "verify-runner.js")
const cmdMod = path.join(repoRoot, "src", "commands", "verify.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

async function projectWith(scripts, extra = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-verify-"))
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "x", scripts }))
  if (extra.qg) {
    await mkdir(path.join(cwd, ".gstack", "hooks"), { recursive: true })
    // Copia o qg.py EMPACOTADO → instalado == empacotado, sem drift (P0.1).
    if (extra.qgDrift) await writeFile(path.join(cwd, ".gstack", "hooks", "qg.py"), "# qg antigo divergente\n")
    else await copyFile(path.join(repoRoot, "hooks", "hooks", "qg.py"), path.join(cwd, ".gstack", "hooks", "qg.py"))
  }
  return cwd
}

test("verify: QG ausente → tool_missing e status ready_with_warnings (não silencioso)", async () => {
  const cwd = await projectWith({ lint: "x", test: "x" })
  try {
    const { runVerify } = await imp(runnerMod)
    const r = runVerify({ cwd, profile: "full", home: cwd, exec: () => {} })
    const byId = Object.fromEntries(r.steps.map((s) => [s.id, s.status]))
    assert.equal(byId.lint, "passed")
    assert.equal(byId.test, "passed")
    assert.equal(byId.qg, "tool_missing", "Fallow/QG ausente vira tool_missing")
    assert.equal(r.status, "ready_with_warnings")
    assert.equal(r.ready, false, "ready ESTRITO: false sem ferramenta de confiança")
    assert.equal(r.usable, true, "usable: sem blockers")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: qualquer gate que falha → blocked, ready=false", async () => {
  const cwd = await projectWith({ lint: "x", test: "x" }, { qg: true })
  try {
    const { runVerify } = await imp(runnerMod)
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, exec: (f, a) => { if (a.includes("lint")) throw new Error("eslint: erro\nstack") } })
    assert.equal(r.status, "blocked")
    assert.equal(r.ready, false)
    assert.ok(r.failed.includes("lint"))
    assert.ok(!r.steps.find((s) => s.id === "lint").detail.includes("stack"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: projeto que roda (start/dev) com runtime pendente → pending_product", async () => {
  const cwd = await projectWith({ test: "x", start: "node ." }, { qg: true })
  try {
    const { runVerify } = await imp(runnerMod)
    const r = runVerify({ cwd, profile: "full", home: cwd, exec: () => {} })
    assert.equal(r.status, "pending_product", "tem start mas runtime/preview não existem")
    assert.equal(r.ready, false, "não é pronto com produto pendente")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: tudo passa, QG presente, sem app → ready", async () => {
  const cwd = await projectWith({ test: "x" }, { qg: true })
  try {
    const { runVerify } = await imp(runnerMod)
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, exec: () => {} })
    assert.equal(r.status, "ready")
    assert.equal(r.ready, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: reducedTrust quando harness é best-effort (ex.: hermes)", async () => {
  const cwd = await projectWith({ test: "x" }, { qg: true })
  try {
    const { runVerify } = await imp(runnerMod)
    const strong = runVerify({ cwd, profile: "scaffold", home: cwd, harness: "claude", exec: () => {} })
    const weak = runVerify({ cwd, profile: "scaffold", home: cwd, harness: "hermes", exec: () => {} })
    assert.equal(strong.reducedTrust, false)
    assert.equal(weak.reducedTrust, true)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: reporta qg.version/hash/origin e qgDrift=false quando QG == empacotado", async () => {
  const cwd = await projectWith({ test: "x" }, { qg: true })
  try {
    const { runVerify } = await imp(runnerMod)
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, exec: () => {} })
    assert.equal(r.qgDrift, false)
    assert.equal(r.qg.origin, "gstack")
    assert.ok(r.qg.version, "reporta a versão do QG")
    assert.ok(String(r.qg.hash).startsWith("sha256:"))
    assert.equal(r.status, "ready")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify: QG instalado DIVERGENTE do empacotado → qgDrift e ready_with_warnings (não ready silencioso)", async () => {
  const cwd = await projectWith({ test: "x" }, { qg: true, qgDrift: true })
  try {
    const { runVerify } = await imp(runnerMod)
    const r = runVerify({ cwd, profile: "scaffold", home: cwd, exec: () => {} })
    assert.equal(r.qgDrift, true)
    assert.equal(r.status, "ready_with_warnings")
    assert.equal(r.ready, false, "não é ready silencioso com drift de QG")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verify --quick: pula install/test/typecheck/build e qg-l2; segunda run = cache_hit", async () => {
  const cwd = await projectWith({ test: "x", lint: "x", typecheck: "x", build: "x" }, { qg: true })
  try {
    const { runVerify } = await imp(runnerMod)
    const r1 = runVerify({ cwd, profile: "quick", home: cwd, exec: () => {} })
    const ids = Object.fromEntries(r1.steps.map((s) => [s.id, s.status]))
    assert.equal(ids.test, "not_applicable", "quick pula a suíte")
    assert.equal(ids.deps, "passed", "quick checa deps (npm ls), não install")
    assert.ok(!r1.steps.find((s) => s.id === "qg-l2"), "quick não roda QG L2")
    assert.ok(r1.steps.find((s) => s.id === "qg-l1"), "quick roda QG L1")
    // segunda run sem mudanças → cache_hit
    const r2 = runVerify({ cwd, profile: "quick", home: cwd, exec: () => { throw new Error("não deveria reexecutar gate no cache") } })
    assert.equal(r2.cached, true)
    assert.ok(r2.steps.every((s) => s.status === "cache_hit"))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("verifyCommand --json: persiste verify.json com status", async () => {
  const cwd = await projectWith({ test: "x" }, { qg: true })
  try {
    const { verifyCommand } = await imp(cmdMod)
    let buf = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf += String(s); return true }
    try { await verifyCommand(["--json", "--profile", "scaffold"], { cwd, home: cwd, runId: "run1", exec: () => {} }) }
    finally { process.stdout.write = orig }
    const out = JSON.parse(buf.trim())
    assert.equal(out.runId, "run1")
    assert.equal(out.status, "ready")
    assert.ok(existsSync(path.join(cwd, ".gstack", "runs", "run1", "verify.json")))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
