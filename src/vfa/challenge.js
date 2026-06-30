/**
 * Challenge-Response para ações de ALTO RISCO (PRD 13 §10.5 / PR13.5). Antes de uma
 * ação perigosa (escrita em config GLOBAL de harness, leitura de segredo, MCP global,
 * comando destrutivo, exfiltração), a policy retorna `challenge`: o agente precisa
 * justificar com EVIDÊNCIA estruturada (owner do manifest, backup, rollback...). Sem
 * todas as evidências → `deny`. Em harness SEM hook real, o status é `posthoc_audit_only`
 * (não bloqueia antes — só audita depois). PURO/determinístico/testável.
 */

const HIGH_RISK = Object.freeze([
  {
    id: "global-config-write",
    match: (a) => a.intent === "edit_file" && a.target && a.target.scope === "global" && /(\.claude|\.codex|\.config|\.cursor|opencode|windsurf|\.mcp|copilot|gemini)/i.test(a.target.pathOrName || ""),
    evidence: ["install-manifest-owner", "backup-path", "rollback-plan"],
  },
  { id: "read-secret", match: (a) => a.intent === "read_secret", evidence: ["secret-policy-authorization", "scope"] },
  { id: "global-mcp", match: (a) => a.intent === "call_mcp" && a.target && a.target.scope === "global", evidence: ["install-manifest-owner", "backup-path"] },
  { id: "destructive-command", match: (a) => a.intent === "run_command" && /\brm\s+-rf\b|\bdrop\s+database\b|\bformat\b|\bgit\s+push\s+--force\b/i.test((a.target && a.target.pathOrName) || ""), evidence: ["explicit-approval", "rollback-plan"] },
  { id: "network-exfil", match: (a) => (a.intent === "call_network" || a.intent === "network") && a.target && a.target.sensitive === true, evidence: ["data-classification", "destination-allowlist"] },
])

/** Classifica o risco de uma ação. → { level: "high"|"low", rule, requiredEvidence }. */
export function classifyRisk(action = {}) {
  for (const rule of HIGH_RISK) {
    try { if (rule.match(action)) return { level: "high", rule: rule.id, requiredEvidence: rule.evidence } } catch { /* regra defensiva */ }
  }
  return { level: "low", rule: null, requiredEvidence: [] }
}

const POSTHOC = new Set(["instructional", "detection_only"])

/**
 * Avalia o challenge. `enforcement` (do adapter-matrix do harness) decide se há
 * bloqueio REAL. → { decision: "allow"|"deny"|"posthoc_audit_only", risk, rule?, missing? }.
 * - low risk → allow.
 * - high risk + harness instrucional → posthoc_audit_only (não bloqueia antes).
 * - high risk + hook real: exige TODAS as evidências; faltou → deny.
 */
export function evaluateChallenge(action = {}, response = {}, opts = {}) {
  const risk = classifyRisk(action)
  if (risk.level !== "high") return { decision: "allow", risk: "low" }
  if (POSTHOC.has(opts.enforcement)) {
    return { decision: "posthoc_audit_only", risk: "high", rule: risk.rule, note: "harness sem hook real — auditoria posterior, não bloqueio (não é Zero-Trust)" }
  }
  const ev = response.evidence || {}
  const provided = new Set(Object.keys(ev).filter((k) => ev[k] != null && String(ev[k]).trim() !== ""))
  const missing = risk.requiredEvidence.filter((e) => !provided.has(e))
  if (missing.length) return { decision: "deny", risk: "high", rule: risk.rule, missing }
  return { decision: "allow", risk: "high", rule: risk.rule, missing: [] }
}

/** O challenge estruturado a apresentar ao agente (o que ele precisa justificar). */
export function buildChallenge(action = {}) {
  const risk = classifyRisk(action)
  if (risk.level !== "high") return null
  return {
    challenge: `Justifique a ação de alto risco (${risk.rule}) em ${(action.target && action.target.pathOrName) || "?"}`,
    requiredEvidence: risk.requiredEvidence,
  }
}
