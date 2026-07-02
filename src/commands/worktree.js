import { execFileSync as defaultExec } from "child_process"
import { buildWorktreeInventory, cleanupCandidates, findWorktree } from "../worktree/lifecycle.js"
import { removeWorktree, isGitRepo } from "../delegation/worktree.js"
import { runVerify } from "../project-plan/verify-runner.js"
import { success, warn, error, info, section, confirm } from "../cli/index.js"

/**
 * `worktree` — lifecycle UX (PRD14 §4.3) sobre o engine de delegação existente.
 *
 *   worktree list [--json]              estados de todas as worktrees
 *   worktree inspect <id> [--json]      detalhe de uma worktree
 *   worktree diff <id>                  diff vs branch principal (stat)
 *   worktree accept <id>                roda verify e ORIENTA o merge (sem auto-merge)
 *   worktree discard <id> [--force]     remove; commits não mergeados exigem --force
 *   worktree cleanup [--dry-run] [--yes]  remove SÓ gstack-owned em estado seguro
 */

const STATE_ICON = {
  main: "⌂", dirty: "✎", conflict: "✗", "merge-ready": "▲",
  merged: "✓", stale: "⏳", idle: "·", unknown: "?",
}

function wtLine(w) {
  const own = w.gstackOwned ? " [gstack]" : ""
  const ab = w.ahead || w.behind ? ` +${w.ahead}/-${w.behind}` : ""
  return `  ${STATE_ICON[w.state] || "?"} ${w.branch || "(detached)"} — ${w.state}${ab}${own}\n      ${w.dir}`
}

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n")
  return obj
}

/** Falha padronizada: JSON puro no --json, mensagem humana caso contrário. */
function fail(json, obj, message, hint) {
  if (json) return emitJson(obj)
  error(message)
  if (hint) info(hint)
  return undefined
}

function requireWorktree(ctx, id) {
  if (!id) return { out: fail(ctx.json, { error: "missing_id" }, "Informe o id (branch ou pasta): worktree <ação> <id>") }
  const wt = findWorktree(ctx.inv, id)
  if (!wt) return { out: fail(ctx.json, { error: "not_found", id }, `Worktree não encontrada: ${id} (veja \`worktree list\`)`) }
  return { wt }
}

/**
 * Guard de consentimento compartilhado (discard/cleanup): não-interativo exige
 * --yes; interativo pede confirmação explícita. Retorna true para prosseguir.
 */
async function consented(ctx, prompt, refuseJson) {
  if (ctx.args.includes("--yes")) return true
  if (!process.stdin.isTTY) {
    fail(ctx.json, refuseJson, "Modo não-interativo: confirme com --yes.")
    return false
  }
  const ok = await confirm(prompt, false)
  if (!ok) info("Cancelado.")
  return ok
}

function cmdList(ctx) {
  if (ctx.json) return emitJson(ctx.inv)
  section("worktree list — estados")
  if (ctx.inv.worktrees.length === 0) info("  (nenhuma worktree)")
  ctx.inv.worktrees.forEach((w) => info(wtLine(w)))
  info("")
  info("  Ações: inspect <id> · diff <id> · accept <id> · discard <id> · cleanup --dry-run")
}

function cmdInspect(ctx) {
  const { wt, out } = requireWorktree(ctx, ctx.id)
  if (!wt) return out
  if (ctx.json) return emitJson(wt)
  section(`worktree inspect — ${wt.branch || wt.dir}`)
  info(wtLine(wt))
  if (wt.ageDays != null) info(`  último commit: ${wt.ageDays.toFixed(1)} dia(s) atrás`)
  if (wt.error) warn(`  erro de classificação: ${wt.error}`)
}

function cmdDiff(ctx) {
  const { wt, out } = requireWorktree(ctx, ctx.id)
  if (!wt) return out
  const range = `${ctx.inv.mainBranch}...${wt.branch}`
  const stat = String(ctx.exec("git", ["diff", "--stat", range], { cwd: ctx.cwd, stdio: "pipe", shell: false, encoding: "utf-8", timeout: 30000 }) || "")
  if (ctx.json) return emitJson({ id: wt.branch, range, stat })
  section(`worktree diff — ${range}`)
  info(stat || "  (sem diferenças)")
  info(`  Diff completo: git diff ${range}`)
}

function renderAcceptResult(ctx, wt, report) {
  if (ctx.json) return emitJson({ id: wt.branch, verify: { status: report.status, usable: report.usable }, mergeHint: report.usable ? `git merge --no-ff ${wt.branch}` : null })
  section(`worktree accept — ${wt.branch}`)
  info(`  verify --quick: ${report.status}`)
  if (!report.usable) { error("Verify reprovou — corrija na worktree antes de mergear."); return }
  success("Verify passou. SEM auto-merge (você decide):")
  info(`  git merge --no-ff ${wt.branch}   # no branch ${ctx.inv.mainBranch}`)
  info(`  worktree discard ${wt.branch}    # depois do merge`)
}

