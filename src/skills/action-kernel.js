import { mkdirSync, appendFileSync, existsSync, readFileSync } from "fs"
import { join, dirname, resolve, relative, isAbsolute } from "path"
import { performance } from "perf_hooks"
import { createHash } from "crypto"
import { redactSecrets, hasSecret } from "../security/redact.js"
import { isUiWrite } from "./design-system.js"

/**
 * Action Checkpoint Kernel (PRD36 36.1). Substitui o "tudo ou nada" (suíte no
 * Stop) por checkpoints POR AÇÃO em 3 níveis, bounded:
 *
 *  1. ANTES de cada ação (`preAction`): policy, secrets, comando destrutivo,
 *     escopo, plano, design — checagens DETERMINÍSTICAS (sem rede), p95 < 250ms.
 *  2. DEPOIS de cada ação (`postAction`): recibo REDIGIDO — arquivos, exit code,
 *     digests de entrada/saída. Nunca o prompt bruto, nunca segredo.
 *  3. FECHAMENTO de etapa (`stepClose`): escolhe a checagem pelo TIPO do diff
 *     (testes incrementais / QG / navegador / migrations) — NUNCA a suíte inteira
 *     por edição (o erro da v2.2.0).
 *
 * Ledger `.gstack/runs/<runId>/actions.jsonl` (uma linha por ação) reconstrói o
 * que rodou: gates REALMENTE executados, decisão+justificativa, digests, arquivos.
 * Sem prompt bruto, sem segredo. PURO/testável (io injetável).
 */

export const ACTION_KERNEL_SCHEMA = "gstack.action-kernel.v1"
export const ACTION_DECISIONS = Object.freeze(["allow", "warn", "deny"])

// Espelha os padrões destrutivos do plugin OpenCode (gstack-security.js). Mantidos
// em sincronia: o plugin bloqueia no harness; o kernel bloqueia no fluxo da CLI.
const DESTRUCTIVE_PATTERNS = Object.freeze([
  { re: /\brm\s+-rf\s+[/\\](\s|$)/i, reason: "rm -rf / (destruiria o sistema)" },
  { re: /\brm\s+-rf\s+~[/\\]/i, reason: "rm -rf na home" },
  { re: /\brm\s+-rf\s+\$HOME[/\\]/i, reason: "rm -rf na home" },
  { re: /\brm\s+-rf\s+--no-preserve-root\b/i, reason: "rm --no-preserve-root" },
  { re: /\bchmod\s+-R\s+777\s+[/\\]/i, reason: "chmod 777 /" },
  { re: /\bgit\s+push\s+.*--force(?!-with-lease)\b/i, reason: "git push --force (use --force-with-lease)" },
  { re: /\bdrop\s+(table|database|schema)\b/i, reason: "DROP destrutivo em banco" },
  { re: /[|;]\s*(sh|bash|zsh)\s+-c\s+["'](?:curl|wget)/i, reason: "pipe para shell remoto" },
])

const digest = (v) => "sha256:" + createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v ?? "")).digest("hex").slice(0, 12)
const finding = (name, gate, level, reason) => ({ name, gate, level, reason })

// ── Nível 1: checagens pre-action (cada uma: null se não-aplicável) ──────────────
function actionText(action) {
  return [action.command, action.content].filter((s) => typeof s === "string" && s.length).join("\n")
}

function policyCheck(action, ctx) {
  if (!Array.isArray(ctx.policy) || !ctx.policy.length) return null
  const text = actionText(action)
  const hit = ctx.policy.find((p) => (p.pattern instanceof RegExp ? p.pattern : new RegExp(p.pattern)).test(text))
  return hit ? finding("policy", "policy-deny-gate", "deny", hit.reason || "violação de policy") : finding("policy", "policy-deny-gate", "pass")
}

function secretsCheck(action) {
  const text = actionText(action)
  if (!text) return null
  return hasSecret(text) ? finding("secrets", "secret-deny-gate", "deny", "segredo detectado no payload da ação") : finding("secrets", "secret-deny-gate", "pass")
}

function destructiveCheck(action) {
  if (!action.command) return null
  const hit = DESTRUCTIVE_PATTERNS.find((p) => p.re.test(action.command))
  return hit ? finding("destructive", "command-destructive-gate", "deny", hit.reason) : finding("destructive", "command-destructive-gate", "pass")
}

