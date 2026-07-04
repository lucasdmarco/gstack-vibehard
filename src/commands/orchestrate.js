import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { runOrchestration } from "../meta/orchestrator.js"
import { buildReviewer, knownReviewers } from "../meta/reviewers.js"
import { createWorktree, removeWorktree, commitWorktree, isGitRepo, checkTrackedSecrets } from "../delegation/worktree.js"
import { diffHygiene } from "../project-plan/diff-hygiene.js"
import { recordAction } from "../vfa/provenance.js"
import { stripBom } from "../util/json.js"
import { section, success, warn, error, info } from "../cli/index.js"

const DEFAULT_MATRIX = { claude: ["implementation", "refactor", "large-context"], codex: ["code-review", "patches", "tests"], opencode: ["isolated-task"] }

/**
 * `gstack_vibehard orchestrate <planId> [--verify-with <harness>] [--reviewer <id>]
 * [--parallel <n>] [--yes] [--json]` — Meta-Harness v2 (PRD14 §6.5): camada sobre
 * worktree+executor com VERIFIER independente e DUPLA VERIFICAÇÃO (reviewer LLM
 * plugável advisory + diff-hygiene determinístico bloqueante). SEM auto-merge:
 * passo `passed` vira branch; o resto é descartado. Tudo no provenance.
 * Reviewer indisponível → fallback determinístico DECLARADO (nunca OK falso).
 * `--parallel <n>` roda passos independentes (dependsOn) em paralelo.
 */
const flagAfter = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
// posicional = planId; valores de flags (--verify-with X etc) não contam.
function resolvePlanId(args) {
  const idxs = ["--verify-with", "--reviewer", "--parallel"].map((n) => args.indexOf(n))
  const flagValueIdx = new Set(idxs.filter((i) => i >= 0).map((i) => i + 1))
  return args.filter((a, i) => !a.startsWith("-") && !flagValueIdx.has(i))[0]
}
function parseOrchestrateArgs(args) {
  return {
    json: args.includes("--json"),
    yes: args.includes("--yes"),
    verifyWith: flagAfter(args, "--verify-with"),
    reviewerId: flagAfter(args, "--reviewer") || null,
    concurrency: Math.max(1, parseInt(flagAfter(args, "--parallel"), 10) || 1),
    planId: resolvePlanId(args),
  }
}

// @returns plan (obj) ou null (já imprimiu o erro).
function loadOrchestratePlan(cwd, a) {
  const planDir = a.planId ? join(cwd, ".gstack", "tasks", a.planId) : null
  if (!planDir || !existsSync(join(planDir, "task.json"))) {
    if (a.json) process.stdout.write('{"error":"plan_not_found"}\n')
    else error('Plano não encontrado. Gere com `task "<pedido>"` e passe o planId.')
    return null
  }
  return JSON.parse(stripBom(readFileSync(join(planDir, "task.json"), "utf-8")))
}

// @returns mensagem { level, msg } ou null se pode prosseguir.
function preflightOrchestrate(cwd, yes) {
  if (!isGitRepo(cwd)) return { level: "error", msg: "`orchestrate` exige um repositório git (worktree por executor)." }
  const tracked = checkTrackedSecrets(cwd)
  if (tracked.length) return { level: "error", msg: `.env RASTREADO (${tracked.join(", ")}) — não orquestro (segredo iria pra worktree).` }
  if (!yes) return { level: "warn", msg: "`orchestrate` executa comandos reais em worktree por passo. Releia o plano e rode com `--yes`." }
  return null
}
// @returns true se deve abortar (já imprimiu). Injeção (executeStep/gate) pula o preflight.
function orchestrateBlocked(cwd, a, opts) {
  if (opts.executeStep || opts.gate) return false
  const pf = preflightOrchestrate(cwd, a.yes)
  if (!pf) return false
  ;(pf.level === "warn" ? warn : error)(pf.msg)
  return true
}

const defaultExec = (f, ar, o) => execFileSync(f, ar, { stdio: "pipe", encoding: "utf-8", timeout: 600000, ...o })
// Reviewer LLM plugável (advisory). Indisponível → deterministic_only declarado.
const resolveReviewer = (opts, a) => opts.reviewer || (a.reviewerId ? buildReviewer(a.reviewerId, { exec: opts.reviewerExec }) : null)
function maybeWarnReviewer(reviewer, json) {
  if (!(reviewer && !reviewer.available && !json)) return
  warn(`Reviewer '${reviewer.id}' indisponível: ${reviewer.note || "sem detalhe"} (disponíveis: ${knownReviewers().join(", ")})`)
  warn("Cobertura: deterministic_only — o gate determinístico decide sozinho (honesto, sem OK falso).")
}

