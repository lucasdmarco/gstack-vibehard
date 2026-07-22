/**
 * PRD49 S49.0 — governança de vendoring externo. Nenhum código de terceiro entra no
 * runtime do GStack sem passar por TODOS estes controles primeiro. Reusa
 * `external-audit.js` (PRD29/PRD34) pra classificação de conteúdo — não duplica a
 * detecção de sinal destrutivo/rede/segredo/instalação, só adiciona as dimensões que
 * aquele schema não cobre: license/commit/sha256, custo, enforcement e precedência de
 * regra duplicada.
 */
import { auditExternalSkills } from "./external-audit.js"

export const VENDOR_GOVERNANCE_SCHEMA = "gstack.vendor-governance.v1"

export const ENFORCEMENT_EVIDENCE = Object.freeze({
  UNKNOWN: "unknown",
  CLAIMED_BY_DOCS: "claimed_by_docs",
  PROVED_BY_FIXTURE: "proved_by_fixture",
})

/** Controle 1: fonte só é promovível com commit+license+sha256 reais — nunca por decreto. */
export function canPromoteSource(source = {}) {
  return Boolean(source.commit && source.license && source.sha256)
}

/** Controle 2: candidato com sinal AVOID (segredo/exec-remoto/install) nunca passa. Reusa external-audit.js. */
export function vendorSafetyCheck(files = []) {
  const audit = auditExternalSkills({ files })
  return { ok: audit.counts.avoid === 0, audit }
}

/** Controle 3: mutação de hook manifest sem plano de backup/restore é bloqueada. */
export function canMutateHookManifest({ mutatesHooks = false, hasBackupPlan = false } = {}) {
  return !mutatesHooks || hasBackupPlan
}

/** Controle 4: capacidade paga sem confirmação EXPLÍCITA — `--yes` de execução nunca basta. */
export function costGateStatus({ estimatedCost = 0, confirmed = false } = {}) {
  return estimatedCost > 0 && !confirmed ? "blocked" : "ok"
}

/** Controle 5: enforcement só é 'enforced' com evidência de fixture real — nunca por doc/omissão. */
export function canClaimEnforced(evidence) {
  return evidence === ENFORCEMENT_EVIDENCE.PROVED_BY_FIXTURE
}

/** Controle 6: conteúdo de origem externa NUNCA vira policy/memória sem promoção humana explícita. */
export function externalContentPromotionStatus({ origin } = {}) {
  return origin && origin.startsWith("external") ? "requires_human_promotion" : "auto_eligible"
}

/** Controle 7: mesmo ruleId de fontes DIFERENTES sem precedência declarada -> quarentena, nunca as duas ativas. */
export function resolveRulePrecedence(rules = []) {
  const bySource = new Map()
  for (const r of rules) {
    if (!bySource.has(r.ruleId)) bySource.set(r.ruleId, new Set())
    bySource.get(r.ruleId).add(r.source)
  }
  return rules.map((r) => ({ ...r, status: bySource.get(r.ruleId).size > 1 ? "quarantined" : "active" }))
}
