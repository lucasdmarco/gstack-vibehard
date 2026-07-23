/**
 * Checklist de Release Candidate do PRD49 (S49.10 — fechamento do programa).
 *
 * Mapeia os 10 sprints de produto (S49.0-S49.9) a P0/P1 com prova real, e os 15
 * cenários obrigatórios do plano (§49.10) a evidência real ou `not_executed` honesto.
 * Espelha o padrão de `rc-checklist-prd47.js`/`rc-checklist-prd48.js`.
 *
 * ACHADO HONESTO deste fechamento: os 3 P0 (governança/1º vendoring real/detector
 * nativo conectado) estão genuinamente `delivered` e testados. 4 dos 8 P1 ficam
 * `partial` por design — cada um documentado explicitamente no CHANGELOG do próprio
 * sprint, nunca uma surpresa nesta checklist: minimality-gate (S49.5, declarado sem
 * wiring real), Obsidian bundle (S49.6, 4/5 skills — defuddle excluído por achado real
 * do auditor), Scroll World (S49.7, controle de fluxo real mas sem pipeline de mídia
 * real), NotebookLM (S49.9, sem ambiente Python pinado real). Nenhum destes bloqueia
 * `ready` — só os P0 bloqueiam, mesma semântica do PRD47/48.
 */
export const PRD49_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd49.v1"

// tier: P0 (bloqueador) | P1 (importante). status: delivered | partial | pending.
export const PRD49_RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S49.0", version: "5.37.0", status: "delivered", title: "Governança/registry/controles negativos reais (vendor-governance.js, 7 controles) + source-manifest de 9 fontes", proof: "tests/prd49_negative_controls.test.js" },
  { id: "P0.2", tier: "P0", sprint: "S49.2A", version: "5.39.0", status: "delivered", title: "Primeiro vendoring real de código de terceiro (Impeccable, Apache-2.0) com proveniência completa e paridade comportamental provada", proof: "tests/impeccable_vendor_provenance.test.js" },
  { id: "P0.3", tier: "P0", sprint: "S49.2B", version: "5.40.0", status: "delivered", title: "Detector nativo de design conectado ao vendor real (WCAG color-contrast), CLI + wiring advisory no proof", proof: "tests/design_detector.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S49.1", version: "5.38.0", status: "delivered", title: "Bridge canônico de contexto de design — PRODUCT.md/DESIGN.md/.impeccable/design.json com sourceHash determinístico", proof: "tests/design_context_bridge.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S49.3", version: "5.41.0", status: "delivered", title: "Projeções de hook project-local por harness — cada harness recebe seu mecanismo real, nunca global, config-sacred provado", proof: "tests/design_hook_projection.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S49.4", version: "5.42.0", status: "delivered", title: "Graphify query-first — subcomandos declarados, policy soft/strict explícita, conformance honesta por harness", proof: "tests/graphify_query_first.test.js" },
  { id: "P1.4", tier: "P1", sprint: "S49.5", version: "5.43.0", status: "partial", title: "Minimality gate — evaluateMinimality real e testado, mas SEM wiring real (nenhum planner/reviewer popula decision-evidence ainda)", proof: "tests/minimality_gate.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S49.6", version: "5.44.0", status: "partial", title: "Governed Obsidian skill bundle — 4 de 5 skills vendorizadas na íntegra; defuddle excluído por achado real do auditor (npm install -g no upstream)", proof: "tests/obsidian_skill_routes.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S49.7", version: "5.45.0", status: "partial", title: "Scroll World — controle de fluxo real (intake/orçamento/fallback/manifesto) provado via fake-provider E2E; gates determinísticos/operacionais de mídia real (seam/mobile/reduced-motion) não construídos", proof: "tests/scroll_world_route.test.js" },
  { id: "P1.7", tier: "P1", sprint: "S49.8", version: "5.46.0", status: "delivered", title: "Media-intake router (transcript-first, frame bounded) + Claude Video spike corretamente NÃO promovido sem benchmark real", proof: "tests/media_intake_router.test.js" },
  { id: "P1.8", tier: "P1", sprint: "S49.9", version: "5.47.0", status: "partial", title: "NotebookLM connector experimental — adapter real e testado (connect sempre interativo, nunca cookie automático); sem ambiente Python pinado real configurado", proof: "tests/notebooklm_adapter.test.js" },
])

const byTier = (tier) => PRD49_RC_ITEMS.filter((i) => i.tier === tier)

