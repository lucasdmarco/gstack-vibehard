import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
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

test("buildIgnoreFile sempre bloqueia .env* + junta denies da policy", async () => {
  const { buildIgnoreFile } = await imp("src/harness/candidate-bridge.js")
  const out = buildIgnoreFile({ deny: ["private/**", "*.secret"] })
  assert.match(out, /\.env/)
  assert.match(out, /\*\.pem/)
  assert.match(out, /private\/\*\*/)
  assert.match(out, /\*\.secret/)
})

test("buildKnowledgeMd nunca vaza secret (redige) e não inclui conteúdo de arquivo", async () => {
  const { buildKnowledgeMd } = await imp("src/harness/candidate-bridge.js")
  const md = buildKnowledgeMd({ projectName: "app", objective: "token=ghp_ABCDEF1234567890abcdef1234567890abcd migrar", stack: ["node"] })
  assert.ok(!/ghp_ABCDEF/.test(md), "secret redigido")
  assert.match(md, /Knowledge — app/)
  assert.match(md, /Sem secrets/)
})

test("bridge exige worktree/git, escreve contexto seguro na worktree e roda verify final", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-cbb-"))
  try {
    gitInit(cwd)
    const { runCandidateBridge } = await imp("src/harness/candidate-bridge.js")
    const { CODEBUFF } = await imp("src/harness/codebuff.js")
    let verified = false
    const r = runCandidateBridge({
      candidate: CODEBUFF, task: "revisar checkout", cwd, worktree: true,
      policy: { deny: ["private/**"] }, projectName: "app",
      verifyRunner: ({ cwd: wt }) => { verified = true; assert.ok(existsSync(path.join(wt, "knowledge.md")), "knowledge.md na worktree"); assert.ok(existsSync(path.join(wt, ".codebuffignore"))); return { status: "ok", usable: true } },
    })
    assert.equal(verified, true, "verify roda DEPOIS")
    assert.equal(r.status, "review_ready")
    assert.equal(r.reviewer, "advisory")
    assert.equal(r.concluded, true)
    // metadados project-scoped, nada global
    assert.ok(existsSync(path.join(cwd, ".gstack", "harness", "codebuff.json")))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("verify determinístico falho IMPEDE conclusão (reviewer não aprova nada)", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-cbb-"))
  try {
    gitInit(cwd)
    const { runCandidateBridge } = await imp("src/harness/candidate-bridge.js")
    const { CODEBUFF } = await imp("src/harness/codebuff.js")
    const r = runCandidateBridge({
      candidate: CODEBUFF, task: "x", cwd, worktree: true,
      verifyRunner: () => ({ status: "blocked", usable: false }),
    })
    assert.equal(r.status, "verify_failed")
    assert.equal(r.concluded, false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("sem worktree ou fora de git → recusa honesta, nenhum efeito", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-cbb-"))
  try {
    const { runCandidateBridge } = await imp("src/harness/candidate-bridge.js")
    const { CODEBUFF } = await imp("src/harness/codebuff.js")
    assert.equal(runCandidateBridge({ candidate: CODEBUFF, task: "x", cwd, worktree: false }).status, "worktree_required")
    assert.equal(runCandidateBridge({ candidate: CODEBUFF, task: "x", cwd, worktree: true }).status, "not_git")
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
