import { scanContent } from "../agents/scanner.js"

/**
 * Invariantes do Protocolo de Verificação Epistêmica Proporcional (PRD50 S50.0).
 *
 * Esta é a camada de CONTRATO — o que o protocolo tem que RECUSAR, congelado
 * antes do motor existir (50.1+). Puro, sem I/O, sem rede. Não altera nenhum
 * módulo de produção: o motor de decisão operacional continua sendo o Evidence
 * Ledger + gates determinísticos.
 *
 * Invariante de ouro (§5.6 do PRD50): `supported` epistêmico NUNCA equivale a
 * `proved` operacional. `epistemicVerdictToEvidenceStatus` sempre devolve
 * `advisory`, e "epistemic" nunca entra em PROVING_SOURCES do evidence-ledger.
 *
 * Distinto de `schema.js` (50.1), que trará o schema completo do resultado
 * (`gstack.epistemic-review.v1`) e sua validação.
 */
export const EPISTEMIC_INVARIANTS_SCHEMA = "gstack.epistemic-invariants.v1"

// ── 1. nunca alegar verificação não executada ────────────────────────────────
/** Atos que constituem verificação REAL (§8: "não afirme ter consultado/executado"). */
export const VERIFICATION_ACTS = Object.freeze(["toolExecuted", "sourceConsulted", "testRun"])

/** Só pode alegar `verified` quem executou pelo menos um ato real. Ausência nunca conta. */
export function canClaimVerified(performed = {}) {
  return VERIFICATION_ACTS.some((act) => performed[act] === true)
}

// ── 2/3/4. suporte de citação ────────────────────────────────────────────────
/** Estado de suporte de uma fonte em relação ao claim (§12.2). */
export const CITATION_SUPPORT_STATES = Object.freeze(["supports", "contradicts", "mentions_only", "not_found"])

/** SÓ `supports` sustenta. Existir, mencionar ou contradizer nunca sustenta. */
export function citationSupportsClaim(state) {
  return state === "supports"
}

/** Fonte alcançável que não sustenta é DESCOBERTA, nunca suporte (§10.1). */
export function classifySourceOutcome({ reachable, support } = {}) {
  if (!reachable) return "source_unreachable"
  return citationSupportsClaim(support) ? "claim_supported" : "source_discovered"
}

/** Citação real presa ao claim errado é misattribution — o caso §15.3 do PRD. */
export function detectMisattribution({ citation, attachedToClaimId } = {}) {
  const owner = citation && citation.claimId
  if (owner && attachedToClaimId && owner !== attachedToClaimId) {
    return { ok: false, reason: "citation_attributed_to_different_claim" }
  }
  return { ok: true, reason: null }
}

// ── 5. maturidade da fonte ───────────────────────────────────────────────────
export const SOURCE_MATURITY = Object.freeze(["peer_reviewed", "preprint", "blog", "unknown"])

/** Preprint/blog/desconhecido NUNCA é consenso estabelecido (§15.4). */
export function canTreatAsConsensus(maturity) {
  return maturity === "peer_reviewed"
}

// ── 6. teste não executado ───────────────────────────────────────────────────
/** `passed` sem `executed` é incoerente → not_performed (nunca prova por decreto). */
export function testEvidenceStatus({ executed, passed } = {}) {
  if (executed !== true) return "not_performed"
  return passed === true ? "proved" : "failed"
}

// ── 7. budget por nível ──────────────────────────────────────────────────────
/** Tetos do §11.3. EV0 é literalmente zero extra — é o que mantém o trivial barato. */
export const LEVEL_BUDGET = Object.freeze({
  sanity: { network: false, maxExtraModelCalls: 0, subagents: false, execution: false },
  grounded: { network: true, maxExtraModelCalls: 1, subagents: false, execution: true },
  adversarial: { network: true, maxExtraModelCalls: 2, subagents: true, execution: true },
})

const BUDGET_VIOLATIONS = Object.freeze([
  { key: "network", check: (b, u) => u.network === true && b.network === false, reason: (l) => `network_not_allowed_at_${l}` },
  { key: "subagents", check: (b, u) => u.subagents === true && b.subagents === false, reason: (l) => `subagents_not_allowed_at_${l}` },
  { key: "execution", check: (b, u) => u.execution === true && b.execution === false, reason: (l) => `execution_not_allowed_at_${l}` },
  { key: "extraModelCalls", check: (b, u) => (u.extraModelCalls || 0) > b.maxExtraModelCalls, reason: (l) => `extra_model_calls_exceed_${l}_budget` },
])

/** Uso que estoura o teto do nível é violação nomeada — nunca um estouro silencioso. */
export function violatesLevelBudget(level, usage = {}) {
  const budget = LEVEL_BUDGET[level]
  if (!budget) return { ok: false, reason: "unknown_level" }
  const hit = BUDGET_VIOLATIONS.find((v) => v.check(budget, usage))
  return hit ? { ok: false, reason: hit.reason(level) } : { ok: true, reason: null }
}

// ── 8. conteúdo externo é untrusted ──────────────────────────────────────────
/**
 * Texto de fonte externa nunca altera policy. Reusa o AgentShield real
 * (`src/agents/scanner.js`) — não duplica detecção de injection.
 */
export function externalContentTrust(text) {
  const findings = scanContent("external-source", text)
  return { trusted: findings.length === 0, findings }
}

// ── 9. invariante de ouro: epistêmico nunca prova ────────────────────────────
/**
 * Qualquer verdict epistêmico entra no Evidence Ledger como `advisory`.
 * Reforço explícito: `evidence-ledger.js` já coage por fonte (PROVING_SOURCES
 * não contém "epistemic"); esta função torna a intenção legível no chamador.
 */
export function epistemicVerdictToEvidenceStatus() {
  return "advisory"
}