/** Prontidão de RC do PRD49. `ready` exige TODOS os P0 `delivered`. P1 partial/pending nunca bloqueia, só reporta honesto. */
export function prd49Readiness(items = PRD49_RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => i.status !== "delivered")
  const p1Open = items.filter((i) => i.tier === "P1" && i.status !== "delivered")
  return {
    schemaVersion: PRD49_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: { p0: p0.length, p0Delivered: p0.length - p0Pending.length, p1: byTier("P1").length, p1Open: p1Open.length },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}

// Os 15 cenários obrigatórios do plano (§49.10). `real` = teste dedicado existente que
// prova exatamente o cenário; `partial` = evidência real cobre PARTE do cenário;
// `not_executed` = infraestrutura real (3 SOs/provider pago/CI multi-SO) que não existe
// nesta sessão — declarado, nunca fabricado com fixture fingindo prova.
export const PRD49_SCENARIO_COVERAGE = Object.freeze([
  { id: 1, title: "Lite backend-only não instala/roteia nenhuma capacidade de UI/mídia", status: "real", proof: "tests/capability_contract.test.js", reason: null },
  { id: 2, title: "Full UI carrega o motor de design nativo atribuído sem CLI upstream, passa detector + gate visual", status: "partial", proof: "tests/design_detector.test.js", reason: "detector nativo real e testado; gate visual existente (Playwright) não foi re-testado especificamente sobre mídia gerada pelo motor nesta sprint" },
  { id: 3, title: "Proveniência de vendor adulterada, módulo de regra ausente ou runtime incompatível falha honestamente", status: "partial", proof: "tests/impeccable_vendor_provenance.test.js", reason: "hash de cada arquivo vendorizado é verificado contra upstream-map.md (adulteração mudaria o hash); não há um teste dedicado de injeção de tamper" },
  { id: 4, title: "Fixtures de design P0/P1 conhecidas falham e fixtures corrigidas passam", status: "real", proof: "tests/design_detector.test.js", reason: null },
  { id: 5, title: "Payload de hook fica bounded enquanto o scan de fechamento de fase cobre a superfície aplicável completa", status: "partial", proof: "tests/design_feedback_budget.test.js", reason: "saída sempre limitada (bounded) é real e testada; 'scan de fechamento de fase cobrindo superfície completa' não está wireado a nenhum comando real" },
  { id: 6, title: "Hook do Codex não-confiável reporta aguardando aprovação", status: "not_executed", proof: null, reason: "Codex nesta sessão só recebeu bloco instrucional (AGENTS.md, S49.3) — nenhum estado real de 'awaiting_user_trust' foi construído/testado" },
  { id: 7, title: "Config sagrada do OpenCode permanece byte-a-byte inalterada", status: "real", proof: "tests/opencode_config_conflict.test.js", reason: null },
  { id: 8, title: "Grafo do Graphify stale impede claim de arquitetura e o refresh corrige", status: "real", proof: "tests/proof_release.test.js", reason: null },
  { id: 9, title: "Escape de vault do Obsidian e ingestão de secret são negados", status: "real", proof: "tests/obsidian_skill_routes.test.js", reason: null },
  { id: 10, title: "Rota fake-provider do Scroll World exige confirmação de custo e passa checagens de seam/mobile/reduced-motion", status: "partial", proof: "tests/e2e/scroll_world_fixture.e2e.test.js", reason: "confirmação de custo real e testada; checagens de seam/mobile/reduced-motion exigem pipeline de mídia/Playwright real, não construído" },
  { id: 11, title: "Provider pago/de rede negado produz um fallback estático usável", status: "real", proof: "tests/e2e/scroll_world_fixture.e2e.test.js", reason: null },
  { id: 12, title: "Rota transcript-first de vídeo usa zero frames quando suficiente", status: "real", proof: "tests/media_intake_router.test.js", reason: null },
  { id: 13, title: "NotebookLM indisponível degrada só o passo opcional de pesquisa", status: "real", proof: "tests/notebooklm_adapter.test.js", reason: null },
  { id: 14, title: "Uninstall restaura toda config e remove só projeções de propriedade do manifest", status: "not_executed", proof: null, reason: "as projeções project-local novas (design-hooks.js, S49.3) não têm uma função de remoção/uninstall dedicada construída ainda" },
  { id: 15, title: "Inventário de pacote/SBOM/NOTICE contém a fonte Impeccable vendorizada e o commit auditado exato", status: "real", proof: "tests/impeccable_vendor_provenance.test.js", reason: null },
])
