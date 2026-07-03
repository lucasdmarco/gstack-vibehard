import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function gitInit(dir, { trackEnv = false } = {}) {
  const run = (a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" })
  run(["init", "-q"]); run(["config", "user.email", "t@t"]); run(["config", "user.name", "t"]); run(["config", "commit.gpgsign", "false"])
  writeFileSync(path.join(dir, "README.md"), "# t\n")
  if (trackEnv) writeFileSync(path.join(dir, ".env"), "SECRET=abc\n")
  run(["add", "-A"]); run(["commit", "-qm", "init"])
}

test("delegate codebuff: worktree obrigatória, verify final, provenance registrada", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-dcb-"))
  try {
    gitInit(cwd)
    const { delegateCommand } = await imp("src/commands/delegate.js")
    const r = await delegateCommand(["codebuff", "--task", "revisar módulo", "--worktree", "--yes"], {
      cwd, confirm: async () => true,
    })
    assert.equal(r.status, "review_ready")
    assert.equal(r.reviewer, "advisory")
    // provenance gravada
    assert.ok(existsSync(path.join(cwd, ".gstack", "provenance")) || existsSync(path.join(cwd, ".gstack")), "provenance dir")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("delegate codebuff SEM --worktree é recusado (não roda fora de worktree)", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-dcb-"))
  try {
    gitInit(cwd)
    const { delegateCommand } = await imp("src/commands/delegate.js")
    const r = await delegateCommand(["codebuff", "--task", "x", "--yes"], { cwd, confirm: async () => true })
    assert.equal(r.status, "worktree_required")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("delegate codebuff BLOQUEIA com .env rastreado (segredo não vai a modelo externo)", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-dcb-"))
  try {
    gitInit(cwd, { trackEnv: true })
    const { delegateCommand } = await imp("src/commands/delegate.js")
    const r = await delegateCommand(["codebuff", "--task", "x", "--worktree", "--yes"], { cwd, confirm: async () => true })
    assert.equal(r.status, "blocked_tracked_secrets")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
