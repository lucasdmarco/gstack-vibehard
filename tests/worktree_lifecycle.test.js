import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "worktree", "lifecycle.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("parseWorktreeList: porcelain → dirs/branches/head/prunable/detached", async () => {
  const { parseWorktreeList } = await imp()
  const out = parseWorktreeList([
    "worktree C:/repo",
    "HEAD aaa111",
    "branch refs/heads/master",
    "",
    "worktree C:/tmp/wt1",
    "HEAD bbb222",
    "branch refs/heads/gstack/delegate-1",
    "",
    "worktree C:/tmp/wt2",
    "HEAD ccc333",
    "detached",
    "",
    "worktree C:/tmp/gone",
    "HEAD ddd444",
    "branch refs/heads/task/p1-s1",
    "prunable gitdir file points to non-existent location",
  ].join("\n"))
  assert.equal(out.length, 4)
  assert.equal(out[0].branch, "master")
  assert.equal(out[1].branch, "gstack/delegate-1")
  assert.equal(out[2].detached, true)
  assert.equal(out[2].branch, null)
  assert.equal(out[3].prunable, true)
})

test("isGstackBranch: só prefixos gstack/ e task/ são do gstack", async () => {
  const { isGstackBranch } = await imp()
  assert.equal(isGstackBranch("gstack/delegate-123"), true)
  assert.equal(isGstackBranch("task/plan-1-step-2"), true)
  assert.equal(isGstackBranch("feature/minha-branch"), false)
  assert.equal(isGstackBranch("master"), false)
  assert.equal(isGstackBranch(null), false)
})

test("decideState: matriz determinística de estados", async () => {
  const { decideState } = await imp()
  const base = { isMain: false, prunable: false, conflict: false, dirty: false, ahead: 0, behind: 0, sameHead: false, ageDays: 1, staleDays: 7 }
  assert.equal(decideState({ ...base, isMain: true }), "main")
  assert.equal(decideState({ ...base, prunable: true }), "stale", "dir sumiu = stale")
  assert.equal(decideState({ ...base, conflict: true, dirty: true }), "conflict", "conflict vence dirty")
  assert.equal(decideState({ ...base, dirty: true }), "dirty")
  assert.equal(decideState({ ...base, sameHead: true }), "idle", "sem commits próprios, no head do main")
  assert.equal(decideState({ ...base, ahead: 0 }), "merged", "commits já absorvidos pelo main")
  assert.equal(decideState({ ...base, ahead: 2 }), "merge-ready")
  assert.equal(decideState({ ...base, ahead: 2, ageDays: 30 }), "stale", "trabalho abandonado")
})

test("cleanupCandidates: só gstack-owned em estado seguro; merge-ready NUNCA entra", async () => {
  const { cleanupCandidates } = await imp()
  const inv = { worktrees: [
    { branch: "master", state: "main", gstackOwned: false },
    { branch: "gstack/delegate-1", state: "merged", gstackOwned: true },
    { branch: "gstack/delegate-2", state: "merge-ready", gstackOwned: true },
    { branch: "gstack/delegate-3", state: "idle", gstackOwned: true },
    { branch: "task/p1-s1", state: "stale", gstackOwned: true },
    { branch: "feature/user", state: "merged", gstackOwned: false },
    { branch: "gstack/delegate-4", state: "dirty", gstackOwned: true },
  ] }
  const c = cleanupCandidates(inv).map((w) => w.branch)
  assert.deepEqual(c, ["gstack/delegate-1", "gstack/delegate-3", "task/p1-s1"])
})

test("findWorktree: resolve por branch OU basename do dir", async () => {
  const { findWorktree } = await imp()
  const inv = { worktrees: [
    { branch: "gstack/delegate-9", dir: "C:\\tmp\\gstack-wt-9" },
    { branch: "master", dir: "C:/repo" },
  ] }
  assert.equal(findWorktree(inv, "gstack/delegate-9").dir, "C:\\tmp\\gstack-wt-9")
  assert.equal(findWorktree(inv, "gstack-wt-9").branch, "gstack/delegate-9")
  assert.equal(findWorktree(inv, "nao-existe"), null)
})
