import { execFileSync as defaultExecFileSync } from "child_process"
import { join } from "path"
import { tmpdir } from "os"

/**
 * Isolamento por git worktree para delegação segura.
 *
 * Roda o agente delegado (OpenCode) numa worktree separada, num branch efêmero,
 * de modo que ele NUNCA toque o branch principal do usuário. Depois, o resultado
 * estruturado (diff/arquivos) é retornado para revisão antes de qualquer merge.
 */

const SAFE_BRANCH = /^[a-zA-Z0-9._\/-]+$/

/** Cria uma worktree efêmera. Retorna { dir, branch } ou lança. */
export function createWorktree(repoCwd, opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  const branch = opts.branch || `gstack/delegate-${Date.now()}`
  if (!SAFE_BRANCH.test(branch)) throw new Error(`branch invalido: ${branch}`)
  const dir = opts.dir || join(tmpdir(), `gstack-wt-${Date.now()}`)
  exec("git", ["worktree", "add", "-b", branch, dir], { cwd: repoCwd, stdio: "pipe", shell: false, timeout: 60000 })
  return { dir, branch }
}

/**
 * Remove a worktree (best-effort). Por padrão também apaga o branch efêmero;
 * passe keepBranch:true para preservar o branch (ex.: contém trabalho commitado
 * a ser revisado/mergeado pelo usuário).
 */
export function removeWorktree(repoCwd, dir, branch, opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  try { exec("git", ["worktree", "remove", "--force", dir], { cwd: repoCwd, stdio: "pipe", shell: false, timeout: 60000 }) } catch { /* best-effort */ }
  if (branch && !opts.keepBranch) {
    try { exec("git", ["branch", "-D", branch], { cwd: repoCwd, stdio: "pipe", shell: false, timeout: 30000 }) } catch { /* best-effort */ }
  }
}

/** Commita as mudanças na worktree (preserva o trabalho no branch efêmero). */
export function commitWorktree(worktreeDir, message, opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  exec("git", ["add", "-A"], { cwd: worktreeDir, stdio: "pipe", shell: false, timeout: 30000 })
  exec("git", ["commit", "-m", message, "--no-verify"], { cwd: worktreeDir, stdio: "pipe", shell: false, timeout: 30000 })
}

/** True se o cwd está dentro de um repositório git. */
export function isGitRepo(cwd, exec = defaultExecFileSync) {
  try {
    exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "pipe", shell: false, timeout: 10000 })
    return true
  } catch {
    return false
  }
}
