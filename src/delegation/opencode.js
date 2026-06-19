import { execFileSync as defaultExecFileSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createWorktree, removeWorktree, commitWorktree, isGitRepo } from "./worktree.js"
import { diffHygiene } from "../project-plan/diff-hygiene.js"

/**
 * Delegação para OpenCode — usa OUTRO modelo/free tier configurado pelo USUÁRIO.
 *
 * Fase 1: policy declarativa (contrato). Fase 2 adiciona o runner real
 * `runDelegation`. O gstack NÃO faz model calls — quem chama o modelo é o
 * OpenCode (configurado pelo usuário). Tudo opt-in, com confirmação.
 */

// A task vai como arg em array (execFileSync, shell:false) → injecao de shell
// nao e possivel. Espacos sao OK (linguagem natural); rejeitamos newline/null.
const UNSAFE_TASK = /[\n\r\0]/

export function buildDelegationPolicy(overrides = {}) {
  return {
    enabled: false,
    requiresUserApproval: true,
    defaultHarness: "opencode",
    returnFormat: "summary+diff+exitCode+verifier",
    modelProvider: "user-configured",
    ...overrides,
  }
}

/** Valida a policy de delegação. Não lança. */
export function validateDelegation(policy) {
  const errors = []
  if (!policy || typeof policy !== "object") return { valid: false, errors: ["policy ausente"] }
  if (typeof policy.enabled !== "boolean") errors.push("enabled deve ser boolean")
  if (policy.enabled && policy.requiresUserApproval !== true) {
    errors.push("delegacao habilitada exige requiresUserApproval:true")
  }
  if (policy.defaultHarness && policy.defaultHarness !== "opencode") {
    errors.push("defaultHarness suportado: opencode")
  }
  return { valid: errors.length === 0, errors }
}

