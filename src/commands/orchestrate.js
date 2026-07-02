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
export async function orchestrateCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const yes = args.includes("--yes")
  const vi = args.indexOf("--verify-with")
  const verifyWith = vi >= 0 ? args[vi + 1] : undefined
  const ri = args.indexOf("--reviewer")
  const reviewerId = ri >= 0 ? args[ri + 1] : null
  const pi = args.indexOf("--parallel")
  const concurrency = pi >= 0 ? Math.max(1, parseInt(args[pi + 1], 10) || 1) : 1
  // posicional = planId; valores de flags (--verify-with X, --reviewer Y, --parallel N) não contam
  const flagValueIdx = new Set([vi, ri, pi].filter((i) => i >= 0).map((i) => i + 1))
  const planId = args.filter((a, i) => !a.startsWith("-") && !flagValueIdx.has(i))[0]

  const planDir = planId ? join(cwd, ".gstack", "tasks", planId) : null
  if (!planDir || !existsSync(join(planDir, "task.json"))) {
    if (json) { process.stdout.write('{"error":"plan_not_found"}\n'); return }
    error('Plano não encontrado. Gere com `task "<pedido>"` e passe o planId.'); return
  }
  const plan = JSON.parse(stripBom(readFileSync(join(planDir, "task.json"), "utf-8")))

  const injected = opts.executeStep || opts.gate
  if (!injected) {
    if (!isGitRepo(cwd)) { error("`orchestrate` exige um repositório git (worktree por executor)."); return }
    const tracked = checkTrackedSecrets(cwd)
    if (tracked.length) { error(`.env RASTREADO (${tracked.join(", ")}) — não orquestro (segredo iria pra worktree).`); return }
    if (!yes) { warn("`orchestrate` executa comandos reais em worktree por passo. Releia o plano e rode com `--yes`."); return }
  }

  const exec = opts.exec || ((f, a, o) => execFileSync(f, a, { stdio: "pipe", encoding: "utf-8", timeout: 600000, ...o }))
  const wts = new Map()

  // Reviewer LLM plugável (advisory). Indisponível → deterministic_only declarado.
  const reviewer = opts.reviewer || (reviewerId ? buildReviewer(reviewerId, { exec: opts.reviewerExec }) : null)
  if (reviewer && !reviewer.available && !json) {
    warn(`Reviewer '${reviewer.id}' indisponível: ${reviewer.note || "sem detalhe"} (disponíveis: ${knownReviewers().join(", ")})`)
    warn("Cobertura: deterministic_only — o gate determinístico decide sozinho (honesto, sem OK falso).")
  }

  const result = await runOrchestration({
    runId: plan.id,
    steps: (plan.steps || []).map((s) => ({ ...s, specialty: s.specialty || "implementation" })),
    matrix: opts.matrix || DEFAULT_MATRIX,
    verifyWith,
    reviewer,
    concurrency,
    caps: opts.caps || readCaps(cwd),
    executeStep: opts.executeStep || ((step) => {
      const branch = `orch/${plan.id}-${step.id}`.replace(/[^a-zA-Z0-9._/-]/g, "-")
      const wt = createWorktree(cwd, { branch, exec })
      wts.set(step.id, wt)
      if (Array.isArray(step.command) && step.command.length) exec(step.command[0], step.command.slice(1), { cwd: wt.dir })
      return { branch: wt.branch }
    }),
    // hook advisory legado (testes); sem ele, o orchestrator usa o reviewer plugável
    // quando disponível, senão no-op (o gate determinístico decide sozinho).
    verifierReview: opts.verifierReview,
    gate: opts.gate || ((step) => {
      const wt = wts.get(step.id)
      if (!wt) return { passed: false, reason: "sem worktree" }
      try { exec("git", ["add", "-A"], { cwd: wt.dir }) } catch { /* ok */ }
      const r = diffHygiene({ cwd: wt.dir, exec })
      return { passed: r.status !== "fail", reason: r.status === "fail" ? "diff-hygiene HIGH" : undefined }
    }),
    record: (e) => { try { recordAction(cwd, e) } catch { /* best-effort */ } },
  })

  // finaliza worktrees: passed → commit + branch p/ merge humano; senão → descarta. SEM auto-merge.
  for (const s of result.steps) {
    const wt = wts.get(s.stepId)
    if (!wt) continue
    if (s.status === "passed") {
      try { commitWorktree(wt.dir, `orchestrate ${plan.id}: ${s.stepId}`, { exec }) } catch { /* nada a commitar */ }
      removeWorktree(cwd, wt.dir, wt.branch, { keepBranch: true, exec })
    } else removeWorktree(cwd, wt.dir, wt.branch, { exec })
  }

  if (json) { process.stdout.write(JSON.stringify({ planId: plan.id, ...result }) + "\n"); if (result.status === "handoff") process.exitCode = 1; return }
  section(`orchestrate — ${plan.id}`)
  for (const s of result.steps) {
    const fn = s.status === "passed" ? success : (s.status === "needs_human_review" ? warn : error)
    fn(`  ${s.stepId}: ${s.status} · executor=${s.executor} verifier=${s.verifier}${s.reason ? ` (${s.reason})` : ""}`)
  }
  if (result.handoff) error(`  ⛔ handoff: ${result.handoff.reason}`)
  const branches = result.steps.filter((s) => s.status === "passed").map((s) => `orch/${plan.id}-${s.stepId}`)
  info(`  Branches prontos pra merge (SEM auto-merge): ${branches.join(", ") || "(nenhum)"}`)
  info(`  Cobertura de revisão: ${result.reviewerCoverage}${result.reviewer ? ` (reviewer: ${result.reviewer.id}, ${result.reviewer.mode})` : ""}`)
  info("  Limites atuais (honestos):")
  for (const l of result.limits) info(`   • ${l}`)
}

function readCaps(cwd) {
  try {
    const lb = JSON.parse(stripBom(readFileSync(join(cwd, ".gstack", "loop-budget.json"), "utf-8")))
    return { maxIterations: lb.maxIterations, maxConsecutiveSameFailure: lb.maxConsecutiveSameFailure }
  } catch { return {} }
}
