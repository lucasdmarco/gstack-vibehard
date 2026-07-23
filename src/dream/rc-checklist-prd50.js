/**
 * Checklist de Release Candidate do PRD50 (S50.7 — fechamento do programa).
 *
 * Espelha `rc-checklist-prd47/48/49.js`. A diferença deste programa: os claims
 * saem em DOIS níveis, porque o PRD (§8/§17.1) trava toda alegação até o 50.7 e
 * uma parte da validação depende de rótulo humano cego que não pode ser
 * produzido por quem construiu o sistema (§2.3 item 1).
 *
 *   AUTORIZADO  — provado por teste/E2E/CI nesta entrega
 *   PENDENTE    — depende de avaliação humana; corpus e script prontos
 */
export const PRD50_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd50.v1"

export const PRD50_RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S50.0", version: "5.49.0", status: "delivered", title: "Contratos congelados: 9 invariantes puros + corpus com gabarito objetivo vs. subjetivo separados", proof: "tests/prd50_negative_controls.test.js" },
  { id: "P0.2", tier: "P0", sprint: "S50.1", version: "5.50.0", status: "delivered", title: "Schema tipado + classificador determinístico EV0/EV1/EV2 com fail-safe para grounded", proof: "tests/epistemic_classifier.test.js" },
  { id: "P0.3", tier: "P0", sprint: "S50.3", version: "5.52.0", status: "delivered", title: "runStatus e epistemicVerdict separados — `passed` nunca vira `supported`, `instructed` nunca sustenta claim", proof: "tests/epistemic_workflow_adapter.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S50.1", version: "5.50.0", status: "delivered", title: "Wiring real antecipado do S50.5: `consult` separa fato (sondagem de disco) de inferência (heurística)", proof: "tests/epistemic_ev0.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S50.2", version: "5.51.0", status: "delivered", title: "Citation support: existir não é sustentar — misquotation, menção, contradição e redirect distinguidos", proof: "tests/epistemic_sources.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S50.3", version: "5.52.0", status: "delivered", title: "Protocolo balanceado: trilhas de suporte E refutação sempre rodam; contraevidência domina", proof: "tests/epistemic_protocol.test.js" },
  { id: "P1.4", tier: "P1", sprint: "S50.4", version: "5.53.0", status: "delivered", title: "Firewall Knowledge/Execution estrutural: experiment-plan não exporta runner; plano hasheado e imutável", proof: "tests/epistemic_experiment_bridge.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S50.4", version: "5.53.0", status: "delivered", title: "`research validate` read-only com exit codes honestos (inconclusive=0, --strict=3)", proof: "tests/research_validate_cli.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S50.5", version: "5.54.0", status: "delivered", title: "Contrato cross-harness de fonte única compilado para 22 agentes × 3 formatos, sem afirmar enforcement falso", proof: "tests/epistemic_cross_harness.test.js" },
  { id: "P1.7", tier: "P1", sprint: "S50.6", version: "5.55.0", status: "partial", title: "Benchmark: gates objetivos medidos e passando; fatia subjetiva pendente de rótulo humano cego (por design metodológico)", proof: "tests/epistemic_benchmark.test.js" },
  { id: "P1.8", tier: "P1", sprint: "S50.7", version: "5.56.0", status: "delivered", title: "E2E do protocolo pelo binário real, na matriz de 3 SOs do CI", proof: "tests/e2e/epistemic_protocol.e2e.test.js" },
])

/** Claims que ESTA entrega autoriza — cada um com a prova que o sustenta. */
export const AUTHORIZED_CLAIMS = Object.freeze([
  { claim: "O GStack distingue fatos verificados, inferências, hipóteses e resultados inconclusivos.", proof: "tests/epistemic_schema.test.js" },
  { claim: "Uma fonte que apenas menciona o tema nunca é contada como suporte ao claim.", proof: "tests/epistemic_sources.test.js" },
  { claim: "LLM review permanece advisory e nunca produz `proved` no Evidence Ledger.", proof: "tests/prd50_negative_controls.test.js" },
  { claim: "Experimentos de código não são executados pelo comando read-only; saem como plano para a camada gated.", proof: "tests/epistemic_experiment_bridge.test.js" },
  { claim: "Amostragem finita passando é rotulada como suporte dentro do escopo, nunca como prova geral.", proof: "tests/epistemic_experiment_bridge.test.js" },
  { claim: "O contrato epistêmico é compilado de uma fonte única para todos os harnesses, sem alegar enforcement que o harness não tem.", proof: "tests/epistemic_cross_harness.test.js" },
])

/** Claims que ESTA entrega NÃO autoriza — e o que falta para cada um. */
export const PENDING_CLAIMS = Object.freeze([
  { claim: "A precisão de citation support em casos semanticamente ambíguos é de X%.", blockedBy: "human_labeling", missing: "rótulo humano cego dos casos `requiresHumanLabel` (ver docs/guides/epistemic-benchmark.md)" },
  { claim: "As respostas do GStack são relevantes à intenção real da pergunta em X% dos casos.", blockedBy: "human_labeling", missing: "avaliação humana de relevância — auto-avaliar seria circular (§2.3 item 1)" },
  { claim: "O overhead do EV0 dentro do Claude Code/Codex é <= 8%.", blockedBy: "not_measurable_by_design", missing: "no harness o contrato é texto injetado e o GStack nunca vê a resposta; medido apenas dentro dos comandos do GStack" },
])

const isDelivered = (i) => i.status === "delivered"

/**
 * Prontidão de RC. `ready` exige todos os P0 `delivered` (mesma semântica do
 * PRD47/48/49). `fullyValidated` é separado e SÓ vira true quando não houver
 * claim pendente — hoje é false por design, não por esquecimento.
 */
export function prd50Readiness(items = PRD50_RC_ITEMS, pending = PENDING_CLAIMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => !isDelivered(i))
  const p1Open = items.filter((i) => i.tier === "P1" && !isDelivered(i))
  return {
    schemaVersion: PRD50_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    fullyValidated: pending.length === 0,
    counts: {
      p0: p0.length, p0Delivered: p0.length - p0Pending.length,
      p1: items.filter((i) => i.tier === "P1").length, p1Open: p1Open.length,
      authorizedClaims: AUTHORIZED_CLAIMS.length, pendingClaims: pending.length,
    },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