// Alvo escapa a raiz do workspace? (não escreve na home por engano — lição CWD-guard)
function escapesRoot(target, root) {
  const abs = isAbsolute(target) ? target : resolve(root, target)
  const rel = relative(root, abs)
  return rel === "" ? false : rel.startsWith("..") || isAbsolute(rel)
}

function scopeCheck(action, ctx) {
  const targets = [...(action.files || []), action.targetPath].filter(Boolean)
  if (!ctx.root || !targets.length) return null
  const escaping = targets.filter((t) => escapesRoot(t, ctx.root))
  return escaping.length
    ? finding("scope", "scope-guard-gate", "deny", `escrita fora do workspace: ${escaping.join(", ")}`)
    : finding("scope", "scope-guard-gate", "pass")
}

function planCheck(action, ctx) {
  const writesCode = Boolean(action.writesCode || (action.files || []).length)
  if (!writesCode) return null
  if (ctx.planApproved === true) return finding("plan", "plan-before-code-gate", "pass")
  return finding("plan", "plan-before-code-gate", ctx.requirePlan ? "deny" : "warn", "escrita de código sem plano aprovado")
}

const designFinding = (level, reason) => finding("design", "design-system-gate", level, reason)

function designLevel(action, ctx) {
  if (typeof ctx.evaluateDesign === "function") {
    const r = ctx.evaluateDesign(action) || {}
    return r.blocked ? ["deny", r.reason || "UI sem design system"] : ["pass"]
  }
  if (ctx.designResolved === true) return ["pass"]
  return ["warn", "design system não verificado para escrita de UI"]
}

function designCheck(action, ctx) {
  if (!(action.files || []).some(isUiWrite)) return null
  return designFinding(...designLevel(action, ctx))
}

const PRE_CHECKS = Object.freeze([policyCheck, secretsCheck, destructiveCheck, scopeCheck, planCheck, designCheck])

const worstDecision = (checks) =>
  checks.some((c) => c.level === "deny") ? "deny" : checks.some((c) => c.level === "warn") ? "warn" : "allow"

/** Nível 1: roda as checagens aplicáveis e decide. Bounded, sem rede. */
export function preAction(action = {}, ctx = {}) {
  const start = performance.now()
  const checks = PRE_CHECKS.map((c) => c(action, ctx)).filter(Boolean)
  return {
    schemaVersion: ACTION_KERNEL_SCHEMA,
    decision: worstDecision(checks),
    checks,
    gatesExecuted: checks.map((c) => c.name),
    elapsedMs: performance.now() - start,
  }
}

// ── Nível 2: recibo redigido (sem prompt bruto, sem segredo) ─────────────────────
const resultExit = (result) => (result.exitCode ?? (result.ok === false ? 1 : 0))
const resultText = (result) => String(result.summary ?? result.stdout ?? result.output ?? "")

/** Nível 2: recibo da ação — digests + resumo redigido, nunca o conteúdo cru. */
export function postAction(action = {}, result = {}) {
  const exitCode = resultExit(result)
  const raw = resultText(result)
  return {
    schemaVersion: ACTION_KERNEL_SCHEMA,
    tool: action.tool || null,
    harness: action.harness || "unknown",
    files: action.files || [],
    exitCode,
    ok: exitCode === 0,
    inputDigest: digest(actionText(action)),
    outputDigest: digest(raw),
    summary: redactSecrets(raw).redacted.slice(0, 300),
  }
}

// ── Nível 3: fechamento de etapa (checagem pelo tipo do diff — nunca a suíte) ─────
// Ordem = prioridade (o primeiro que casar define o tipo do arquivo).
const DIFF_RULES = Object.freeze([
  { type: "migration", test: (f) => /(^|[/\\])migrations[/\\]/i.test(f) || /\.sql$/i.test(f) || /schema\.prisma$/i.test(f) },
  { type: "frontend", test: (f) => /\.(tsx|jsx|css|scss|vue|svelte)$/i.test(f) || /(^|[/\\])(components|pages|app)[/\\]/i.test(f) },
  { type: "backend", test: (f) => /(^|[/\\])(api|server|routes)[/\\]/i.test(f) || /\.(controller|service|route)\.(t|j)s$/i.test(f) },
  { type: "test", test: (f) => /\.(test|spec)\.(t|j)sx?$/i.test(f) || /(^|[/\\])tests?[/\\]/i.test(f) },
  { type: "config", test: (f) => /\.(json|ya?ml|toml)$/i.test(f) },
  { type: "docs", test: (f) => /\.(md|mdx|txt)$/i.test(f) },
])

