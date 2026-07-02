import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "orchestrate.js")
const provMod = path.join(repoRoot, "src", "vfa", "provenance.js")
function git(cwd, ...a) { return execFileSync("git", a, { cwd, stdio: "pipe", encoding: "utf-8" }) }

async function initRepo(steps) {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-orch-"))
  git(dir, "init", "-b", "main"); git(dir, "config", "user.email", "t@t.dev"); git(dir, "config", "user.name", "t"); git(dir, "config", "commit.gpgsign", "false")
  await writeFile(path.join(dir, "r.md"), "# r\n"); git(dir, "add", "-A"); git(dir, "commit", "-m", "init")
  await mkdir(path.join(dir, ".gstack", "tasks", "p1"), { recursive: true })
  await writeFile(path.join(dir, ".gstack", "tasks", "p1", "task.json"), JSON.stringify({ id: "p1", steps }))
  return dir
}
async function runJson(args, cwd) {
  const { orchestrateCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  let buf = ""; const orig = process.stdout.write.bind(process.stdout); const prev = process.exitCode
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await orchestrateCommand(args, { cwd }) } finally { process.stdout.write = orig; process.exitCode = prev }
  return JSON.parse(buf.trim())
}

// ── e2e: passo limpo → passed (executor≠verifier), branch sem auto-merge; provenance gravado ──
test("orchestrate: passo limpo → passed com verifier independente; branch pronto, main intocado", async () => {
  const dir = await initRepo([{ id: "s1", command: ["node", "-e", "require('fs').writeFileSync('feat.js','export const x=1\\n')"] }])
  try {
    const r = await runJson(["p1", "--yes", "--json"], dir)
    assert.equal(r.steps[0].status, "passed")
    assert.notEqual(r.steps[0].executor, r.steps[0].verifier, "executor ≠ verifier")
    assert.match(git(dir, "branch", "--list", "orch/p1-s1"), /orch\/p1-s1/)
    assert.doesNotMatch(git(dir, "ls-tree", "-r", "--name-only", "main"), /feat\.js/, "sem auto-merge")
    // provenance separa advisory de gate
    const { readRun } = await import(`${pathToFileURL(provMod)}?t=${Date.now()}`)
    const intents = readRun(dir, "p1").map((x) => x.intent)
    assert.ok(intents.includes("orchestrate:llm_review_advisory"))
    assert.ok(intents.includes("orchestrate:deterministic_gate"))
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

// ── DoD: gate determinístico falha (debugger) → NÃO passa, branch descartado ──
test("orchestrate: passo com `debugger` → gate falha (failed), sem branch", async () => {
  const dir = await initRepo([{ id: "s1", command: ["node", "-e", "require('fs').writeFileSync('bad.js','export function f(){\\n  debugger\\n}\\n')"] }])
  try {
    const r = await runJson(["p1", "--yes", "--json"], dir)
    assert.equal(r.steps[0].status, "failed")
    assert.notEqual(r.status, "done")
    assert.doesNotMatch(git(dir, "branch", "--list", "orch/p1-s1"), /orch\/p1-s1/, "branch descartado")
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})
