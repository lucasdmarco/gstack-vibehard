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

/** True se o caminho é segredo, artefato de build ou binário — NÃO vai pro commit. */
export function isExcludedFromCommit(file) {
  const p = String(file).replace(/\\/g, "/")
  const base = p.split("/").pop() || ""
  if (base === ".env" || base.startsWith(".env.")) return true
  if (/(^|\/)(node_modules|dist|build|\.next|out|coverage|\.turbo)(\/|$)/.test(p)) return true
  // binários/artefatos por extensão (lockfiles ficam — dep change legítima os altera)
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|tgz|exe|dll|so|dylib|node|woff2?|ttf|eot|mp4|mov|class|wasm|map)$/i.test(base)) return true
  return false
}

/**
 * Commita as mudanças na worktree (preserva no branch efêmero). Seguro:
 *  - **Staging por ALLOWLIST** (NÃO `git add -A`): adiciona explicitamente só os
 *    arquivos alterados que NÃO são segredo/artefato/binário (`isExcludedFromCommit`);
 *  - SEM `--no-verify` (respeita os hooks de pre-commit do usuário).
 * Retorna { staged, excluded }.
 */
export function commitWorktree(worktreeDir, message, opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  const out = String(exec("git", ["status", "--porcelain"], { cwd: worktreeDir, stdio: "pipe", shell: false, encoding: "utf-8", timeout: 15000 }) || "")
  const changed = out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.split(" -> ").pop())
  const allow = changed.filter((f) => !isExcludedFromCommit(f))
  if (allow.length === 0) return { staged: 0, excluded: changed.length }
  // add explícito (em um único comando; args em array, shell:false — sem injeção)
  exec("git", ["add", "--", ...allow], { cwd: worktreeDir, stdio: "pipe", shell: false, timeout: 30000 })
  exec("git", ["commit", "-m", message], { cwd: worktreeDir, stdio: "pipe", shell: false, timeout: 30000 })
  return { staged: allow.length, excluded: changed.length - allow.length }
}

/**
 * Higiene de segredos: o gstack NÃO copia `.env` para worktrees (usa `git worktree
 * add` puro, e o autosave exclui `.env`). O risco real é o usuário ter `.env`
 * RASTREADO no git — aí ele apareceria no checkout da worktree. Esta função detecta
 * isso para avisar antes de delegar. Retorna a lista de arquivos sensíveis rastreados.
 */
export function checkTrackedSecrets(repoCwd, exec = defaultExecFileSync) {
  try {
    const out = exec("git", ["ls-files", "-z", "--", ".env", ".env.*", "**/.env", "**/.env.*"], { cwd: repoCwd, stdio: "pipe", encoding: "utf-8", timeout: 10000 })
    return String(out || "").split("\0").filter(Boolean)
  } catch {
    return []
  }
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