function makeExecutor(cwd, plan, exec, wts) {
  return (step) => {
    const branch = `orch/${plan.id}-${step.id}`.replace(/[^a-zA-Z0-9._/-]/g, "-")
    const wt = createWorktree(cwd, { branch, exec })
    wts.set(step.id, wt)
    if (Array.isArray(step.command) && step.command.length) exec(step.command[0], step.command.slice(1), { cwd: wt.dir })
    return { branch: wt.branch }
  }
}
function makeGate(exec, wts) {
  return (step) => {
    const wt = wts.get(step.id)
    if (!wt) return { passed: false, reason: "sem worktree" }
    try { exec("git", ["add", "-A"], { cwd: wt.dir }) } catch { /* ok */ }
    const r = diffHygiene({ cwd: wt.dir, exec })
    return { passed: r.status !== "fail", reason: r.status === "fail" ? "diff-hygiene HIGH" : undefined }
  }
}
function buildOrchestrationSpec(cwd, plan, a, opts, exec, wts, reviewer) {
  return {
    runId: plan.id,
    steps: (plan.steps || []).map((s) => ({ ...s, specialty: s.specialty || "implementation" })),
    matrix: opts.matrix || DEFAULT_MATRIX,
    verifyWith: a.verifyWith,
    reviewer,
    concurrency: a.concurrency,
    caps: opts.caps || readCaps(cwd),
    executeStep: opts.executeStep || makeExecutor(cwd, plan, exec, wts),
    // hook advisory legado (testes); sem ele o orchestrator usa o reviewer plugável.
    verifierReview: opts.verifierReview,
    gate: opts.gate || makeGate(exec, wts),
    record: (e) => { try { recordAction(cwd, e) } catch { /* best-effort */ } },
  }
}

// finaliza worktrees: passed → commit + branch p/ merge humano; senão → descarta. SEM auto-merge.
function finalizeWorktrees(cwd, result, plan, wts, exec) {
  for (const s of result.steps) {
    const wt = wts.get(s.stepId)
    if (!wt) continue
    if (s.status === "passed") {
      try { commitWorktree(wt.dir, `orchestrate ${plan.id}: ${s.stepId}`, { exec }) } catch { /* nada a commitar */ }
      removeWorktree(cwd, wt.dir, wt.branch, { keepBranch: true, exec })
    } else removeWorktree(cwd, wt.dir, wt.branch, { exec })
  }
}

const stepFn = (status) => (status === "passed" ? success : (status === "needs_human_review" ? warn : error))
const stepLine = (s) => `  ${s.stepId}: ${s.status} · executor=${s.executor} verifier=${s.verifier}${s.reason ? ` (${s.reason})` : ""}`
function renderOrchestrateFooter(result, plan) {
  if (result.handoff) error(`  ⛔ handoff: ${result.handoff.reason}`)
  const branches = result.steps.filter((s) => s.status === "passed").map((s) => `orch/${plan.id}-${s.stepId}`)
  info(`  Branches prontos pra merge (SEM auto-merge): ${branches.join(", ") || "(nenhum)"}`)
  info(`  Cobertura de revisão: ${result.reviewerCoverage}${result.reviewer ? ` (reviewer: ${result.reviewer.id}, ${result.reviewer.mode})` : ""}`)
  info("  Limites atuais (honestos):")
  for (const l of result.limits) info(`   • ${l}`)
}
function renderOrchestrate(result, plan) {
  section(`orchestrate — ${plan.id}`)
  for (const s of result.steps) stepFn(s.status)(stepLine(s))
  renderOrchestrateFooter(result, plan)
}
function emitOrchestrateResult(result, plan, json) {
  if (json) { process.stdout.write(JSON.stringify({ planId: plan.id, ...result }) + "\n"); if (result.status === "handoff") process.exitCode = 1; return }
  renderOrchestrate(result, plan)
}

export async function orchestrateCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const a = parseOrchestrateArgs(args)
  const plan = loadOrchestratePlan(cwd, a)
  if (!plan) return
  if (orchestrateBlocked(cwd, a, opts)) return
  const exec = opts.exec || defaultExec
  const wts = new Map()
  const reviewer = resolveReviewer(opts, a)
  maybeWarnReviewer(reviewer, a.json)
  const result = await runOrchestration(buildOrchestrationSpec(cwd, plan, a, opts, exec, wts, reviewer))
  finalizeWorktrees(cwd, result, plan, wts, exec)
  emitOrchestrateResult(result, plan, a.json)
}

function readCaps(cwd) {
  try {
    const lb = JSON.parse(stripBom(readFileSync(join(cwd, ".gstack", "loop-budget.json"), "utf-8")))
    return { maxIterations: lb.maxIterations, maxConsecutiveSameFailure: lb.maxConsecutiveSameFailure }
  } catch { return {} }
}