/** True se o CLI do OpenCode está disponível. */
export function isOpencodeAvailable(exec = defaultExecFileSync) {
  try {
    exec("opencode", ["--version"], { stdio: "pipe", timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export function isSafeTask(task) {
  return typeof task === "string" && task.trim().length > 0 && !UNSAFE_TASK.test(task)
}

/** Lê os defaults relevantes do .gstack/loop-budget.json (timeout, maxIterations). */
export function readDelegationBudget(cwd) {
  const out = { maxIterations: 1, timeoutMs: 600000 }
  try {
    const f = join(cwd, ".gstack", "loop-budget.json")
    if (existsSync(f)) {
      const lb = JSON.parse(readFileSync(f, "utf-8"))
      if (Number.isInteger(lb.maxWallTimeSeconds) && lb.maxWallTimeSeconds > 0) out.timeoutMs = lb.maxWallTimeSeconds * 1000
      if (Number.isInteger(lb.maxIterations) && lb.maxIterations > 0) out.maxIterations = lb.maxIterations
    }
  } catch { /* defaults */ }
  return out
}

/**
 * Runner real de delegação ao OpenCode.
 *
 * O gstack NÃO chama modelo — delega ao `opencode run` (modelo do usuário).
 * Retorna resumo ESTRUTURADO (nunca transcript completo). Lê o loop-budget
 * (timeout/maxIterations), retenta até maxIterations em falha, e — com
 * `worktree:true` — roda numa git worktree isolada (não toca o branch principal).
 *
 * @param {object} p { task, cwd, model?, timeout?, maxIterations?, worktree?, exec? }
 */
export function runDelegation(p = {}) {
  const exec = p.exec || defaultExecFileSync
  const cwd = p.cwd || process.cwd()
  if (!isSafeTask(p.task)) {
    return { status: "invalid_task", exitCode: null, summary: "task inválida (vazia ou com newline)", changedFiles: [] }
  }
  if (!isOpencodeAvailable(exec)) {
    return { status: "opencode_missing", exitCode: null, summary: "OpenCode CLI não encontrado (instale: npm i -g opencode)", changedFiles: [] }
  }

  const budget = readDelegationBudget(cwd)
  const timeout = p.timeout || budget.timeoutMs
  const maxIterations = p.maxIterations || budget.maxIterations

  // Isolamento opcional por worktree
  let runCwd = cwd
  let wt = null
  if (p.worktree) {
    if (!isGitRepo(cwd, exec)) {
      return { status: "not_git", exitCode: null, summary: "--worktree exige um repositório git", changedFiles: [] }
    }
    try {
      wt = createWorktree(cwd, { exec, dir: p.worktreeDir })
      runCwd = wt.dir
    } catch (e) {
      return { status: "worktree_failed", exitCode: null, summary: `falha ao criar worktree: ${e.message}`, changedFiles: [] }
    }
  }

  let keepBranch = false
  try {
    const args = ["run"]
    if (p.model) args.push("-m", p.model)
    args.push(p.task)

    let exitCode = 0, stdout = "", stderr = "", attempts = 0
    for (let i = 1; i <= maxIterations; i++) {
      attempts = i
      exitCode = 0; stdout = ""; stderr = ""
      try {
        stdout = (exec("opencode", args, { cwd: runCwd, stdio: "pipe", shell: false, timeout, encoding: "utf-8" }) || "").toString()
        break // sucesso → não retenta
      } catch (e) {
        exitCode = typeof e.status === "number" ? e.status : 1
        stdout = (e.stdout || "").toString()
        stderr = (e.stderr || e.message || "").toString()
        // retenta apenas se ainda há iterações
      }
    }

    const changedFiles = listChangedFiles(runCwd, exec)
    // Worktree: preserva o trabalho commitando no branch efêmero (não toca o
    // branch principal). O usuário revisa/mergeia `wt.branch` depois.
    let preservedBranch = null
    let reviewFindings = null
    if (wt && changedFiles.length > 0) {
      try {
        // Verificação ANTES de marcar revisável (AC6): diff-hygiene determinística
        // nos arquivos alterados. Achado HIGH (segredo/debugger) → needs_review.
        try {
          const dh = diffHygiene({ cwd: wt.dir, files: changedFiles, exec })
          if (dh.high > 0) reviewFindings = dh.findings.filter((f) => f.severity === "HIGH")
        } catch { /* hygiene best-effort */ }
        commitWorktree(wt.dir, `gstack delegate: ${p.task}`.slice(0, 200), { exec })
        preservedBranch = wt.branch
        keepBranch = true
      } catch { /* sem commit — segue */ }
    }
    const needsReview = !!(preservedBranch && reviewFindings && reviewFindings.length)
    const baseStatus = exitCode === 0 ? "ok" : "failed"
    return {
      status: needsReview ? "needs_review" : baseStatus,
      exitCode,
      attempts,
      summary: summarize(stdout, exitCode, changedFiles.length)
        + (preservedBranch ? ` [branch ${preservedBranch} — revise e mergeie]` : (wt ? " [worktree sem mudanças]" : ""))
        + (needsReview ? ` [NEEDS_REVIEW: ${reviewFindings.length} achado(s) HIGH de higiene]` : ""),
      changedFiles,
      ...(preservedBranch ? { reviewBranch: preservedBranch } : {}),
      ...(needsReview ? { reviewFindings } : {}),
      ...(stderr ? { stderrTail: stderr.slice(-800) } : {}),
    }
  } finally {
    // Remove a worktree dir; mantém o branch SE houve trabalho commitado.
    if (wt) removeWorktree(cwd, wt.dir, wt.branch, { exec, keepBranch })
  }
}

function listChangedFiles(cwd, execOrFn) {
  try {
    const exec = typeof execOrFn === "function" ? execOrFn : defaultExecFileSync
    const out = (exec("git", ["status", "--porcelain"], { cwd, stdio: "pipe", shell: false, timeout: 15000, encoding: "utf-8" }) || "").toString()
    return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
  } catch {
    return []
  }
}

function summarize(stdout, exitCode, nChanged) {
  const tail = (stdout || "").trim().split("\n").slice(-3).join(" | ").slice(0, 300)
  return `OpenCode exit=${exitCode}, ${nChanged} arquivo(s) alterado(s). ${tail}`
}
