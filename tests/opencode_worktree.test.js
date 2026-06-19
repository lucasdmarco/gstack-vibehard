import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const delMod = path.join(repoRoot, "src", "delegation", "opencode.js")
const wtMod = path.join(repoRoot, "src", "delegation", "worktree.js")

// exec mock que registra os comandos git/opencode chamados
function recordingExec(behavior = {}) {
  const calls = []
  const exec = (file, args) => {
    calls.push([file, ...args].join(" "))
    if (file === "opencode" && args[0] === "--version") return Buffer.from("oc 1")
    if (file === "git" && args[0] === "rev-parse") return Buffer.from("true")
    if (file === "git" && args[0] === "worktree" && args[1] === "add") return Buffer.from("")
    if (file === "git" && args[0] === "worktree" && args[1] === "remove") return Buffer.from("")
    if (file === "git" && args[0] === "status") return Buffer.from(behavior.changes ? " M a.ts\n" : "")
    if (file === "git" && (args[0] === "add" || args[0] === "commit" || args[0] === "branch")) return Buffer.from("")
    if (file === "opencode" && args[0] === "run") {
      if (behavior.runFail) { const e = new Error("fail"); e.status = 1; throw e }
      return Buffer.from("done")
    }
    throw new Error("unexpected " + file)
  }
  return { exec, calls }
}

test("worktree: createWorktree usa git worktree add com branch seguro", async () => {
  const { createWorktree } = await import(`${pathToFileURL(wtMod)}?t=${Date.now()}`)
  const { exec, calls } = recordingExec()
  const wt = createWorktree("/repo", { exec, branch: "gstack/x", dir: "/tmp/wt" })
  assert.equal(wt.branch, "gstack/x")
  assert.ok(calls.some((c) => c.startsWith("git worktree add -b gstack/x /tmp/wt")))
})

test("commitWorktree: staging por ALLOWLIST (sem git add -A), exclui .env/artefatos, sem --no-verify", async () => {
  const { commitWorktree, isExcludedFromCommit } = await import(`${pathToFileURL(wtMod)}?t=${Date.now()}`)
  const calls = []
  const exec = (file, args) => {
    calls.push([file, ...args].join(" "))
    if (file === "git" && args[0] === "status") return Buffer.from(" M src/a.js\n?? .env\n M dist/bundle.js\n?? logo.png\n")
    return Buffer.from("")
  }
  const r = commitWorktree("/tmp/wt", "delega: x", { exec })
  // NUNCA usa `git add -A`
  assert.ok(!calls.some((c) => c.startsWith("git add -A")), "não usa git add -A")
  // adiciona explicitamente só os elegíveis
  const add = calls.find((c) => c.startsWith("git add -- "))
  assert.ok(add.includes("src/a.js"), "adiciona o fonte alterado")
  assert.ok(!add.includes(".env") && !add.includes("dist/bundle.js") && !add.includes("logo.png"), "não adiciona .env/build/binário")
  assert.equal(r.staged, 1); assert.equal(r.excluded, 3)
  const commit = calls.find((c) => c.startsWith("git commit"))
  assert.ok(commit && !commit.includes("--no-verify"), "commita sem --no-verify")
  // sanidade do predicado
  assert.ok(isExcludedFromCommit(".env") && isExcludedFromCommit("dist/x.js") && isExcludedFromCommit("a.png"))
  assert.ok(!isExcludedFromCommit("src/index.js") && !isExcludedFromCommit("package-lock.json"))
})

test("commitWorktree: sem arquivos elegíveis não força commit", async () => {
  const { commitWorktree } = await import(`${pathToFileURL(wtMod)}?t=${Date.now()}`)
  const calls = []
  const exec = (file, args) => {
    calls.push([file, ...args].join(" "))
    if (file === "git" && args[0] === "status") return Buffer.from("?? .env\n")
    return Buffer.from("")
  }
  const r = commitWorktree("/tmp/wt", "x", { exec })
  assert.equal(r.staged, 0)
  assert.ok(!calls.some((c) => c.startsWith("git commit")), "não commita quando só há excluídos")
})

