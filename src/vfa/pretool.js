import { classifyRisk, buildChallenge } from "./challenge.js"
import { readAllReceipts, recordAction } from "./provenance.js"
import { recordHarnessEvent } from "../harness/events.js"

/**
 * Challenge-Response no CAMINHO DE EXECUÇÃO (PRD14 §6.4): o hook pre-tool do
 * harness (onde há hooks reais) chama `challenge pretool` antes de uma ação de
 * alto risco. O fluxo:
 *
 *   1. ação de alto risco SEM grant → deny + challenge (o agente é instruído a
 *      rodar `challenge evaluate --evidence ...`, que grava um recibo `allow`);
 *   2. recibo allow recente (grant, TTL 15min, mesma regra+alvo) → allow.
 *
 * Toda decisão pretool também vira recibo de provenance (hash-chain, run "pretool").
 * Harness sem hook real continua posthoc_audit_only via `evaluateChallenge` —
 * a matriz honesta não muda.
 */

const GRANT_TTL_MS = 15 * 60 * 1000
const PRETOOL_RUN = "pretool"

/** O recibo é um `allow` vindo de um challenge respondido? */
function isChallengeAllow(receipt) {
  const policy = (receipt && receipt.policy) || {}
  return policy.decision === "allow" && String(receipt.intent || "").startsWith("challenge:")
}

/** O recibo cobre exatamente esta regra e este alvo? (grant é por regra+alvo) */
function matchesGrant(receipt, rule, targetPath) {
  const rules = (receipt.policy && receipt.policy.rules) || []
  const target = receipt.target && receipt.target.pathOrName
  return rules.includes(rule) && target === targetPath
}

/** Grant mais recente e DENTRO do TTL para regra+alvo; null se não houver. */
export function findRecentGrant(projectDir, rule, targetPath, opts = {}) {
  const now = opts.now || Date.now()
  const ttlMs = opts.ttlMs || GRANT_TTL_MS
  const fresh = (r) => {
    const t = Date.parse(r.timestamp)
    return Number.isFinite(t) && now - t <= ttlMs
  }
  const receipts = readAllReceipts(projectDir)
  return [...receipts].reverse().find((r) => isChallengeAllow(r) && matchesGrant(r, rule, targetPath) && fresh(r)) || null
}

/** Payload do deny: o challenge estruturado + o comando exato para responder. */
function denyPayload(action, risk) {
  const ch = buildChallenge(action)
  const target = action?.target?.pathOrName || "?"
  const scope = action?.target?.scope === "global" ? " --scope global" : ""
  return {
    challenge: ch.challenge,
    requiredEvidence: ch.requiredEvidence,
    howTo: `gstack_vibehard challenge evaluate --intent ${action.intent} --target "${target}"${scope} --evidence ${ch.requiredEvidence.join(",")}`,
  }
}

/** Event ledger (PRD18 Sprint 3): a MESMA decisão vira evento `tool.before`
 * normalizado (sanitizado, sem secrets) — fonte para `audit events`. */
function recordPretoolEvent(projectDir, action, result, rule, harness) {
  try {
    recordHarnessEvent(projectDir, {
      event: "tool.before", harness: harness || "unknown",
      intent: action.intent, target: action.target && action.target.pathOrName,
      decision: result.decision, rule,
    })
  } catch { /* ledger best-effort */ }
}

/** Grava a decisão pretool como recibo encadeado (best-effort — nunca lança). */
function recordPretool(projectDir, action, result, rule, harness) {
  try {
    recordAction(projectDir, {
      runId: PRETOOL_RUN,
      intent: `pretool:${action.intent || "?"}`,
      actor: { harness: harness || "?", enforcement: "real_hooks" },
      target: action.target,
      policy: { decision: result.decision, rules: ["challenge-pretool", rule] },
    })
  } catch { /* provenance best-effort — a decisão vale mesmo sem recibo */ }
  recordPretoolEvent(projectDir, action, result, rule, harness)
}

/**
 * Decisão pre-tool determinística. → { decision: "allow"|"deny", risk, rule?,
 * grantedBy?|challenge/howTo }. Registra a decisão no provenance (best-effort).
 */
export function pretoolCheck(projectDir, action = {}, opts = {}) {
  const risk = classifyRisk(action)
  if (risk.level !== "high") return { decision: "allow", risk: "low" }
  const targetPath = action.target && action.target.pathOrName
  const grant = findRecentGrant(projectDir, risk.rule, targetPath, opts)
  const result = grant
    ? { decision: "allow", risk: "high", rule: risk.rule, grantedBy: grant.receiptHash }
    : { decision: "deny", risk: "high", rule: risk.rule, ...denyPayload(action, risk) }
  recordPretool(projectDir, action, result, risk.rule, opts.harness)
  return result
}
