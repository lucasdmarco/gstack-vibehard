/**
 * Checklist de Release Candidate do PRD47 (S47.10 — fechamento do programa).
 *
 * Mapeia CADA achado do PRD47 (P0.1–P0.4, P1.1–P1.10) ao sprint e à versão que o entregou,
 * com o artefato de prova (o teste que reprova se a capacidade sumir). Espelha o padrão do
 * `rc-checklist.js`/`rc-checklist-prd45.js`: `prd47Readiness()` só declara `ready:true` quando
 * todos os P0 estão `delivered`.
 *
 * ACHADO HONESTO deste fechamento: os 4 P0 originais (S47.0 — GAP-A preview gating, GAP-B
 * observe/diagnose fora do `start`, GAP-C pending_verifier sempre, GAP-D proof opcional) têm
 * a LÓGICA DE DECISÃO correta construída e testada (S47.1/S47.4/S47.5/S47.6), mas o pipeline
 * padrão do `start`/`run-loop.js` ainda NÃO foi cortado para usá-la como autoridade — cada
 * sprint escolheu deliberadamente o caminho aditivo (novo campo ao lado do antigo) para não
 * arriscar regressão sem escopo dedicado (mesma cautela repetida a cada sprint desta sessão).
 * Por isso os 4 P0 são `partial`, não `delivered` — `ready:false` é o resultado HONESTO, não
 * um defeito deste checklist. A generalização/cutover real fica para um programa futuro.
 */
export const PRD47_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd47.v1"

// tier: P0 (bloqueador) | P1 (importante). status: delivered | partial | pending.
export const PRD47_RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S47.1/S47.6", version: "5.24.0", status: "partial", title: "Preview saudável gate o status final — golden-run.js/delivery-verdict.js decidem certo; run-loop.js (GATE_STAGES) ainda não corta por preview", proof: "tests/delivery_verdict.test.js" },
  { id: "P0.2", tier: "P0", sprint: "S47.4/S47.9", version: "5.26.0", status: "partial", title: "Observe/diagnose/repair dentro do start — runtime-repair-cycle.js real e provado em E2E (S47.9), mas run-loop.js nunca o importa/chama automaticamente", proof: "tests/runtime_repair_cycle.test.js" },
  { id: "P0.3", tier: "P0", sprint: "S47.5", version: "5.23.0", status: "partial", title: "pending_verifier resolve pra verifier real com journey mapeada — acceptance-verification.js real; product-brief.js/start.js nunca chamam o resolver", proof: "tests/acceptance_verification.test.js" },
  { id: "P0.4", tier: "P0", sprint: "S47.6", version: "5.24.0", status: "partial", title: "Proof obrigatório (não opt-in) pra intenção de entrega — delivery-verdict.js exige; start.js só roda proof com --proof explícito", proof: "tests/delivery_verdict.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S47.0", version: "5.18.0", status: "delivered", title: "Baseline de controles negativos (12 gaps reais mapeados) + manifest global real limpo com autorização", proof: "tests/prd47_baseline_negative_controls.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S47.1", version: "5.19.0", status: "delivered", title: "golden-run.js liga engine.finalize() de verdade (deixou de ser dead code)", proof: "tests/golden_run_controller.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S47.2", version: "5.20.0", status: "delivered", title: "Product Brief v1→v2 + Design Direction guiada", proof: "tests/design_direction.test.js" },
  { id: "P1.4", tier: "P1", sprint: "S47.3", version: "5.21.0", status: "delivered", title: "Capability Plan observável + Skill Context Pack fail-closed", proof: "tests/capability_plan.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S47.4", version: "5.22.0", status: "delivered", title: "Runtime repair cycle bounded (dev→health→observe→diagnose→repair/checkpoint/handoff)", proof: "tests/runtime_repair_cycle.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S47.5", version: "5.23.0", status: "delivered", title: "QA/aceites executáveis — pending_verifier só vira real com journey mapeada", proof: "tests/acceptance_verification.test.js" },
  { id: "P1.7", tier: "P1", sprint: "S47.7", version: "5.25.0", status: "delivered", title: "Context Delta — pacote mínimo de retomada, resume sem reler o repositório", proof: "tests/context_delta.test.js" },
  { id: "P1.8", tier: "P1", sprint: "S47.9", version: "5.26.0", status: "partial", title: "Golden Workflow vertical saas-auth-stripe — E2E real (Windows): 7/14 evidências proved; Stripe/Supabase/painel-browser/multi-SO not_executed/blocked por falta de credencial/ambiente", proof: "scripts/vertical-saas-auth-stripe.mjs" },
  { id: "P1.9", tier: "P1", sprint: "S47.8", version: "5.27.0", status: "delivered", title: "Paralelismo adaptativo — budget de fan-out nunca reservado 2x, isolamento de falha por branch, usuário sempre pode forçar sequencial", proof: "tests/adaptive_parallel.test.js" },
  { id: "P1.10", tier: "P1", sprint: "S47.6", version: "5.24.0", status: "delivered", title: "Veredito único de entrega (delivered|checkpoint_ready|blocked) fecha GAP-8 (doctor×readiness contraditórios)", proof: "tests/delivery_verdict.test.js" },
])

const byTier = (tier) => PRD47_RC_ITEMS.filter((i) => i.tier === tier)

/**
 * Prontidão de RC do PRD47. `ready` exige TODOS os P0 `delivered` — como os 4 P0 são
 * `partial` (decisão correta construída, cutover do pipeline padrão adiado por cautela),
 * `ready:false` é o resultado HONESTO deste programa, registrado sem enfeite.
 */
export function prd47Readiness(items = PRD47_RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => i.status !== "delivered")
  const p1Open = items.filter((i) => i.tier === "P1" && i.status !== "delivered")
  return {
    schemaVersion: PRD47_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: { p0: p0.length, p0Delivered: p0.length - p0Pending.length, p1: byTier("P1").length, p1Open: p1Open.length },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
