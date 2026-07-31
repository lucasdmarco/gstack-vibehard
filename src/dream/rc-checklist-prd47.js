/**
 * Checklist de Release Candidate do PRD47 (S47.10 — fechamento do programa).
 *
 * Mapeia CADA achado do PRD47 (P0.1–P0.4, P1.1–P1.10) ao sprint e à versão que o entregou,
 * com o artefato de prova (o teste que reprova se a capacidade sumir). Espelha o padrão do
 * `rc-checklist.js`/`rc-checklist-prd45.js`: `prd47Readiness()` só declara `ready:true` quando
 * todos os P0 estão `delivered`.
 *
 * HISTÓRICO (S47.10): os 4 P0 originais (S47.0 — GAP-A preview gating, GAP-B observe/
 * diagnose fora do `start`, GAP-C pending_verifier sempre, GAP-D proof opcional) tinham a
 * LÓGICA DE DECISÃO correta construída e testada, mas `start`/`run-loop.js` nunca a usava
 * como autoridade. Os 4 ficaram `partial` e `ready:false` foi o resultado honesto.
 *
 * ATUALIZAÇÃO (PRD51 S51.2 + S51.10.0/S51.10.1): o cutover foi feito. O Sprint 51.2 ligou
 * as peças ao pipeline atrás da flag `--golden-run`, e o S51.10.0 flipou essa flag para
 * DEFAULT (decisão humana do §11 do prd51.md, tomada no RC). Três dos quatro P0 passam a
 * `delivered` porque governam o caminho padrão do `start` — não porque a capacidade existe
 * em algum módulo.
 *
 * P0.2 é a exceção e vira NON-GOAL EXPLÍCITO, não `delivered` disfarçado. O ciclo de reparo
 * pressupõe um loop AGÊNTICO (observa → diagnostica → LLM propõe correção → reobservação
 * valida); `runPipeline` é síncrono e não tem como pausar e devolver controle ao LLM no
 * meio. O S51.2.4 anexou diagnóstico REAL ao handoff em vez de fabricar autocorreção que o
 * `start` não suporta. Converter em non-goal registra a decisão em vez de deixar um P0
 * eternamente `partial` — `baseline.js` já trata `nonGoal` como item fechado.
 */
export const PRD47_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd47.v1"

// tier: P0 (bloqueador) | P1 (importante). status: delivered | partial | pending.
export const PRD47_RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S47.1/S47.6 → PRD51 S51.2.3/S51.10.0", version: "5.100.0", status: "delivered", title: "Preview saudável gate o status final — `gateStagesFor` coloca preview no gate e o Golden Run governa o `start` por DEFAULT (não mais atrás de flag)", proof: "tests/start_preview_gate.test.js" },
  { id: "P0.2", tier: "P0", sprint: "S47.4/S47.9 → PRD51 S51.2.4", version: "5.63.0", status: "partial", nonGoal: true, nonGoalReason: "O ciclo de reparo exige loop AGÊNTICO (LLM propõe correção entre observação e revalidação); `runPipeline` é síncrono e não pausa. Em vez de fabricar autocorreção que o `start` não suporta, o S51.2.4 anexa diagnóstico REAL (`diagnoseObservation`) ao handoff. Decisão humana explícita, registrada em vez de deixar um P0 eternamente parcial.", title: "Observe/diagnose dentro do start — run-loop.js consulta diagnose-loop.js de verdade e anexa diagnóstico ao handoff; reparo automático é non-goal declarado", proof: "tests/start_repair_diagnosis.test.js" },
  { id: "P0.3", tier: "P0", sprint: "S47.5 → PRD51 S51.2.1/S51.2.7", version: "5.66.0", status: "delivered", title: "pending_verifier resolve pra verifier real — `resolveBriefAcceptances` é chamado pelo pipeline e `--journeys` dá a fonte real de journeys; sem journey, o aceite segue honestamente pendente", proof: "tests/start_journeys_cli.test.js" },
  { id: "P0.4", tier: "P0", sprint: "S47.6 → PRD51 S51.2.5/S51.10.0", version: "5.100.0", status: "delivered", title: "Proof não é mais opt-in — roda por default na entrega; `--no-proof` é o opt-out. S51.10.0 ainda o condicionou à entrega real (handoff não paga proof)", proof: "tests/golden_run_default.test.js" },
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
 * Um item conta como fechado se entregue OU convertido em non-goal EXPLÍCITO (com razão
 * registrada). Mesma regra de `release/baseline.js` (`itemIsClosed`) — non-goal sem razão
 * nunca fecha nada, senão viraria a porta dos fundos para esvaziar o checklist.
 */
const itemIsClosed = (i) => i.status === "delivered" || (i.nonGoal === true && Boolean(i.nonGoalReason))

/**
 * Prontidão de RC do PRD47. `ready` exige todo P0 fechado.
 *
 * PRD51 S51.10.1: passou a `true`. Três P0 viraram `delivered` porque o cutover do Sprint
 * 51.2 + o flip do default (S51.10.0) fizeram o Golden Run governar o caminho PADRÃO do
 * `start` — não porque a capacidade passou a existir em algum módulo (ela já existia, e era
 * exatamente essa a distinção que mantinha os itens `partial`). P0.2 fecha como non-goal
 * declarado, com a razão registrada no item. `p0NonGoal` é exposto separado de
 * `p0Delivered` para que "pronto" nunca esconda "decidimos não fazer".
 */
export function prd47Readiness(items = PRD47_RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => !itemIsClosed(i))
  const p0NonGoal = p0.filter((i) => itemIsClosed(i) && i.status !== "delivered")
  const p1Open = items.filter((i) => i.tier === "P1" && !itemIsClosed(i))
  return {
    schemaVersion: PRD47_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: {
      p0: p0.length,
      p0Delivered: p0.filter((i) => i.status === "delivered").length,
      p0NonGoal: p0NonGoal.length,
      p1: byTier("P1").length,
      p1Open: p1Open.length,
    },
    p0Pending: p0Pending.map((i) => i.id),
    p0NonGoal: p0NonGoal.map((i) => ({ id: i.id, reason: i.nonGoalReason })),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
