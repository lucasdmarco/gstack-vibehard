/**
 * Checklist de Release Candidate (PRD41 S41.9 / PRD40 §10 — DoD global).
 *
 * Mapeia CADA bloqueador do PRD40 (P0.1–P0.10, P1.1–P1.8) ao sprint e versão que o fechou,
 * com o artefato de prova e o controle negativo. É a fonte-verdade do "está pronto para RC":
 * `rcReadiness()` só declara `ready:true` quando todos os P0 estão `delivered`. Sem enfeite —
 * cada item aponta o teste que reprova se a capacidade sumir.
 */
export const RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.v1"

// tier: P0 (bloqueador) | P1 (importante). status: delivered | partial | pending.
export const RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S41.1", version: "4.1.0", status: "delivered", title: "QG fail-closed (tool_failed)", proof: "tests/test_qg_fail_closed.py" },
  { id: "P0.2", tier: "P0", sprint: "S41.0", version: "4.0.1", status: "delivered", title: "Verdade da release (source-parity)", proof: "tests/source_parity.test.js" },
  { id: "P0.3", tier: "P0", sprint: "S41.2", version: "4.2.0", status: "delivered", title: "Isolamento de projeto (marcador canônico)", proof: "tests/project_identity.test.js" },
  { id: "P0.4", tier: "P0", sprint: "S41.2", version: "4.2.0", status: "delivered", title: "Isolamento de testes (sentinela de vazamento)", proof: "tests/test_no_activation_leak.py" },
  { id: "P0.5", tier: "P0", sprint: "S41.4", version: "4.4.0", status: "delivered", title: "Loop Engine — ordem real (invalid_transition)", proof: "tests/loop_engine.test.js" },
  { id: "P0.6", tier: "P0", sprint: "S41.4", version: "4.4.0", status: "delivered", title: "Caps incontornáveis do motor", proof: "tests/loop_engine.test.js" },
  { id: "P0.7", tier: "P0", sprint: "S41.7", version: "4.7.0", status: "delivered", title: "Checkpoints seguros (containment/denylist/tamper)", proof: "tests/checkpoint_security.test.js" },
  { id: "P0.8", tier: "P0", sprint: "S41.5", version: "4.5.0", status: "delivered", title: "Action Kernel governa ação real", proof: "tests/action_kernel_governed.test.js" },
  { id: "P0.9", tier: "P0", sprint: "S41.3", version: "4.3.0", status: "delivered", title: "Instalador transacional (journal/rollback)", proof: "tests/installer_transactional.test.js" },
  { id: "P0.10", tier: "P0", sprint: "S41.3", version: "4.3.0", status: "delivered", title: ".env nunca exposto", proof: "tests/installer_transactional.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S41.6", version: "4.6.0", status: "delivered", title: "QA visual real (a11y/evidência com hash)", proof: "tests/visual_qa_real.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S41.5", version: "4.5.0", status: "delivered", title: "Gate Registry central", proof: "tests/gate_registry.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S41.5", version: "4.5.0", status: "delivered", title: "Conformance por caminho (controle negativo)", proof: "tests/action_kernel_governed.test.js" },
  { id: "P1.4", tier: "P1", sprint: "S41.8", version: "4.8.0", status: "delivered", title: "Headroom roteado (chamador real/delta/ownership)", proof: "tests/headroom_run.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S41.4", version: "4.4.0", status: "delivered", title: "Status final tipado do loop", proof: "tests/loop_engine.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S41.9", version: "4.9.0", status: "delivered", title: "Dream Audit comportamental (NOT_PROVED)", proof: "tests/dream_behavioral.test.js" },
  { id: "P1.7", tier: "P1", sprint: "S41.9", version: "4.9.0", status: "partial", title: "Matriz E2E de templates nos 3 SOs (CI)", proof: "CI matrix (incremental)" },
  { id: "P1.8", tier: "P1", sprint: "S41.9", version: "4.9.0", status: "delivered", title: "Closeout transacional (fresh removido se refresh falha)", proof: "tests/closeout.test.js" },
])

const byTier = (tier) => RC_ITEMS.filter((i) => i.tier === tier)

/**
 * Prontidão de RC. `ready` exige TODOS os P0 `delivered`. Reporta P1 pendentes/parciais
 * como avisos honestos (não bloqueiam o RC, mas ficam registrados como incremento).
 */
export function rcReadiness(items = RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => i.status !== "delivered")
  const p1Open = items.filter((i) => i.tier === "P1" && i.status !== "delivered")
  return {
    schemaVersion: RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: { p0: p0.length, p0Delivered: p0.length - p0Pending.length, p1: byTier("P1").length, p1Open: p1Open.length },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