async function cmdAccept(ctx) {
  const { wt, out } = requireWorktree(ctx, ctx.id)
  if (!wt) return out
  if (wt.state !== "merge-ready" && wt.state !== "merged") {
    return fail(ctx.json, { error: "not_merge_ready", id: wt.branch, state: wt.state },
      `Estado atual: ${wt.state} — accept espera merge-ready (limpo e à frente do ${ctx.inv.mainBranch}).`)
  }
  // Gate determinístico ANTES de orientar o merge (PRD: accept roda verify).
  const report = runVerify({ cwd: wt.dir, profile: "quick", exec: ctx.opts.exec, home: ctx.opts.home })
  return renderAcceptResult(ctx, wt, report)
}

/** Guards do discard: main nunca; commits não mergeados exigem --force. */
function discardGuard(ctx, wt) {
  if (wt.state === "main") {
    return { blocked: true, out: fail(ctx.json, { error: "cannot_discard_main" }, "Não descarto a worktree principal.") }
  }
  if (wt.ahead > 0 && !ctx.args.includes("--force")) {
    const out = fail(ctx.json, { error: "needs_force", id: wt.branch, ahead: wt.ahead, hint: "commits não mergeados — repita com --force" },
      `${wt.branch} tem ${wt.ahead} commit(s) NÃO mergeado(s). Descartar apaga esse trabalho.`,
      `  Se tem certeza: worktree discard ${wt.branch} --force`)
    return { blocked: true, out }
  }
  return { blocked: false }
}

async function cmdDiscard(ctx) {
  const { wt, out } = requireWorktree(ctx, ctx.id)
  if (!wt) return out
  const guard = discardGuard(ctx, wt)
  if (guard.blocked) return guard.out
  const unmerged = wt.ahead > 0
  const prompt = `Remover worktree ${wt.branch} (${wt.dir})${unmerged ? ` e APAGAR ${wt.ahead} commit(s)` : ""}?`
  if (!(await consented(ctx, prompt, { error: "needs_confirmation", hint: "use --yes" }))) return
  removeWorktree(ctx.cwd, wt.dir, wt.branch, { exec: ctx.opts.exec })
  if (ctx.json) return emitJson({ discarded: wt.branch })
  success(`Worktree ${wt.branch} removida.`)
}

function renderCleanupDryRun(ctx, plan) {
  if (ctx.json) return emitJson({ dryRun: true, candidates: plan })
  section("worktree cleanup --dry-run (nada será removido)")
  if (plan.length === 0) info("  ✓ Nada a limpar (só estados seguros de worktrees gstack entram).")
  plan.forEach((p) => info(`  • ${p.branch} [${p.state}] — removeria worktree${p.keepBranch ? " (branch preservado: commits não mergeados)" : " + branch"}`))
}

async function cmdCleanup(ctx) {
  const plan = cleanupCandidates(ctx.inv).map((w) => ({ branch: w.branch, dir: w.dir, state: w.state, keepBranch: w.ahead > 0 }))
  if (ctx.args.includes("--dry-run")) return renderCleanupDryRun(ctx, plan)
  if (plan.length === 0) {
    if (ctx.json) return emitJson({ removed: [] })
    section("worktree cleanup"); info("  ✓ Nada a limpar."); return
  }
  const refuse = { error: "needs_confirmation", candidates: plan, hint: "use --yes (ou --dry-run para só ver)" }
  if (!(await consented(ctx, `Remover ${plan.length} worktree(s) gstack em estado seguro?`, refuse))) return
  const removed = plan.map((p) => {
    removeWorktree(ctx.cwd, p.dir, p.branch, { exec: ctx.opts.exec, keepBranch: p.keepBranch })
    return p.branch
  })
  if (ctx.json) return emitJson({ removed })
  section("worktree cleanup")
  removed.forEach((b) => success(`  ✓ ${b} removida`))
}

const SUBCOMMANDS = {
  list: cmdList, inspect: cmdInspect, diff: cmdDiff,
  accept: cmdAccept, discard: cmdDiscard, cleanup: cmdCleanup,
}

function makeCtx(args, opts) {
  const rawId = args[1]
  return {
    cwd: opts.cwd || process.cwd(),
    json: args.includes("--json"),
    exec: opts.exec || defaultExec,
    sub: args[0] || "list",
    id: rawId && !rawId.startsWith("--") ? rawId : null,
    args, opts,
  }
}

function renderUsage(ctx) {
  if (ctx.json) return emitJson({ error: "unknown_subcommand", sub: ctx.sub })
  section("worktree")
  info("  Uso: worktree list|inspect <id>|diff <id>|accept <id>|discard <id> [--force]|cleanup [--dry-run] [--yes]")
}

export async function worktreeCommand(args = [], opts = {}) {
  const ctx = makeCtx(args, opts)
  if (!isGitRepo(ctx.cwd, ctx.exec)) {
    if (ctx.json) return emitJson({ error: "not_a_git_repo" })
    warn("Fora de um repositório git."); return
  }
  const handler = SUBCOMMANDS[ctx.sub]
  if (!handler) return renderUsage(ctx)
  ctx.inv = buildWorktreeInventory(ctx.cwd, { exec: ctx.exec, staleDays: opts.staleDays })
  return handler(ctx)
}