test("runDelegation --worktree: isola, commita mudancas e preserva branch", async () => {
  const { runDelegation } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  const { exec, calls } = recordingExec({ changes: true })
  const r = runDelegation({ task: "corrigir", cwd: "/repo", worktree: true, exec })
  assert.equal(r.status, "ok")
  assert.ok(r.reviewBranch, "retorna branch para revisao")
  assert.ok(calls.some((c) => c.startsWith("git worktree add")), "criou worktree")
  assert.ok(calls.some((c) => c.startsWith("git commit")), "commitou o trabalho")
  // worktree dir removida, mas branch mantida (sem 'git branch -D')
  assert.ok(!calls.some((c) => c.startsWith("git branch -D")), "branch preservada")
})

test("runDelegation --worktree: commit com segredo no diff -> needs_review", async () => {
  const { runDelegation } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  // exec que finge mudança em a.js; o arquivo real no worktree tem um segredo (AWS key)
  const { mkdtempSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const wtdir = mkdtempSync(path.join(tmpdir(), "gstack-wtneeds-"))
  writeFileSync(path.join(wtdir, "a.js"), "const k = 'AKIAIOSFODNN7EXAMPLE'\n")
  const exec = (file, args) => {
    if (file === "opencode" && args[0] === "--version") return Buffer.from("oc 1")
    if (file === "git" && args[0] === "rev-parse") return Buffer.from("true")
    if (file === "git" && args[0] === "worktree" && args[1] === "add") return Buffer.from("")
    if (file === "git" && args[0] === "worktree" && args[1] === "remove") return Buffer.from("")
    if (file === "git" && args[0] === "status") return Buffer.from(" M a.js\n")
    if (file === "git") return Buffer.from("") // add/reset/commit/branch
    if (file === "opencode" && args[0] === "run") return Buffer.from("done")
    throw new Error("unexpected " + file)
  }
  const r = runDelegation({ task: "x", cwd: "/repo", worktree: true, exec, worktreeDir: wtdir })
  assert.equal(r.status, "needs_review", "segredo no diff bloqueia o 'ok'")
  assert.ok(r.reviewFindings.some((f) => f.rule === "aws-key"))
  const { rmSync } = await import("node:fs")
  rmSync(wtdir, { recursive: true, force: true })
})

test("runDelegation --worktree sem git -> not_git (nao executa opencode)", async () => {
  const { runDelegation } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  const exec = (file, args) => {
    if (file === "opencode" && args[0] === "--version") return Buffer.from("oc")
    if (file === "git" && args[0] === "rev-parse") throw new Error("not a repo")
    throw new Error("nao deveria chamar " + file)
  }
  const r = runDelegation({ task: "x", cwd: "/norepo", worktree: true, exec })
  assert.equal(r.status, "not_git")
})

test("runDelegation: maxIterations retenta em falha", async () => {
  const { runDelegation } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  const { exec } = recordingExec({ runFail: true })
  const r = runDelegation({ task: "x", cwd: "/repo", maxIterations: 3, exec })
  assert.equal(r.status, "failed")
  assert.equal(r.attempts, 3, "tentou 3x antes de desistir")
})

test("readDelegationBudget lê timeout/maxIterations do loop-budget.json", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-delbud-"))
  try {
    await mkdir(path.join(tmp, ".gstack"), { recursive: true })
    await writeFile(path.join(tmp, ".gstack", "loop-budget.json"), JSON.stringify({ maxWallTimeSeconds: 120, maxIterations: 5 }))
    const { readDelegationBudget } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
    const b = readDelegationBudget(tmp)
    assert.equal(b.timeoutMs, 120000)
    assert.equal(b.maxIterations, 5)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
