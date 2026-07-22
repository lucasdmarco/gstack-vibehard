/**
 * PRD47 S47.3 — `gstack.capability-plan.v1`: transforma a rota declarativa
 * (`src/skills/route.js`) num contrato OBSERVÁVEL. Não duplica detecção de
 * capacidade nem seleção de skill/gate — envolve `buildSkillRoute` e acrescenta
 * o que faltava: razão por seleção, custo de contexto ESTIMADO, e receipts de
 * ciclo de vida (`selected|loaded|applied|verified|failed`) por capacidade.
 */
import { buildSkillRoute } from "../skills/route.js"

export const CAPABILITY_PLAN_SCHEMA = "gstack.capability-plan.v1"
export const RECEIPT_STATUSES = Object.freeze(["selected", "loaded", "applied", "verified", "failed"])

const RECEIPT_TRANSITIONS = Object.freeze({
  selected: ["loaded", "failed"],
  loaded: ["applied", "failed"],
  applied: ["verified", "failed"],
  verified: [],
  failed: [],
})

/** True se `to` é uma aresta permitida a partir de `from` — nenhum salto de receipt. */
export function canTransitionReceipt(from, to) {
  return (RECEIPT_TRANSITIONS[from] || []).includes(to)
}

// Estimativa GROSSEIRA por contagem — nunca REAL sem benchmark A/B reproduzível
// (mesma disciplina do `dream metrics` do PRD46 S46.6).
function estimateContextCost(route) {
  const tokens = route.selectedSkills.length * 200 + route.blockingGates.length * 80 + route.advisoryGates.length * 40
  return { tokens, unit: "tokens", basis: "estimated" }
}

function reasonFor(route) {
  const gates = [...route.blockingGates, ...route.advisoryGates]
  return route.selectedSkills.map((id) => ({ id, reason: gates.length ? `gate(s): ${gates.join(", ")}` : "seleção explícita (--skills)" }))
}

/**
 * Monta o plano de capacidades da fase/run a partir da rota já declarada. `agents`/`tools`
 * são injetados pelo caller (Agent Factory / detecção de tools) — este módulo não decide
 * QUEM selecionar, só observa e rastreia o que `buildSkillRoute` já decidiu.
 */
export function buildCapabilityPlan({ objective = "", template = "", intent = "", catalog, matrix, modelIntake, selectedSkillsOverride = null, profile = "default", agents = [], tools = [], root } = {}) {
  const route = buildSkillRoute({ objective, template, intent, catalog, matrix, modelIntake, selectedSkillsOverride, root })
  const receipts = route.selectedSkills.map((id) => ({ capabilityId: id, status: "selected", at: new Date().toISOString() }))
  return {
    schemaVersion: CAPABILITY_PLAN_SCHEMA, profile, generatedAt: new Date().toISOString(),
    skills: route.selectedSkills, agents: [...agents], gates: [...route.blockingGates, ...route.advisoryGates], tools: [...tools],
    reasons: reasonFor(route), contextCost: estimateContextCost(route), receipts, route,
  }
}

/** Avança o receipt de UMA capacidade. Lança em salto inválido — fail-closed, nunca silencioso. */
export function recordReceipt(plan, capabilityId, status) {
  const current = [...plan.receipts].reverse().find((r) => r.capabilityId === capabilityId)
  if (current && !canTransitionReceipt(current.status, status)) {
    throw new Error(`capability-plan: transição inválida ${current.status}->${status} p/ ${capabilityId}`)
  }
  return { ...plan, receipts: [...plan.receipts, { capabilityId, status, at: new Date().toISOString() }] }
}

/** DoD: skill CRÍTICA selecionada mas nunca chegou a applied/verified -> bloqueia a fase. */
export function criticalSkillIgnored(plan, criticalIds = []) {
  const reached = new Set(plan.receipts.filter((r) => r.status === "applied" || r.status === "verified").map((r) => r.capabilityId))
  return plan.skills.filter((id) => criticalIds.includes(id) && !reached.has(id))
}

/** DoD: capacidade NÃO selecionada nunca "está no prompt" — prova negativa simples e direta. */
export function isSelected(plan, capabilityId) {
  return plan.skills.includes(capabilityId) || plan.gates.includes(capabilityId)
}
