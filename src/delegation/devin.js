import { execFileSync as defaultExecFileSync } from "child_process"
import { createWorktree, removeWorktree, commitWorktree, isGitRepo } from "./worktree.js"
import { diffHygiene } from "../project-plan/diff-hygiene.js"
import { readDelegationBudget, isSafeTask } from "./opencode.js"

/**
 * Delegação para Devin (PRD15 §10.5). O gstack NÃO chama modelo — delega ao
 * `devin -p -- <prompt>` (oneshot, modelo/Adaptive do usuário). Isolamento por
 * worktree, higiene determinística no retorno (needs_review em achado HIGH),
 * provenance da decisão e NUNCA auto-merge. Cloud handoff é opt-in explícito e
 * confirmado na camada de comando — o runner só age com `cloudHandoff` já autorizado.
 */

export function isDevinAvailable(exec = defaultExecFileSync) {
  try { exec("devin", ["--version"], { stdio: "pipe", timeout: 5000 }); return true } catch { return false }
}

function listChangedFiles(cwd, exec) {
  try {
    const out = (exec("git", ["status", "--porcelain"], { cwd, stdio: "pipe", shell: false, timeout: 15000, encoding: "utf-8" }) || "").toString()
    return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
  } catch { return [] }
}

function summarize(stdout, exitCode, nChanged) {
  const tail = (stdout || "").trim().split("\n").slice(-3).join(" | ").slice(0, 300)
  return `Devin exit=${exitCode}, ${nChanged} arquivo(s) alterado(s). ${tail}`
}

function devinArgs(task, model) {
  const args = ["-p"]
  if (model) args.push("--model", model)
  args.push("--", task) // `--` separa o prompt (linguagem natural) dos flags
  return args
}

const asStr = (x) => (x == null ? "" : String(x))

function runOnce(exec, args, runCwd, timeout) {
  try { return { exitCode: 0, stdout: asStr(exec("devin", args, { cwd: runCwd, stdio: "pipe", shell: false, timeout, encoding: "utf-8" })), stderr: "" } }
  catch (e) { return { exitCode: Number.isInteger(e.status) ? e.status : 1, stdout: asStr(e.stdout), stderr: asStr(e.stderr) || asStr(e.message) } }
}

function runLoop(exec, args, runCwd, timeout, maxIterations) {
  let run = { exitCode: 0, stdout: "", stderr: "" }
  for (let i = 1; i <= maxIterations; i++) { run = runOnce(exec, args, runCwd, timeout); if (run.exitCode === 0) break }
  return run
}

function reviewNeeded(preserved) {
  return !!(preserved.branch && preserved.reviewFindings && preserved.reviewFindings.length)
}

function buildSummary(run, changedFiles, wt, preserved, needsReview) {
  let s = summarize(run.stdout, run.exitCode, changedFiles.length)
  if (preserved.branch) s += ` [branch ${preserved.branch} — revise e mergeie]`
  else if (wt) s += " [worktree sem mudanças]"
  if (needsReview) s += ` [NEEDS_REVIEW: ${preserved.reviewFindings.length} achado(s) HIGH de higiene]`
  return s
}

function finalize(run, changedFiles, wt, preserved, cloudHandoff) {
  const needsReview = reviewNeeded(preserved)
  const out = {
    status: needsReview ? "needs_review" : (run.exitCode === 0 ? "ok" : "failed"),
    exitCode: run.exitCode, cloudHandoff: !!cloudHandoff,
    summary: buildSummary(run, changedFiles, wt, preserved, needsReview), changedFiles,
  }
  if (preserved.branch) out.reviewBranch = preserved.branch
  if (needsReview) out.reviewFindings = preserved.reviewFindings
  if (run.stderr) out.stderrTail = run.stderr.slice(-800)
  return out
}

function setupWorktree(p, exec) {
  if (!p.worktree) return { runCwd: p.cwd, wt: null }
  if (!isGitRepo(p.cwd, exec)) return { error: { status: "not_git", exitCode: null, summary: "--worktree exige um repositório git", changedFiles: [] } }
  try { const wt = createWorktree(p.cwd, { exec, dir: p.worktreeDir }); return { runCwd: wt.dir, wt } }
  catch (e) { return { error: { status: "worktree_failed", exitCode: null, summary: `falha ao criar worktree: ${e.message}`, changedFiles: [] } } }
}

/** Higiene + commit no branch efêmero (nunca no principal). */
function preserveWork(wt, task, changedFiles, exec) {
  let reviewFindings = null
  try {
    const dh = diffHygiene({ cwd: wt.dir, files: changedFiles, exec })
    if (dh.high > 0) reviewFindings = dh.findings.filter((f) => f.severity === "HIGH")
  } catch { /* hygiene best-effort */ }
  try { commitWorktree(wt.dir, `gstack delegate devin: ${task}`.slice(0, 200), { exec }); return { branch: wt.branch, reviewFindings } }
  catch { return { branch: null, reviewFindings } }
}

/**
 * @param {object} p { task, cwd, model?, timeout?, maxIterations?, worktree?, cloudHandoff?, exec? }
 */
function invalid(status, summary) { return { status, exitCode: null, summary, changedFiles: [] } }

function limitsFor(p, budget) {
  return { timeout: p.timeout || budget.timeoutMs, maxIterations: p.maxIterations || budget.maxIterations }
}

function maybePreserve(wt, changedFiles, task, exec) {
  if (!(wt && changedFiles.length > 0)) return { branch: null, reviewFindings: null }
  return preserveWork(wt, task, changedFiles, exec)
}

export function runDevinDelegation(p = {}) {
  const { exec = defaultExecFileSync, cwd = process.cwd() } = p
  if (!isSafeTask(p.task)) return invalid("invalid_task", "task inválida (vazia ou com newline)")
  if (!isDevinAvailable(exec)) return invalid("devin_missing", "Devin CLI não encontrado (veja https://docs.devin.ai/cli)")

  const setup = setupWorktree(p, exec)
  if (setup.error) return setup.error
  const { runCwd, wt } = setup
  const { timeout, maxIterations } = limitsFor(p, readDelegationBudget(cwd))

  let keepBranch = false
  try {
    const run = runLoop(exec, devinArgs(p.task, p.model), runCwd, timeout, maxIterations)
    const changedFiles = listChangedFiles(runCwd, exec)
    const preserved = maybePreserve(wt, changedFiles, p.task, exec)
    keepBranch = !!preserved.branch
    return finalize(run, changedFiles, wt, preserved, p.cloudHandoff)
  } finally {
    if (wt) removeWorktree(cwd, wt.dir, wt.branch, { exec, keepBranch })
  }
}
