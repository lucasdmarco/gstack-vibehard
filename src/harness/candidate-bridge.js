import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { execFileSync as defaultExec } from "child_process"
import { redactSecrets } from "../security/redact.js"
import { createWorktree, removeWorktree, checkTrackedSecrets, isGitRepo } from "../delegation/worktree.js"

/**
 * Bridge de delegação para candidatos externos (Codebuff/Freebuff), PRD18 Sprint 6.
 * REGRAS INEGOCIÁVEIS:
 *  - worktree OBRIGATÓRIA (nunca toca o branch principal);
 *  - `.env*` rastreado bloqueia (o modelo externo não vê segredo);
 *  - contexto project-scoped seguro: `knowledge.md` sem secrets + `.codebuffignore`
 *    derivado da policy; metadados em `.gstack/harness/<id>.json`; NADA global;
 *  - reviewer é ADVISORY — o gate final é o verify DETERMINÍSTICO, rodado depois;
 *  - Freebuff exige aceite de disclosure na 1ª vez (mesmo com `--yes`).
 */

const ALWAYS_IGNORE = Object.freeze([".env", ".env.*", "**/.env", "**/.env.*", "*.pem", "*.key", "id_rsa*", "secrets/", ".git/", "node_modules/"])

/** `.codebuffignore` = denylist fixa (secrets) + denies da policy. Sempre bloqueia `.env*`. */
export function buildIgnoreFile(policy = {}) {
  const denies = Array.isArray(policy.deny) ? policy.deny.filter((p) => typeof p === "string") : []
  return [...new Set([...ALWAYS_IGNORE, ...denies])].join("\n") + "\n"
}

/** knowledge.md de alto nível — sem conteúdo de arquivo, redigido por garantia. */
export function buildKnowledgeMd({ projectName = "(projeto)", objective = "", stack = [] } = {}) {
  const body = [
    `# Knowledge — ${projectName}`, "",
    `Objetivo: ${objective || "(não informado)"}`,
    Array.isArray(stack) && stack.length ? `Stack: ${stack.join(", ")}` : "",
    "",
    "> Contexto de reviewer externo gerado pelo GStack. Sem secrets, sem `.env`, sem conteúdo confidencial.",
  ].filter(Boolean).join("\n")
  return redactSecrets(body).redacted + "\n"
}

function harnessDir(cwd) { return join(cwd, ".gstack", "harness") }
export function acceptancePath(cwd, id) { return join(harnessDir(cwd), `${id}-accepted.json`) }
export function hasAccepted(cwd, id) { return existsSync(acceptancePath(cwd, id)) }

export function recordAcceptance(cwd, id) {
  mkdirSync(harnessDir(cwd), { recursive: true })
  writeFileSync(acceptancePath(cwd, id), JSON.stringify({ accepted: true, ts: new Date().toISOString() }) + "\n")
  return acceptancePath(cwd, id)
}

export function writeBridgeMetadata(cwd, id, meta) {
  mkdirSync(harnessDir(cwd), { recursive: true })
  const p = join(harnessDir(cwd), `${id}.json`)
  writeFileSync(p, JSON.stringify({ id, ...meta, generatedAt: new Date().toISOString() }, null, 2) + "\n")
  return p
}

/**
 * Aceite de disclosure. `--yes` NUNCA pula a disclosure de rede na 1ª vez de um
 * candidato que exige aceite (Freebuff). @returns {ok} | {blocked, reason, disclosure}.
 */
export function acceptanceGate({ candidate, cwd, acceptDisclosure }) {
  if (!candidate.requiresAcceptance || hasAccepted(cwd, candidate.id)) return { ok: true }
  if (acceptDisclosure) { recordAcceptance(cwd, candidate.id); return { ok: true, firstTime: true } }
  return { blocked: true, reason: "first_time_disclosure", disclosure: [...candidate.disclosure] }
}

function guardTask({ task }) {
  return (!task || /\n/.test(String(task))) ? { status: "invalid_task", summary: "task vazia ou com newline" } : null
}
function guardWorktree({ worktree }) {
  return !worktree ? { status: "worktree_required", summary: "delegate a candidato externo EXIGE --worktree" } : null
}
function guardGit({ cwd, exec }) {
  return !isGitRepo(cwd, exec) ? { status: "not_git", summary: "--worktree exige um repositório git" } : null
}
function guardSecrets({ cwd, exec }) {
  const tracked = checkTrackedSecrets(cwd, exec)
  return tracked.length ? { status: "blocked_secrets", summary: `${tracked.length} arquivo(s) .env rastreado(s)`, tracked } : null
}
function guardAcceptance({ candidate, cwd, acceptDisclosure }) {
  const gate = acceptanceGate({ candidate, cwd, acceptDisclosure })
  return gate.blocked ? { status: "needs_acceptance", summary: "aceite de disclosure exigido (1ª vez)", disclosure: gate.disclosure } : null
}

