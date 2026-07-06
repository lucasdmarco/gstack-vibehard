import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const runnerMod = path.join(repoRoot, "src", "dream", "runner.js")
const cmdMod = path.join(repoRoot, "src", "commands", "dream.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

// audit fake determinístico: 1 claim não-REAL → 1 item de plano.
const fakeAudit = () => ({
  claims: [
    { id: "x-real", status: "REAL", severity: "P2", missing: [] },
    { id: "x-gap", status: "PARTIAL", severity: "P1", missing: ["coisa faltante"] },
  ],
  summary: { REAL: 1, PARTIAL: 1, PLACEBO: 0, ROADMAP: 0, RISK: 0 },
})

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  return { restore: () => { process.stdout.write = orig }, get: () => buf }
}

test("dream improve --dry-run: gera plano determinístico SEM escrever nada", async () => {
  const { dreamImprove } = await imp(runnerMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-di-"))
  try {
    const r = dreamImprove({ cwd, dryRun: true, deps: { audit: fakeAudit } })
    assert.equal(r.mode, "dry-run")
    assert.equal(r.plan.items.length, 1, "só o claim não-REAL vira item")
    assert.equal(r.plan.items[0].id, "x-gap")
    assert.equal(existsSync(path.join(cwd, ".gstack")), false, "dry-run não escreve NADA")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("dream improve sem executor: proposta gravada (não falha opaco), provenance ok", async () => {
  const { dreamImprove, improveDir } = await imp(runnerMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-di-"))
  try {
    const r = dreamImprove({ cwd, deps: { audit: fakeAudit } })
    assert.equal(r.mode, "proposal")
    assert.ok(existsSync(r.file), "proposta gravada em .gstack/dream/improve/")
    assert.match(r.note, /nenhum executor configurado/i, "explica em vez de falhar opaco")
    const files = await readdir(improveDir(cwd))
    assert.equal(files.length, 1)
    // provenance best-effort gravado
    assert.ok(existsSync(path.join(cwd, ".gstack", "provenance", "actions.jsonl")))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("dream improve com executor: worktree → verify → proposta revisável, NUNCA merge", async () => {
  const { dreamImprove } = await imp(runnerMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-di-"))
  try {
    const calls = []
    const wtDir = path.join(cwd, "fake-wt")
    await mkdir(wtDir, { recursive: true })
    const deps = {
      audit: fakeAudit,
      executor: ({ cwd: xcwd, plan }) => { calls.push(["executor", xcwd]); return { changed: 1, items: plan.items.length } },
      verify: ({ cwd: vcwd }) => { calls.push(["verify", vcwd]); return { status: "ready", ready: true } },
      worktree: {
        create: (repo, o) => { calls.push(["create", o.branch]); return { dir: wtDir, branch: o.branch } },
        commit: (dir, msg) => calls.push(["commit", dir]),
        remove: (repo, dir, branch, o) => calls.push(["remove", branch, o.keepBranch]),
      },
    }
    const r = dreamImprove({ cwd, runId: "t1", deps })
    assert.equal(r.mode, "executed")
    assert.equal(r.merged, false, "NUNCA auto-merge")
    assert.equal(r.verify.status, "ready", "gate final é o verify")
    assert.match(r.branch, /^gstack\/dream-improve-/)
    // ordem: worktree criada → executor DENTRO dela → commit → verify DENTRO dela → remove preservando branch
    assert.deepEqual(calls.map((c) => c[0]), ["create", "executor", "commit", "verify", "remove"])
    assert.equal(calls[1][1], wtDir, "executor roda NA worktree, não no repo")
    assert.equal(calls[3][1], wtDir, "verify roda NA worktree")
    assert.equal(calls[4][2], true, "branch PRESERVADO para review humano (keepBranch)")
    assert.ok(existsSync(r.file), "proposta revisável gravada")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("dream improve com executor: worktree é removida mesmo se o executor lançar", async () => {
  const { dreamImprove } = await imp(runnerMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-di-"))
  try {
    const calls = []
    const deps = {
      audit: fakeAudit,
      executor: () => { throw new Error("executor quebrou") },
      verify: () => ({ status: "ready", ready: true }),
      worktree: {
        create: (repo, o) => { calls.push("create"); return { dir: path.join(cwd, "wt"), branch: o.branch } },
        commit: () => calls.push("commit"),
        remove: () => calls.push("remove"),
      },
    }
    assert.throws(() => dreamImprove({ cwd, deps }), /executor quebrou/)
    assert.ok(calls.includes("remove"), "cleanup da worktree roda mesmo em falha")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("CLI dream improve --dry-run --json: JSON puro com plano", async () => {
  const { dreamCommand } = await imp(cmdMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-di-"))
  try {
    const cap = captureStdout()
    try { await dreamCommand(["improve", "--dry-run", "--json"], { cwd, improveDeps: { audit: fakeAudit } }) } finally { cap.restore() }
    const out = JSON.parse(cap.get().trim())
    assert.equal(out.mode, "dry-run")
    assert.ok(Array.isArray(out.plan.items))
    assert.equal(out.plan.source, "deterministic (dream audit + staging)")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("plano inclui propostas em staging (promoted) aguardando o corpus", async () => {
  const { buildImprovePlan } = await imp(runnerMod)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-di-"))
  try {
    await mkdir(path.join(cwd, ".gstack", "dream", "promoted"), { recursive: true })
    await writeFile(path.join(cwd, ".gstack", "dream", "promoted", "lesson-a.md"), "# lição\n")
    const plan = buildImprovePlan(cwd, { audit: fakeAudit })
    const staged = plan.items.filter((i) => i.kind === "staged_proposal")
    assert.equal(staged.length, 1)
    assert.match(staged[0].action, /manualmente.*core\/knowledge|core\/knowledge/i, "mover para o corpus é decisão humana")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
