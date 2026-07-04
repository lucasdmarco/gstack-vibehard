import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmMod = path.join(repoRoot, "src", "installer", "clean-machine.js")
const toolsMod = path.join(repoRoot, "src", "commands", "tools.js")
const imp = (p) => import(`${pathToFileURL(p)}?t=${Date.now()}`)

async function freshRoot() {
  const r = await mkdtemp(path.join(tmpdir(), "gstack-cmtest-"))
  return r
}

test("clean-machine proof pack: 12 cenários passam, contra homes-fixture isoladas", async () => {
  const { runCleanMachine } = await imp(cmMod)
  const root = await freshRoot()
  try {
    const rep = runCleanMachine({ rootFactory: () => root, keep: true, write: false, runId: "cm-test" })
    assert.equal(rep.ok, true, "todas as invariantes provadas")
    assert.equal(rep.total, 12)
    assert.equal(rep.passed, 12)
    // as fixtures ficam sob o root injetado — nunca sob o ~ real
    assert.ok(existsSync(path.join(root, "oc-conflict")), "fixture criada sob o root injetado")
    for (const s of rep.scenarios) {
      const failed = s.checks.filter((c) => !c.ok).map((c) => c.name)
      assert.equal(s.ok, true, `${s.id} falhou: ${failed.join(", ")}`)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("OpenCode config-sacred: conflito com chaves sensíveis nunca é consolidado (byte-for-byte)", async () => {
  const { runCleanMachine } = await imp(cmMod)
  const root = await freshRoot()
  try {
    const rep = runCleanMachine({ rootFactory: () => root, write: false })
    const sc = rep.scenarios.find((s) => s.id === "opencode-conflict-sensitive")
    assert.ok(sc && sc.ok)
    assert.equal(sc.evidence.diagnosis.shadowingRisk, "high")
    const preserve = rep.scenarios.find((s) => s.id === "opencode-jsonc-sensitive")
    assert.ok(preserve.checks.find((c) => c.name === "jsonc intocado byte-for-byte").ok)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("uninstall restaura configs preexistentes byte-for-byte (rollback report sem erros)", async () => {
  const { runCleanMachine } = await imp(cmMod)
  const root = await freshRoot()
  try {
    const rep = runCleanMachine({ rootFactory: () => root, write: false })
    const sc = rep.scenarios.find((s) => s.id === "uninstall-restore-byte-for-byte")
    assert.ok(sc.ok, "restore byte-for-byte")
    assert.equal(sc.evidence.rollbackReport.errors.length, 0)
    assert.ok(sc.evidence.rollbackReport.restored.length >= 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("matriz de estados: Headroom/Graphify/Fallow classificam corretamente", async () => {
  const { runCleanMachine } = await imp(cmMod)
  const root = await freshRoot()
  try {
    const rep = runCleanMachine({ rootFactory: () => root, write: false })
    for (const id of ["headroom-matrix", "graphify-matrix", "fallow-matrix"]) {
      assert.ok(rep.scenarios.find((s) => s.id === id).ok, `${id} ok`)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("tools clean-machine --json: saída JSON pura + artefatos project-scoped", async () => {
  const { toolsCommand } = await imp(toolsMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-cmcli-"))
  await mkdir(cwd, { recursive: true })
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try {
    await toolsCommand(["clean-machine", "--json"], { cwd })
  } finally { process.stdout.write = orig }
  const parsed = JSON.parse(buf.trim()) // JSON PURO
  assert.equal(parsed.ok, true)
  assert.ok(parsed.writtenTo)
  const names = ["clean-machine.json", "tool-readiness.json", "install-impact.json", "opencode-diagnosis.json", "rollback-report.json", "verify.json"]
  for (const n of names) assert.ok(existsSync(path.join(parsed.writtenTo, n)), `artefato ${n}`)
  // tool-readiness gerado em modo clean-machine e honesto
  const tr = JSON.parse(readFileSync(path.join(parsed.writtenTo, "tool-readiness.json"), "utf-8"))
  assert.equal(tr.cleanMachine, true)
  assert.equal(tr.guardrails.envFilesTouched, false)
  await rm(cwd, { recursive: true, force: true })
})