const PREFLIGHT_GUARDS = [guardTask, guardWorktree, guardGit, guardSecrets, guardAcceptance]

/** Guardas pré-execução (worktree/git/secrets/aceite). null = liberado. */
function preflight(opts) {
  for (const guard of PREFLIGHT_GUARDS) {
    const blocked = guard(opts)
    if (blocked) return blocked
  }
  return null
}

/** Escreve contexto seguro na worktree + metadados. */
function prepareContext(wtDir, cwd, candidate, opts) {
  const knowledge = buildKnowledgeMd({ projectName: opts.projectName, objective: opts.task, stack: opts.stack })
  const ignore = buildIgnoreFile(opts.policy)
  writeFileSync(join(wtDir, "knowledge.md"), knowledge)
  writeFileSync(join(wtDir, `.${candidate.id}ignore`), ignore)
  const metaPath = writeBridgeMetadata(cwd, candidate.id, {
    enforcement: candidate.enforcement, reviewerOnly: true,
    externalModelRisk: candidate.externalModelRisk, networkRequired: candidate.networkRequired,
    worktree: wtDir, task: String(opts.task).slice(0, 200),
  })
  return { knowledge, ignore, metaPath }
}

/** Verify determinístico DEPOIS — é o gate final; reviewer externo é só advisory. */
function verifyAfter(wtDir, opts) {
  const runner = opts.verifyRunner
  if (typeof runner !== "function") return { status: "skipped", usable: false, note: "verifyRunner não injetado" }
  try { return runner({ cwd: wtDir, profile: opts.verifyProfile || "scaffold", exec: opts.exec }) }
  catch (e) { return { status: "blocked", usable: false, error: String(e.message || "verify falhou").slice(0, 160) } }
}

function conclude(verify, ctx, wt) {
  const passed = verify.status !== "blocked" && verify.status !== "failed"
  return {
    status: passed ? "review_ready" : "verify_failed",
    concluded: passed,
    reviewer: "advisory",
    verify: { status: verify.status, usable: !!verify.usable },
    reviewBranch: wt.branch,
    context: { knowledge: "knowledge.md", ignore: `.${ctx.id}ignore`, metadata: ctx.metaPath },
    summary: passed
      ? `Contexto seguro pronto em worktree; reviewer advisory. Gate final (verify): ${verify.status}. Revise e mergeie você.`
      : `Verify DETERMINÍSTICO falhou (${verify.status}) — conclusão IMPEDIDA. Reviewer externo não aprova nada.`,
  }
}

function maybeProvenance(opts, candidate, branch) {
  if (typeof opts.recordProvenance !== "function") return
  try { opts.recordProvenance({ candidate: candidate.id, task: String(opts.task).slice(0, 200), branch }) } catch { /* provenance best-effort */ }
}

/** Prepara contexto seguro na worktree, registra provenance e roda o verify final. */
function executeInWorktree(wt, cwd, candidate, opts, exec) {
  const ctx = prepareContext(wt.dir, cwd, candidate, { ...opts, exec })
  maybeProvenance(opts, candidate, wt.branch)
  const verify = verifyAfter(wt.dir, { ...opts, exec })
  return conclude(verify, { id: candidate.id, metaPath: ctx.metaPath }, wt)
}

/**
 * @param {object} opts { candidate, task, cwd, exec?, worktree, verifyRunner?, verifyProfile?,
 *   policy?, projectName?, stack?, acceptDisclosure?, recordProvenance? }
 */
export function runCandidateBridge(opts = {}) {
  const { candidate, cwd = process.cwd(), exec = defaultExec } = opts
  if (!candidate || !candidate.id) return { status: "invalid_candidate", summary: "candidate obrigatório" }
  const blocked = preflight({ ...opts, cwd, exec })
  if (blocked) return blocked
  let wt
  try { wt = createWorktree(cwd, { exec, dir: opts.worktreeDir }) }
  catch (e) { return { status: "worktree_failed", summary: `falha ao criar worktree: ${String(e.message).slice(0, 120)}` } }
  try { return executeInWorktree(wt, cwd, candidate, opts, exec) }
  finally { removeWorktree(cwd, wt.dir, wt.branch, { exec, keepBranch: true }) }
}