function classifyFile(f) {
  const rule = DIFF_RULES.find((r) => r.test(f))
  return rule ? rule.type : "other"
}

/** Tipos presentes num diff + o primário (maior prioridade da ordem DIFF_RULES). */
export function classifyDiff(files = []) {
  const types = [...new Set(files.map(classifyFile))]
  const primary = DIFF_RULES.map((r) => r.type).find((t) => types.includes(t)) || types[0] || "none"
  return { types, primary, files: [...files] }
}

// Checagem certa por tipo — testes SEMPRE incrementais (nunca a suíte por edição).
const STEP_CHECKS = Object.freeze({
  migration: [{ name: "migration-present", why: "mudança de schema exige migration" }, { name: "db-smoke", why: "smoke da migration" }],
  frontend: [{ name: "incremental-tests", why: "testa só a área alterada" }, { name: "visual-evidence", why: "mudança de UI precisa de evidência de navegador (PRD37 37.2)" }],
  backend: [{ name: "incremental-tests", why: "testa só a área alterada" }, { name: "typecheck", why: "contrato de tipos" }],
  test: [{ name: "incremental-tests", why: "roda os testes tocados" }],
  config: [{ name: "typecheck", why: "config pode quebrar tipos" }, { name: "command-lint", why: "cita comandos válidos" }],
  docs: [{ name: "command-lint", why: "docs citam comandos reais" }],
  other: [{ name: "incremental-tests", why: "fallback conservador" }],
})

const dedupeByName = (arr) => [...new Map(arr.map((c) => [c.name, c])).values()]

/** Nível 3: dado o diff, QUAIS checagens rodar — nunca a suíte inteira. */
export function stepClose(files = []) {
  const { types, primary } = classifyDiff(files)
  const checks = dedupeByName(types.flatMap((t) => STEP_CHECKS[t] || STEP_CHECKS.other))
  return {
    schemaVersion: ACTION_KERNEL_SCHEMA,
    primary,
    types,
    checks,
    ranFullSuite: false,
    note: "checagem escolhida pelo tipo do diff; a suíte inteira roda SÓ em verify/proof (nunca por edição).",
  }
}

// ── Ledger .gstack/runs/<runId>/actions.jsonl (append-only, sanitizado) ───────────
const FORBIDDEN_FIELDS = /(prompt|transcript|env|token|secret|password|apikey|api[-_]?key|authorization|credential)/i

function sanitizeEntry(entry) {
  const out = {}
  for (const [k, v] of Object.entries(entry)) {
    if (FORBIDDEN_FIELDS.test(k)) continue
    out[k] = typeof v === "string" ? redactSecrets(v).redacted.slice(0, 500) : v
  }
  return out
}

const defaultIo = Object.freeze({
  appendLine: (p, line) => { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, line + "\n") },
  read: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
})

export function actionsPath(root, runId) {
  return join(root, ".gstack", "runs", runId, "actions.jsonl")
}

/** Junta pre+post numa entrada única do ledger (o que um produtor de ação grava). */
export function buildActionRecord({ action = {}, ctx = {}, result = {} } = {}) {
  const pre = preAction(action, ctx)
  const post = postAction(action, result)
  return {
    tool: post.tool, harness: post.harness,
    decision: pre.decision, gatesExecuted: pre.gatesExecuted,
    reasons: pre.checks.filter((c) => c.level !== "pass").map((c) => `${c.name}:${c.level}:${c.reason || ""}`),
    files: post.files, exitCode: post.exitCode, ok: post.ok,
    inputDigest: post.inputDigest, outputDigest: post.outputDigest, summary: post.summary,
    preElapsedMs: Number(pre.elapsedMs.toFixed(3)),
  }
}

/** Grava uma ação no ledger do run (sanitizada: sem campo proibido, redigida). */
export function recordAction({ root, runId, entry, io = defaultIo } = {}) {
  const record = { at: new Date().toISOString(), ...sanitizeEntry(entry) }
  io.appendLine(actionsPath(root, runId), JSON.stringify(record))
  return record
}

/** Lê o ledger de ações do run (reconstrói o que rodou). */
export function readActions({ root, runId, io = defaultIo } = {}) {
  const raw = io.read(actionsPath(root, runId))
  if (!raw) return []
  return raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
