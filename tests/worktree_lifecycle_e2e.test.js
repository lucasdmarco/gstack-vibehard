import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe", shell: false, encoding: "utf-8" })

/** Repo git real para exercitar o lifecycle de verdade (não mock). */
async function mkRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-wtlc-"))
  git(dir, "init", "-b", "main")
  git(dir, "config", "user.email", "t@t.local")
  git(dir, "config", "user.name", "t")
  git(dir, "config", "commit.gpgsign", "false")
  await writeFile(path.join(dir, "a.txt"), "1\n")
  git(dir, "add", "a.txt")
  git(dir, "commit", "-m", "init")
  return dir
}

async function rmRetry(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
}

test("lifecycle real: idle → merge-ready → dirty → merged num repo git de verdade", async () => {
  const repo = await mkRepo()
  const wtDir = path.join(repo, ".wt-1")
  try {
    const { buildWorktreeInventory } = await imp("src/worktree/lifecycle.js")
    git(repo, "worktree", "add", "-b", "gstack/delegate-t1", wtDir)

    // recém-criada, no head do main → idle
    let inv = buildWorktreeInventory(repo)
    let wt = inv.worktrees.find((w) => w.branch === "gstack/delegate-t1")
    assert.equal(inv.mainBranch, "main")
    assert.equal(wt.state, "idle")
    assert.equal(wt.gstackOwned, true)

    // commit na worktree → merge-ready (limpa e à frente)
    await writeFile(path.join(wtDir, "b.txt"), "2\n")
    git(wtDir, "add", "b.txt")
    git(wtDir, "commit", "-m", "trabalho")
    inv = buildWorktreeInventory(repo)
    wt = inv.worktrees.find((w) => w.branch === "gstack/delegate-t1")
    assert.equal(wt.state, "merge-ready")
    assert.equal(wt.ahead, 1)

    // arquivo solto na worktree → dirty
    await writeFile(path.join(wtDir, "c.txt"), "3\n")
    inv = buildWorktreeInventory(repo)
    assert.equal(inv.worktrees.find((w) => w.branch === "gstack/delegate-t1").state, "dirty")
    await rm(path.join(wtDir, "c.txt"))

    // merge no main → merged
    git(repo, "merge", "--no-ff", "gstack/delegate-t1", "-m", "merge t1")
    inv = buildWorktreeInventory(repo)
    assert.equal(inv.worktrees.find((w) => w.branch === "gstack/delegate-t1").state, "merged")
  } finally {
    await rmRetry(repo)
  }
})

test("worktree cleanup --dry-run: NUNCA altera o filesystem", async () => {
  const repo = await mkRepo()
  const wtDir = path.join(repo, ".wt-dry")
  try {
    const { worktreeCommand } = await imp("src/commands/worktree.js")
    git(repo, "worktree", "add", "-b", "gstack/delegate-dry", wtDir) // idle → candidata

    const before = (await readdir(repo)).sort()
    const out = await worktreeCommand(["cleanup", "--dry-run", "--json"], { cwd: repo })
    const after = (await readdir(repo)).sort()

    assert.equal(out.dryRun, true)
    assert.ok(out.candidates.some((c) => c.branch === "gstack/delegate-dry"), "candidata listada")
    assert.deepEqual(after, before, "dry-run não tocou o filesystem")
    assert.ok(existsSync(wtDir), "worktree intacta")
    assert.match(git(repo, "branch", "--list", "gstack/delegate-dry"), /gstack\/delegate-dry/, "branch intacto")
  } finally {
    await rmRetry(repo)
  }
})

test("worktree cleanup real: remove SÓ gstack-owned em estado seguro (com --yes)", async () => {
  const repo = await mkRepo()
  const wtGstack = path.join(repo, ".wt-g")
  const wtUser = path.join(repo, ".wt-u")
  try {
    const { worktreeCommand } = await imp("src/commands/worktree.js")
    git(repo, "worktree", "add", "-b", "gstack/delegate-clean", wtGstack) // idle → candidata
    git(repo, "worktree", "add", "-b", "feature/do-usuario", wtUser)     // usuário → NUNCA

    const out = await worktreeCommand(["cleanup", "--yes", "--json"], { cwd: repo })
    assert.deepEqual(out.removed, ["gstack/delegate-clean"])
    assert.ok(!existsSync(wtGstack), "worktree gstack removida")
    assert.ok(existsSync(wtUser), "worktree do usuário INTOCADA")
    assert.match(git(repo, "branch", "--list", "feature/do-usuario"), /feature\/do-usuario/)
  } finally {
    await rmRetry(repo)
  }
})

test("worktree discard: commits não mergeados exigem --force (proteção de trabalho)", async () => {
  const repo = await mkRepo()
  const wtDir = path.join(repo, ".wt-f")
  try {
    const { worktreeCommand } = await imp("src/commands/worktree.js")
    git(repo, "worktree", "add", "-b", "gstack/delegate-force", wtDir)
    await writeFile(path.join(wtDir, "novo.txt"), "trabalho\n")
    git(wtDir, "add", "novo.txt")
    git(wtDir, "commit", "-m", "não mergeado")

    // sem --force → recusa com needs_force
    const denied = await worktreeCommand(["discard", "gstack/delegate-force", "--yes", "--json"], { cwd: repo })
    assert.equal(denied.error, "needs_force")
    assert.ok(existsSync(wtDir), "nada removido sem --force")

    // com --force + --yes → remove
    const out = await worktreeCommand(["discard", "gstack/delegate-force", "--force", "--yes", "--json"], { cwd: repo })
    assert.equal(out.discarded, "gstack/delegate-force")
    assert.ok(!existsSync(wtDir))
  } finally {
    await rmRetry(repo)
  }
})

test("worktree fora de repo git: erro honesto, sem crash", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-wtlc-nogit-"))
  try {
    const { worktreeCommand } = await imp("src/commands/worktree.js")
    const out = await worktreeCommand(["list", "--json"], { cwd: dir })
    assert.equal(out.error, "not_a_git_repo")
  } finally {
    await rmRetry(dir)
  }
})
