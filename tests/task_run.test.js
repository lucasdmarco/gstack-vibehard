import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "task-run.js")

function git(cwd, ...args) { return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8" }) }

async function initRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-taskrun-"))
  git(dir, "init", "-b", "main")
  git(dir, "config", "user.email", "t@t.dev")
  git(dir, "config", "user.name", "t")
  git(dir, "config", "commit.gpgsign", "false")
  await writeFile(path.join(dir, "README.md"), "# repo\n")
  git(dir, "add", "-A"); git(dir, "commit", "-m", "init")
  return dir
}

async function writePlan(dir, id, steps) {
  const pd = path.join(dir, ".gstack", "tasks", id)
  await mkdir(pd, { recursive: true })
  await writeFile(path.join(pd, "task.json"), JSON.stringify({ id, request: "t", steps }, null, 2))
  return pd
}

async function runJson(args, cwd) {
  const { taskRunCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  try { taskRunCommand(args, { cwd }) } finally { process.stdout.write = orig }
  return JSON.parse(buf.trim())
}

// ── happy path REAL: passo edita arquivo → worktree → diff → hygiene clean → accept (branch commitado) ──
test("task run: passo limpo aceita e deixa branch pronto pra merge (sem auto-merge)", async () => {
  const dir = await initRepo()
  try {
    await writePlan(dir, "t1", [{ id: "s1", command: ["node", "-e", "require('fs').writeFileSync('feature.js','export const x = 1\\n')"] }])
    const r = await runJson(["run", "t1", "--yes", "--json"], dir)
    assert.equal(r.status, "done")
    assert.deepEqual(r.accepted, ["s1"])
    // o branch existe e contém o arquivo commitado (sem ter mergeado no main)
    const branches = git(dir, "branch", "--list", "task/t1-s1")
    assert.match(branches, /task\/t1-s1/)
    const filesInBranch = git(dir, "ls-tree", "-r", "--name-only", "task/t1-s1")
    assert.match(filesInBranch, /feature\.js/)
    // main NÃO foi tocado (sem auto-merge)
    assert.doesNotMatch(git(dir, "ls-tree", "-r", "--name-only", "main"), /feature\.js/)
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

// ── ABUSO: diff com `debugger` → diff-hygiene REJEITA (needs_review), branch descartado ──
test("task run: passo com `debugger` no diff é rejeitado (hygiene), não vira branch", async () => {
  const dir = await initRepo()
  try {
    await writePlan(dir, "t2", [{ id: "s1", command: ["node", "-e", "require('fs').writeFileSync('bad.js','export function f(){\\n  debugger\\n}\\n')"] }])
    const r = await runJson(["run", "t2", "--yes", "--json"], dir)
    assert.equal(r.accepted.length, 0, "nada aceito com hygiene fail")
    assert.equal(r.rejected[0].reason, "hygiene")
    // branch rejeitado foi removido
    assert.doesNotMatch(git(dir, "branch", "--list", "task/t2-s1"), /task\/t2-s1/)
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

// ── guarda: .env RASTREADO no git bloqueia o loop (segredo iria pra worktree) ──
test("task run: .env rastreado bloqueia (não roda o loop)", async () => {
  const dir = await initRepo()
  try {
    await writeFile(path.join(dir, ".env"), "SECRET=abc\n")
    git(dir, "add", "-f", ".env"); git(dir, "commit", "-m", "add env")
    await writePlan(dir, "t3", [{ id: "s1", command: ["node", "-e", "1"] }])
    const r = await runJson(["run", "t3", "--yes", "--json"], dir).catch(() => null)
    // sem worktree criado; saída de erro (não JSON de resultado) → r pode ser null/erro
    // valida que NENHUM branch task/ foi criado
    assert.doesNotMatch(git(dir, "branch", "--list", "task/*"), /task\//)
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})
