import { execFileSync as defaultExec } from "child_process"

/**
 * Worktree Lifecycle (PRD14 §4.3): classifica as worktrees do repo em estados
 * DETERMINÍSTICOS para o produto (`worktree list/inspect/diff/accept/discard/
 * cleanup`). Read-only por construção — quem remove é o comando, nunca este módulo.
 *
 * Estados: main | dirty | conflict | merge-ready | merged | stale | idle | unknown
 * Ownership: só branches gstack (`gstack/*`, `task/*`) são elegíveis a cleanup.
 */

export const WORKTREE_STATES = Object.freeze(["main", "dirty", "conflict", "merge-ready", "merged", "stale", "idle", "unknown"])
const GSTACK_PREFIXES = ["gstack/", "task/"]
const DEFAULT_STALE_DAYS = 7

function git(exec, cwd, args, timeout = 15000) {
  return String(exec("git", args, { cwd, stdio: "pipe", shell: false, encoding: "utf-8", timeout }) || "")
}

/** Worktree é DO GSTACK (elegível a cleanup) só pelo prefixo de branch efêmero. */
export function isGstackBranch(branch) {
  return GSTACK_PREFIXES.some((p) => String(branch || "").startsWith(p))
}

// Campos do porcelain: prefixo da linha → mutação no registro corrente.
const PORCELAIN_FIELDS = [
  ["HEAD ", (cur, rest) => { cur.head = rest.trim() }],
  ["branch ", (cur, rest) => { cur.branch = rest.trim().replace(/^refs\/heads\//, "") }],
  ["prunable", (cur) => { cur.prunable = true }],
  ["detached", (cur) => { cur.detached = true }],
]

/** Parseia `git worktree list --porcelain` (blocos separados por linha vazia). */
export function parseWorktreeList(text) {
  const out = []
  let cur = null
  for (const line of String(text).split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { dir: line.slice(9).trim(), branch: null, head: null, prunable: false, detached: false }
      out.push(cur)
      continue
    }
    const field = cur && PORCELAIN_FIELDS.find(([prefix]) => line.startsWith(prefix))
    if (field) field[1](cur, line.slice(field[0].length))
  }
  return out
}

/** Lista worktrees cruas do repo (a primeira é sempre a principal). */
export function listWorktrees(cwd, opts = {}) {
  const exec = opts.exec || defaultExec
  return parseWorktreeList(git(exec, cwd, ["worktree", "list", "--porcelain"]))
}

/** { dirty, conflict } a partir do `git status --porcelain` da worktree. */
function statusInfo(exec, dir) {
  const lines = git(exec, dir, ["status", "--porcelain"]).split("\n").filter(Boolean)
  const conflict = lines.some((l) => /^(UU|AA|DD|AU|UA|DU|UD)/.test(l))
  return { dirty: lines.length > 0, conflict }
}

/** { ahead, behind } do branch vs o branch principal. */
function aheadBehind(exec, cwd, mainRef, ref) {
  const out = git(exec, cwd, ["rev-list", "--left-right", "--count", `${mainRef}...${ref}`]).trim()
  const [behind, ahead] = out.split(/\s+/).map((n) => parseInt(n, 10) || 0)
  return { ahead, behind }
}

/** Idade (dias) do último commit da worktree; null se ilegível. */
function lastCommitAgeDays(exec, dir, nowMs) {
  const ct = parseInt(git(exec, dir, ["log", "-1", "--format=%ct"]).trim(), 10)
  if (!Number.isFinite(ct)) return null
  return (nowMs / 1000 - ct) / 86400
}

// Regras de estado em ordem de precedência (primeira que casa decide).
const STATE_RULES = [
  [(f) => f.isMain, "main"],
  [(f) => f.prunable, "stale"], // diretório sumiu
  [(f) => f.conflict, "conflict"],
  [(f) => f.dirty, "dirty"],
  [(f) => f.ahead === 0 && f.sameHead, "idle"], // sem commits próprios, no head do main
  [(f) => f.ahead === 0, "merged"], // commits já absorvidos pelo main
  [(f) => f.ageDays != null && f.ageDays > f.staleDays, "stale"], // trabalho abandonado
]

/** Decide o estado a partir dos fatos coletados (puro — testável sem git). */
export function decideState(f) {
  const rule = STATE_RULES.find(([match]) => match(f))
  return rule ? rule[1] : "merge-ready"
}

/** Coleta os fatos de git de UMA worktree (pode lançar — o caller decide). */
function collectFacts(exec, cwd, wt, main, opts) {
  const st = wt.prunable ? { dirty: false, conflict: false } : statusInfo(exec, wt.dir)
  const ab = aheadBehind(exec, cwd, main.head, wt.head)
  const ageDays = wt.prunable ? null : lastCommitAgeDays(exec, wt.dir, opts.now || Date.now())
  const staleDays = opts.staleDays || DEFAULT_STALE_DAYS
  return { isMain: false, prunable: wt.prunable, ...st, ...ab, sameHead: wt.head === main.head, ageDays, staleDays }
}

/** Classifica UMA worktree. Erros de git viram state:"unknown" (nunca lança). */
export function classifyWorktree(cwd, wt, main, opts = {}) {
  const exec = opts.exec || defaultExec
  const base = { ...wt, gstackOwned: isGstackBranch(wt.branch), ahead: 0, behind: 0, ageDays: null }
  if (wt.dir === main.dir) return { ...base, state: "main" }
  try {
    const facts = collectFacts(exec, cwd, wt, main, opts)
    return { ...base, ahead: facts.ahead, behind: facts.behind, ageDays: facts.ageDays, state: decideState(facts) }
  } catch (e) {
    return { ...base, state: "unknown", error: String(e.message || e).slice(0, 120) }
  }
}

/** Inventário completo: todas as worktrees classificadas + branch principal. */
export function buildWorktreeInventory(cwd, opts = {}) {
  const all = listWorktrees(cwd, opts)
  if (all.length === 0) return { mainBranch: null, worktrees: [] }
  const main = all[0]
  return {
    mainBranch: main.branch,
    worktrees: all.map((wt) => classifyWorktree(cwd, wt, main, opts)),
  }
}

/**
 * Candidatas a cleanup: SÓ gstack-owned e SÓ nos estados seguros
 * (merged/idle/stale/prunable). merge-ready/dirty/conflict NUNCA entram.
 */
export function cleanupCandidates(inventory) {
  return inventory.worktrees.filter((w) =>
    w.state !== "main" && w.gstackOwned && ["merged", "idle", "stale"].includes(w.state))
}

/** Resolve o id do usuário (branch OU basename do dir) para a worktree. */
export function findWorktree(inventory, id) {
  const norm = String(id || "").trim()
  return inventory.worktrees.find((w) =>
    w.branch === norm || (w.dir || "").replace(/\\/g, "/").split("/").pop() === norm) || null
}
