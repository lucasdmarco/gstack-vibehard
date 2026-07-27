/**
 * Checklist de Release Candidate do PRD46 (aprendizado verificável de skills,
 * S46.0→S46.6, v5.11.0→v5.17.0). Espelha `rc-checklist-prd45/47/48/49/50.js` —
 * PRD46 nunca teve um checklist canônico (achado do PRD51 §S51.3, ação #1).
 */
export const PRD46_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd46.v1"

export const PRD46_RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S46.0", version: "5.11.0", status: "delivered", title: "SKILL.md canônico + registry sem claim falso (skill-creator/skill-authoring/find-skills sem -g -y default)", proof: "tests/skill_learning_governance.test.js" },
  { id: "P0.2", tier: "P0", sprint: "S46.1", version: "5.12.0", status: "delivered", title: "Candidate schema + triage real (esqueleto vira candidato tipado, não markdown solto)", proof: "tests/dream_candidate.test.js" },
  { id: "P0.3", tier: "P0", sprint: "S46.1", version: "5.12.0", status: "delivered", title: "Discovery/source-lock seguros — instalação nunca global/sem confirmação por default", proof: "tests/skill_discovery_security.test.js" },
  { id: "P0.4", tier: "P0", sprint: "S46.3", version: "5.14.0", status: "delivered", title: "Dedupe real contra skills já existentes antes de propor uma nova", proof: "tests/dream_dedupe.test.js" },
  { id: "P0.5", tier: "P0", sprint: "S46.4", version: "5.15.0", status: "delivered", title: "Promotion Gate bloqueia promoção insegura (sem prova comportamental)", proof: "tests/dream_promotion_gate.test.js" },
  { id: "P0.6", tier: "P0", sprint: "S46.5", version: "5.16.0", status: "delivered", title: "Behavioral conformance real — skill aprendida precisa se comportar como declarado, não só existir", proof: "tests/learned_skill_conformance.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S46.1", version: "5.12.0", status: "delivered", title: "Triage classifica candidate sem ruído (skill vs memory vs skip)", proof: "tests/dream_triage.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S46.1", version: "5.12.0", status: "delivered", title: "Source-lock com hash pin real (não confia em versão flutuante)", proof: "tests/skill_source_lock.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S46.2", version: "5.13.0", status: "delivered", title: "Detector de golden path integrado ao closeout (candidate real por run)", proof: "tests/dream_detector.test.js" },
  { id: "P1.4", tier: "P1", sprint: "S46.3", version: "5.14.0", status: "delivered", title: "Conflitos entre candidates detectados (mesmo padrão, fontes diferentes)", proof: "tests/dream_conflicts.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S46.4", version: "5.15.0", status: "delivered", title: "Segurança de fonte de skill (segredo/exec-remoto/instalação global bloqueados)", proof: "tests/skill_source_security.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S46.5", version: "5.16.0", status: "delivered", title: "Harness registry gerado a partir de skill aprendida promovida", proof: "tests/harness_registry_generation.test.js" },
  { id: "P1.7", tier: "P1", sprint: "S46.6", version: "5.17.0", status: "delivered", title: "Freshness + revogação de skill aprendida obsoleta, métricas honestas (fecha PRD46)", proof: "tests/dream_freshness.test.js" },
])

const isDelivered = (i) => i.status === "delivered"

/** Prontidão de RC — mesma semântica do PRD45/47/48/49: `ready` exige todos os P0 `delivered`. */
export function prd46Readiness(items = PRD46_RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => !isDelivered(i))
  const p1Open = items.filter((i) => i.tier === "P1" && !isDelivered(i))
  return {
    schemaVersion: PRD46_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: { p0: p0.length, p0Delivered: p0.length - p0Pending.length, p1: items.filter((i) => i.tier === "P1").length, p1Open: p1Open.length },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
