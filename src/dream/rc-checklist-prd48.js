/**
 * Checklist de Release Candidate do PRD48 (S48.7 — fechamento do programa).
 *
 * Mapeia CADA lacuna crítica do PRD48 §3.2 (P1.1–P1.6, P2.1–P2.2) ao sprint/versão que a
 * endereçou, com o artefato de prova. Espelha o padrão do `rc-checklist-prd47.js`.
 *
 * ACHADO HONESTO deste fechamento: as 8 lacunas têm infraestrutura REAL e testada
 * construída (S48.1-S48.6), mas duas continuam genuinamente abertas — P2.2 (ajuda
 * contextual geral, além de mensagens localizadas) nunca foi endereçada por nenhum
 * sprint, e o wiring INTERATIVO dos presenters/prompts dentro de `start.js`
 * (`confirmAndRunPipeline`) foi deliberadamente deferido em S48.4 pra não arriscar a
 * pipeline madura sem escopo dedicado — mesma cautela do PRD47. Por isso os itens que
 * dependem desse wiring ficam `partial`, não `delivered`.
 */
export const PRD48_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd48.v1"

// tier: P0 (bloqueador) | P1 (importante). status: delivered | partial | pending.
export const PRD48_RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S48.0", version: "5.29.0", status: "delivered", title: "Baseline pós-PRD47 comprovado por comportamento (readiness/skill governance/Golden Run/Context Delta reais) + 5 controles negativos", proof: "tests/prd48_baseline_contract.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S48.1", version: "5.30.0", status: "partial", title: "Primeiro uso fecha harness/modelo — detecção e perfil reais; auth/modelo permanecem 'unknown' por design (nunca fabricado); prompt interativo de escolha não wired em start.js", proof: "tests/harness_session_profile.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S48.2", version: "5.31.0", status: "delivered", title: "Onboarding brownfield read-only — discovery real, 3 opções sempre, dirty tree nunca descartada", proof: "tests/brownfield_discovery.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S48.3", version: "5.32.0", status: "delivered", title: "Índice unificado de sessão — 1º produtor real de `sessions` no State Store, task history/inspect", proof: "tests/session_index.test.js" },
  { id: "P1.4", tier: "P1", sprint: "S48.4", version: "5.33.0", status: "partial", title: "Decisão de policy compreensível — decision-presenter.js real e testado; wiring interativo dentro de start.js deferido (decisão futura dedicada)", proof: "tests/decision_presenter.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S48.4", version: "5.33.0", status: "delivered", title: "Checkpoint como produto — task checkpoints/restore reais, restore com provenance append-only, tamper aborta sem gravar sucesso falso", proof: "tests/task_checkpoint_ux.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S48.5", version: "5.34.0", status: "delivered", title: "Contexto/quota/custo como decisão única — contrato de 4 qualidades tipadas, quota unknown nunca suficiente, budget nunca reservado 2x", proof: "tests/usage_accounting.test.js" },
  { id: "P2.1", tier: "P1", sprint: "S48.6", version: "5.35.0", status: "partial", title: "Idioma da CLI como preferência formal — infraestrutura real (catálogo+resolver+messageId), mas só `task inspect/restore` retrofitados; resto da CLI continua só em português", proof: "tests/cli_i18n.test.js" },
  { id: "P2.2", tier: "P1", sprint: "-", version: "-", status: "pending", title: "Ajuda contextual geral (uma única próxima ação segura ao falhar, além de mensagens localizadas) — nenhum sprint endereçou isso diretamente", proof: null },
])

const byTier = (tier) => PRD48_RC_ITEMS.filter((i) => i.tier === tier)

/**
 * Prontidão de RC do PRD48. `ready` exige TODOS os P0 `delivered` (só há 1 P0 nesta
 * checklist — o baseline do S48.0). Os P1 abertos/parciais ficam registrados como
 * incremento honesto, sem enfeite.
 */
export function prd48Readiness(items = PRD48_RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => i.status !== "delivered")
  const p1Open = items.filter((i) => i.tier === "P1" && i.status !== "delivered")
  return {
    schemaVersion: PRD48_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: { p0: p0.length, p0Delivered: p0.length - p0Pending.length, p1: byTier("P1").length, p1Open: p1Open.length },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
