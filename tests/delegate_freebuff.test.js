import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function gitInit(dir) {
  const run = (a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" })
  run(["init", "-q"]); run(["config", "user.email", "t@t"]); run(["config", "user.name", "t"]); run(["config", "commit.gpgsign", "false"])
  writeFileSync(path.join(dir, "README.md"), "# t\n"); run(["add", "-A"]); run(["commit", "-qm", "init"])
}

test("freebuff --yes NÃO pula a disclosure de rede na 1ª vez (needs_acceptance)", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-dfb-"))
  try {
    gitInit(cwd)
    const { delegateCommand } = await imp("src/commands/delegate.js")
    // mesmo com --yes, primeira vez exige aceite explícito de disclosure
    const r = await delegateCommand(["freebuff", "--task", "revisar", "--worktree", "--yes"], { cwd, confirm: async () => true })
    assert.equal(r.status, "needs_acceptance")
    assert.ok(Array.isArray(r.disclosure) && r.disclosure.length)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("freebuff com --accept-disclosure roda; 2ª vez não repete o gate", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-dfb-"))
  try {
    gitInit(cwd)
    const { delegateCommand } = await imp("src/commands/delegate.js")
    // O verify real do projeto pode não achar gates → status "review_ready" (scaffold ok) é aceitável;
    // o que importa: NÃO ficou preso em needs_acceptance após aceitar.
    const r1 = await delegateCommand(["freebuff", "--task", "x", "--worktree", "--accept-disclosure", "--yes"], { cwd, confirm: async () => true })
    assert.notEqual(r1.status, "needs_acceptance")
    assert.ok(existsSync(path.join(cwd, ".gstack", "harness", "freebuff-accepted.json")), "aceite persistido")
    // 2ª vez: sem --accept-disclosure, já aceito → não volta a pedir
    const r2 = await delegateCommand(["freebuff", "--task", "y", "--worktree", "--yes"], { cwd, confirm: async () => true })
    assert.notEqual(r2.status, "needs_acceptance")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("acceptanceGate: --yes sozinho não aceita; --accept-disclosure aceita e persiste", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-dfb-"))
  try {
    const { acceptanceGate, hasAccepted } = await imp("src/harness/candidate-bridge.js")
    const { FREEBUFF } = await imp("src/harness/freebuff.js")
    const blocked = acceptanceGate({ candidate: FREEBUFF, cwd, acceptDisclosure: false })
    assert.equal(blocked.blocked, true)
    assert.equal(hasAccepted(cwd, "freebuff"), false)
    const ok = acceptanceGate({ candidate: FREEBUFF, cwd, acceptDisclosure: true })
    assert.equal(ok.ok, true)
    assert.equal(hasAccepted(cwd, "freebuff"), true)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
