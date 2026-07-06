import { existsSync, mkdirSync, writeFileSync, readdirSync } from "fs"
import { join } from "path"
import { audit } from "./auditor.js"
import { promotedDir } from "./learning.js"
import { createWorktree, removeWorktree, commitWorktree } from "../delegation/worktree.js"
import { recordAction } from "../vfa/provenance.js"

/**
 * `dream improve` — fluxo ISOLADO de auto-melhoria (PRD25 Sprint 25.4, PRD14 §4.5).
 *
 * Regras invioláveis:
 *  - roda SEMPRE em worktree (nunca no branch do usuário);
 *  - NUNCA auto-merge: o resultado é uma PROPOSTA revisável (branch preservado);
 *  - o gate final é `verify` (determinístico) — LLM nunca decide "pronto";
 *  - sem executor configurado, retorna PLANO/proposta (não falha de modo opaco);
 *  - nunca toca `.env*`, configs globais, nem chama modelo externo sem opt-in
 *    (o executor é INJETADO — o GStack não embute nenhum).
 *
 * PURO/injetável: `deps` = { audit, worktree:{create,remove,commit}, verify,
 * executor, record, now } — testes não tocam git/verify reais.
 */

export function improveDir(cwd) { return join(cwd, ".gstack", "dream", "improve") }

// ── plano determinístico (sem LLM): claims não-REAL + staging aguardando corpus ──
function stagedItems(cwd) {
  const dir = promotedDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => ({
    kind: "staged_proposal", file: join(dir, f),
    action: "revisar e mover manualmente para core/knowledge + agents build --check",
  }))
}
function claimItems(auditReport) {
  return auditReport.claims.filter((c) => c.status !== "REAL").map((c) => ({
    kind: "claim_gap", id: c.id, status: c.status, severity: c.severity,
    missing: c.missing, action: `fechar evidência de '${c.id}' (${c.missing.join("; ") || "?"})`,
  }))
}

/** Plano de melhoria DETERMINÍSTICO (auditoria + staging). Nunca edita nada. */
export function buildImprovePlan(cwd, deps = {}) {
  const auditFn = deps.audit || audit
  const report = auditFn({ root: cwd })
  return {
    generatedAt: (deps.now || (() => new Date().toISOString()))(),
    source: "deterministic (dream audit + staging)",
    items: [...claimItems(report), ...stagedItems(cwd)],
    auditSummary: report.summary,
  }
}

const proposalNote = "proposta revisável — revise o branch e faça merge MANUAL após `verify`; dream improve NUNCA faz merge"
function writeImproveProposal(cwd, proposal) {
  mkdirSync(improveDir(cwd), { recursive: true })
  const file = join(improveDir(cwd), `${proposal.runId}.json`)
  writeFileSync(file, JSON.stringify(proposal, null, 2) + "\n")
  return file
}

function recordImprove(cwd, runId, decision, detail, record) {
  try {
    (record || recordAction)(cwd, {
      runId, intent: `dream:improve:${detail}`,
      actor: { harness: "gstack", agent: "dream-improve" },
      target: { kind: "worktree", pathOrName: detail },
      policy: { decision, rules: ["worktree-isolated", "no-auto-merge", "verify-gated"] },
    })
  } catch { /* provenance best-effort */ }
}

// ── executor ausente: devolve o plano como proposta (não falha opaco) ─────────
function proposalOnly(cwd, runId, plan, deps) {
  const proposal = { runId, mode: "proposal", plan, note: "nenhum executor configurado — plano gerado; execute os itens manualmente ou injete um executor (opt-in)", createdAt: plan.generatedAt }
  const file = writeImproveProposal(cwd, proposal)
  recordImprove(cwd, runId, "allow", "proposal-only", deps.record)
  return { ...proposal, file }
}

// ── execução isolada: worktree → executor → verify → proposta (sem merge) ────
function runIsolated(cwd, runId, plan, deps) {
  const wt = deps.worktree || { create: createWorktree, remove: removeWorktree, commit: commitWorktree }
  const { dir, branch } = wt.create(cwd, { branch: `gstack/dream-improve-${runId}` })
  try {
    const executed = deps.executor({ cwd: dir, plan })
    wt.commit(dir, `dream improve ${runId} (proposta revisável)`)
    const verdict = deps.verify({ cwd: dir, profile: "full" })
    const proposal = {
      runId, mode: "executed", plan, branch, worktree: dir,
      executor: executed || { note: "executor não reportou detalhes" },
      verify: { status: verdict.status, ready: verdict.ready === true },
      merged: false, note: proposalNote, createdAt: plan.generatedAt,
    }
    const file = writeImproveProposal(cwd, proposal)
    recordImprove(cwd, runId, "allow", branch, deps.record)
    return { ...proposal, file }
  } finally {
    // worktree removida, BRANCH PRESERVADO para review humano (nunca merge).
    wt.remove(cwd, dir, branch, { keepBranch: true })
  }
}

/**
 * Ponto de entrada do `dream improve`.
 * @returns dry-run → {mode:"dry-run", plan} (nada escrito);
 *          sem executor → {mode:"proposal", ...} (plano gravado, não falha opaco);
 *          com executor → {mode:"executed", verify, merged:false, branch} (review humano).
 */
export function dreamImprove(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const deps = opts.deps || {}
  const runId = opts.runId || `improve-${Date.now().toString(36)}`
  const plan = buildImprovePlan(cwd, deps)
  if (opts.dryRun) return { mode: "dry-run", runId, plan, note: "nada foi escrito nem executado" }
  if (typeof deps.executor !== "function") return proposalOnly(cwd, runId, plan, deps)
  return runIsolated(cwd, runId, plan, deps)
}
