/**
 * Checklist de Release Candidate do PRD51 (S51.10.1).
 *
 * PRD51 era o único programa SEM checklist canônico — `prd status` agregava PRD45-PRD50 e
 * deixava de fora justamente o programa de fechamento. Sem isto, o RC do PRD51 não é um
 * objeto verificável, só uma narrativa.
 *
 * Duas listas, porque o PRD51 tem duas perguntas diferentes:
 *
 *   PRD51_RC_ITEMS  — o que cada sprint entregou, com a prova que reprova se sumir.
 *                     Espelha `rc-checklist-prd45..50.js`.
 *   PRD51_DOD_ITEMS — a Definition of Done do §9 do prd51.md (24 caixas). Um sprint
 *                     entregue não implica o DoD satisfeito: várias caixas são execuções
 *                     (`runtime`), não arquivos, e nenhuma execução é presumida por
 *                     omissão. É por isso que este checklist pode ter todos os sprints
 *                     fechados e ainda assim recusar "concluído".
 *
 * REGRA DE HONESTIDADE (a mesma do S51.0B/0C): só é `satisfied` o que tem prova apontável
 * VERIFICADA em disco. `partial` é para caixa cujo escopo foi deliberadamente recortado —
 * com o recorte escrito. `pending` é ausência de evidência, nunca "provavelmente ok".
 */
export const PRD51_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd51.v1"

// tier: P0 (bloqueador) | P1 (importante) | P2 (residual). O tier vem do achado do §4 do
// prd51.md que o sprint fecha — não de julgamento retroativo sobre o esforço gasto.
export const PRD51_RC_ITEMS = Object.freeze([
  // 4.3 P0 — claims públicos não correspondiam ao auditor
  { id: "S51.0A", tier: "P0", sprint: "S51.0A", version: "5.57.0", status: "delivered", title: "Placar fixo '20 REAL' removido do README; scoreboard DERIVADO do auditor real, com proveniência", proof: "tests/public_claims_honesty.test.js" },
  // §3 — freeze e baseline reproduzível (fundação de todo o resto)
  { id: "S51.0B", tier: "P0", sprint: "S51.0B", version: "5.58.0", status: "delivered", title: "4 estados que não se implicam (releaseReady/programComplete/operationallyProven/fullyValidated); n=1 nunca prova (MIN_RUNS_FOR_OPERATIONAL=20)", proof: "tests/release_baseline.test.js" },
  { id: "S51.0C", tier: "P0", sprint: "S51.0C", version: "5.59.2", status: "delivered", title: "As 4 fail-opens do baseline corrigidas fail-closed + releaseBaseline advisory em `verify --json` (nunca um segundo gate)", proof: "tests/release_baseline_failclosed.test.js" },
  // 4.1 P0 — runtime Windows
  { id: "S51.1", tier: "P0", sprint: "S51.1", version: "5.59.0", status: "delivered", title: "Causa raiz do runtime Windows: a probe de liveness vira a autoridade, não o exit code do taskkill", proof: "tests/runtime_windows_deterministic.test.js" },
  { id: "S51.1.1", tier: "P0", sprint: "S51.1.1", version: "5.59.1", status: "delivered", title: "As 2 causas que a 5.59.0 não fechou: stderr preservado no kill + reconciliação de still_alive→stopped (fail-closed preservado)", proof: "tests/runtime_windows_reconcile.test.js" },
  // 4.2 P0 — Golden Path governa o `start`
  { id: "S51.2.1", tier: "P0", sprint: "S51.2.1", version: "5.60.0", status: "delivered", title: "Acceptance real do brief chega no motor — antes sempre [] por omissão de wiring", proof: "tests/start_acceptance_wiring.test.js" },
  { id: "S51.2.2", tier: "P0", sprint: "S51.2.2", version: "5.61.0", status: "delivered", title: "`review` deixa de ser string hardcoded e roda de verdade (reusa diffHygiene)", proof: "tests/start_review_stage.test.js" },
  { id: "S51.2.3", tier: "P0", sprint: "S51.2.3", version: "5.62.0", status: "delivered", title: "Preview bloqueante e a feature flag temporária do cutover (`GATE_STAGES` vira `gateStagesFor`)", proof: "tests/start_preview_gate.test.js" },
  { id: "S51.2.4", tier: "P0", sprint: "S51.2.4", version: "5.63.0", status: "delivered", title: "Diagnóstico REAL anexado ao handoff — sem fabricar o ciclo agêntico que o `start` síncrono não suporta", proof: "tests/start_repair_diagnosis.test.js" },
  { id: "S51.2.5", tier: "P0", sprint: "S51.2.5", version: "5.64.0", status: "delivered", title: "Proof automático sob o Golden Run; `--no-proof` como opt-out explícito", proof: "tests/start_proof_default.test.js" },
  { id: "S51.2.6", tier: "P0", sprint: "S51.2.6", version: "5.65.0", status: "delivered", title: "Closeout resincronizado com o proof REAL (o de dentro do pipeline era um proxy do verify)", proof: "tests/start_closeout_real_proof.test.js" },
  { id: "S51.2.7", tier: "P0", sprint: "S51.2.7", version: "5.66.0", status: "delivered", title: "Journeys reais (`--journeys`) + cutover: status público deriva do vocabulário estrito do motor", proof: "tests/start_golden_run_cutover.test.js" },
  { id: "S51.10.0", tier: "P0", sprint: "S51.10.0", version: "5.100.0", status: "delivered", title: "Decisão do §11 tomada no RC: Golden Run vira o DEFAULT do `start`; legado preservado em `--no-golden-run`", proof: "tests/golden_run_default.test.js" },
  // 4.5 P1 — checklists comprovam fechamento parcial
  { id: "S51.3", tier: "P1", sprint: "S51.3", version: "5.67.0", status: "delivered", title: "Ledger unificado de PRDs (reusa buildReleaseBaseline) + checklist canônico do PRD46 + `prd status`", proof: "tests/prd_ledger.test.js" },
  // 4.4 P0 — firewall Knowledge/Execution classificava efeitos errado
  { id: "S51.4.1", tier: "P0", sprint: "S51.4.1", version: "5.68.0", status: "delivered", title: "`plan run` usa o MESMO pipeline do `start` — antes pulava silenciosamente todos os gates pós-create", proof: "tests/plan_command.test.js" },
  { id: "S51.4.2", tier: "P0", sprint: "S51.4.2", version: "5.69.0", status: "delivered", title: "`visual hooks install` deixa de escrever 4 arquivos de config sem consentimento", proof: "tests/design_hook_projection.test.js" },
  { id: "S51.4.3", tier: "P0", sprint: "S51.4.3", version: "5.70.0", status: "delivered", title: "`research --repo`: consentimento antes do clone + fim da staleness (mirror re-sincroniza)", proof: "tests/research_repo_consent.test.js" },
  // 4.9 P1 — registro e ajuda da CLI com múltiplas fontes de verdade
  { id: "S51.4.4", tier: "P1", sprint: "S51.4.4", version: "5.71.0", status: "delivered", title: "`research`/`pp` existiam no DISPATCH mas nunca em COMMANDS; usage multi-subcomando era inalcançável", proof: "tests/cli_help_gaps.test.js" },
  { id: "S51.4.5", tier: "P1", sprint: "S51.4.5", version: "5.72.0", status: "delivered", title: "Registry de efeitos por operação com escopo honesto (só o investigado, não os ~49 comandos por inferência)", proof: "tests/operation_registry.test.js" },
  // 4.7 P1 — contexto e Graphify não refletiam o último sprint
  { id: "S51.5.1", tier: "P1", sprint: "S51.5.1", version: "5.73.0", status: "delivered", title: "Sidecar de proveniência do Graphify — o graph.json do upstream não tem built_at_commit (confirmado rodando o binário)", proof: "tests/graphify_provenance.test.js" },
  { id: "S51.5.2", tier: "P1", sprint: "S51.5.2", version: "5.74.0", status: "delivered", title: "`--refresh-on-close`: buildToolRefresh existia mas nenhum call site o injetava (toolsRefresh sempre 'not_run')", proof: "tests/start_refresh_on_close.test.js" },
  { id: "S51.5.3", tier: "P1", sprint: "S51.5.3", version: "5.75.0", status: "delivered", title: "SOURCE_TIER + filtros --source/--kind/--since + dedupe por conteúdo espelhado no context index", proof: "tests/context_index.test.js" },
  // 4.8 P1 — readiness produzia visões contraditórias
  { id: "S51.5.4", tier: "P1", sprint: "S51.5.4", version: "5.76.0", status: "delivered", title: "`tools verdict` reconcilia `tools readiness` e `agents doctor`, que podiam discordar em silêncio", proof: "tests/capability_verdict.test.js" },
  { id: "S51.5.5", tier: "P1", sprint: "S51.5.5", version: "5.77.0", status: "delivered", title: "`headroom-routing` era advisory para TODO profile, inclusive `full` — `proof --profile full` dava ready:true sem Headroom roteado", proof: "tests/headroom_status.test.js" },
  // 4.3 P0 (continuação) — as 20 claims NOT_PROVED
  { id: "S51.6.1", tier: "P0", sprint: "S51.6.1", version: "5.78.0", status: "delivered", title: "CI publica o placar real do commit (o `dream audit` rodava só para parity de tarball)", proof: "tests/dream_scoreboard_publish.test.js" },
  { id: "S51.6.2", tier: "P0", sprint: "S51.6.2+3", version: "5.79.0", status: "delivered", title: "Nenhum teste jamais chamava buildProof sem mockar deps.dream — a fiação real audit()→buildProof nunca fora verificada", proof: "tests/proof_release.test.js" },
  { id: "S51.6.4", tier: "P0", sprint: "S51.6.4", version: "5.80.0", status: "delivered", title: "16 claims graduam REAL com contrato comportamental (cada teste citado lido linha a linha antes de citar)", proof: "tests/claim_contracts_s51_6_4.test.js" },
  { id: "S51.6.5", tier: "P0", sprint: "S51.6.5", version: "5.81.0", status: "delivered", title: "output-guard: o caminho PÓS-HOC (roda em todo turno, sem opt-in) nunca tivera teste; RBAC provado de verdade", proof: "tests/test_stop_output_guard_rbac.py" },
  { id: "S51.6.6", tier: "P0", sprint: "S51.6.6", version: "5.82.0", status: "delivered", title: "governance: `npm sbom` real provado passando E falhando (antes só checava presença de arquivo)", proof: "tests/governance_sbom_real.test.js" },
  { id: "S51.6.7", tier: "P0", sprint: "S51.6.7", version: "5.83.0", status: "delivered", title: "dream-freshness: única claim que exigiu capacidade NOVA — `dream revoke`/`dream stale` inéditos", proof: "tests/dream_freshness_cli.test.js" },
  { id: "S51.6.8", tier: "P0", sprint: "S51.6.8", version: "5.84.0", status: "delivered", title: "type-coverage: `c8` real provado falhando com threshold alto. Placar final 24 REAL / 0 NOT_PROVED", proof: "tests/type_coverage_gate_real.test.js" },
  // 4.12 P2 — capacidades honestamente incompletas (residuais PRD48/49)
  { id: "S51.7.1", tier: "P2", sprint: "S51.7.1", version: "5.85.0", status: "delivered", title: "Harness intake wired no `start` (fecha PRD48 P1.1)", proof: "tests/start_harness_intake.test.js" },
  { id: "S51.7.2", tier: "P2", sprint: "S51.7.2", version: "5.86.0", status: "delivered", title: "Decision presenter wired em superfície real (fecha PRD48 P1.4)", proof: "tests/decision_presenter.test.js" },
  { id: "S51.7.3", tier: "P2", sprint: "S51.7.3", version: "5.87.0", status: "delivered", title: "Próxima ação segura em toda falha importante (fecha PRD48 P2.2)", proof: "tests/safe_next_action.test.js" },
  { id: "S51.7.4", tier: "P2", sprint: "S51.7.4", version: "5.88.0", status: "delivered", title: "Minimality alimentado por sinal REAL do diff (fecha PRD49 P1.4)", proof: "tests/minimality_evidence.test.js" },
  { id: "S51.7.5", tier: "P2", sprint: "S51.7.5", version: "5.89.0", status: "delivered", title: "Design context persiste e alimenta o gate (fecha o wiring do PRD49 P1.1)", proof: "tests/design_context_sync.test.js" },
  { id: "S51.7.6", tier: "P2", sprint: "S51.7.6", version: "5.90.0", status: "delivered", title: "Uninstall REAL das projeções de hook de design (fecha cenário 14 do PRD49)", proof: "tests/design_hook_uninstall.test.js" },
  { id: "S51.7.7", tier: "P2", sprint: "S51.7.7", version: "5.91.0", status: "delivered", title: "Estado de confiança REAL dos hooks do Codex (cenário 6 do PRD49 sai de not_executed)", proof: "tests/codex_trust.test.js" },
  { id: "S51.7.8", tier: "P2", sprint: "S51.7.8", version: "5.92.0", status: "delivered", title: "Classificação clara de enforcement por harness", proof: "tests/enforcement_scope.test.js" },
  // 4.6 P1 — fullyValidated do PRD50 era impossível
  { id: "S51.8.1", tier: "P1", sprint: "S51.8.1", version: "5.93.0", status: "delivered", title: "`fullyValidated` deixa de ser impossível: pendência humana (alcançável) separada de limite estrutural (não observável)", proof: "tests/validation_taxonomy.test.js" },
  { id: "S51.8.2", tier: "P1", sprint: "S51.8.2", version: "5.94.0", status: "delivered", title: "Congelamento verificável de corpus e holdout ANTES dos rótulos", proof: "tests/corpus_freeze.test.js" },
  { id: "S51.8.3", tier: "P1", sprint: "S51.8.3", version: "5.95.0", status: "delivered", title: "Mecânica da avaliação cega dupla", proof: "tests/blind_evaluation.test.js" },
  // 4.11 P2 / 4.10 P1 — manifest e typecheck
  { id: "S51.9.1", tier: "P2", sprint: "S51.9.1", version: "5.96.0", status: "delivered", title: "Runtime Manifest V3 promovido; fim do downgrade silencioso", proof: "tests/manifest_v3_promotion.test.js" },
  { id: "S51.9.2", tier: "P1", sprint: "S51.9.2", version: "5.97.0", status: "delivered", title: "`typecheck` passa a checar TIPO de verdade (`tsc --noEmit`), com controle negativo de erro de tipo", proof: "tests/typecheck_real_gate.test.js" },
  { id: "S51.9.3", tier: "P1", sprint: "S51.9.3", version: "5.98.0", status: "delivered", title: "`logs --follow` deixa de ser flag anunciada e inerte", proof: "tests/logs_follow.test.js" },
  { id: "S51.9.4", tier: "P1", sprint: "S51.9.4", version: "5.99.0", status: "delivered", title: "TGZ validado em ambiente limpo + detector de teste invisível", proof: "tests/tgz_clean_env.test.js" },
  { id: "S51.10.1", tier: "P1", sprint: "S51.10.1", version: "5.101.0", status: "delivered", title: "Checklist canônico do próprio PRD51 + DoD do §9 como objeto verificável; PRD47 reconciliado (3 P0 delivered, P0.2 non-goal)", proof: "tests/rc_checklist_prd51.test.js" },
])

/**
 * Definition of Done do §9 do prd51.md, verbatim nas 24 caixas.
 *
 * `kind` separa o que um arquivo pode provar do que só uma EXECUÇÃO prova:
 *   static  — fechado por prova apontável no repositório;
 *   runtime — exige execução no commit do RC (suíte em máquina fria, proof no HEAD,
 *             matriz cross-OS). Nunca `satisfied` por existir código que faria aquilo.
 *   derived — computado das outras listas, não declarado à mão.
 */
export const PRD51_DOD_ITEMS = Object.freeze([
  { id: "DOD.1", kind: "runtime", requirement: "suíte completa passa três vezes em máquina fria", status: "pending", missing: "execução não realizada; a suíte passa nesta máquina, que não é fria" },
  { id: "DOD.2", kind: "static", requirement: "zero processo órfão, EBUSY ou state residual", status: "satisfied", evidence: "tests/runtime_windows_reconcile.test.js" },
  { id: "DOD.3", kind: "runtime", requirement: "`proof --profile full --json` retorna ready:true no HEAD", status: "pending", missing: "prova só vale para o commit que a gerou (S51.0C); precisa rodar no commit final do RC" },
  { id: "DOD.4", kind: "static", requirement: "`start` não entrega sem gates aplicáveis, acceptance e proof real", status: "satisfied", evidence: "tests/golden_run_default.test.js" },
  { id: "DOD.5", kind: "static", requirement: "PRD47 retorna ready:true", status: "satisfied", evidence: "tests/rc_checklist_prd47.test.js" },
  { id: "DOD.6", kind: "static", requirement: "PRD45–PRD50 possuem checklist no schema comum", status: "satisfied", evidence: "tests/prd_ledger.test.js" },
  { id: "DOD.7", kind: "derived", requirement: "nenhum P0 permanece partial/pending", status: "satisfied", evidence: "computado de PRD51_RC_ITEMS e dos checklists agregados por `prd status`" },
  { id: "DOD.8", kind: "derived", requirement: "residuais P1 são entregues ou convertidos explicitamente em non-goal", status: "pending", missing: "PRD47 P1.8 e 4 P1 do PRD49 seguem `partial` sem conversão declarada em non-goal" },
  { id: "DOD.9", kind: "static", requirement: "programComplete não depende apenas de ready", status: "satisfied", evidence: "tests/release_baseline_failclosed.test.js" },
  { id: "DOD.10", kind: "static", requirement: "dream audit não usa placar fixo", status: "satisfied", evidence: "tests/public_claims_honesty.test.js" },
  { id: "DOD.11", kind: "static", requirement: "toda claim core pública possui contrato comportamental", status: "satisfied", evidence: "tests/claim_contracts_s51_6_4.test.js" },
  { id: "DOD.12", kind: "static", requirement: "command registry, help, dispatch e firewall têm uma fonte única", status: "partial", missing: "S51.4.5 deixou 2 das 5 detecções fora de escopo (subcomando inexistente / flag documentada não reconhecida) — exigiriam catálogo de subcomandos e flags que não existe", evidence: "tests/operation_registry.test.js" },
  // Fechado após o PRD51: `meta/json-contract.js` deriva do registry quem anuncia
  // `--json` (25) e obriga cada um a ter receita de varredura OU exclusão com motivo —
  // 0 sem conta. A varredura achou 2 quebras reais (`dev` e `actions ledger` emitiam
  // prosa no caminho degradado sob `--json`), ambas corrigidas.
  { id: "DOD.13", kind: "static", requirement: "todo `--json` anunciado gera stdout JSON puro", status: "satisfied", evidence: "tests/json_contract_sweep.test.js" },
  { id: "DOD.14", kind: "static", requirement: "Graphify freshness prova o HEAD", status: "satisfied", evidence: "tests/graphify_provenance.test.js" },
  // Fechado após o PRD51: a metade que faltava (o próprio prd51.md e o manual do
  // projeto na versão candidata) ganhou prova real em `test_context_db.py`, indexando
  // os arquivos REAIS do repositório — não fixture sintética.
  { id: "DOD.15", kind: "static", requirement: "busca de contexto encontra PRD49, PRD50, PRD51 e manual atual", status: "satisfied", evidence: "tests/test_context_db.py" },
  { id: "DOD.16", kind: "static", requirement: "mirrors externos não dominam resultados locais por padrão", status: "satisfied", evidence: "tests/context_index.test.js" },
  { id: "DOD.17", kind: "static", requirement: "Headroom não alega economia sem tráfego", status: "satisfied", evidence: "tests/headroom_status.test.js" },
  { id: "DOD.18", kind: "static", requirement: "typecheck real bloqueia erro de tipo", status: "satisfied", evidence: "tests/typecheck_real_gate.test.js" },
  { id: "DOD.19", kind: "static", requirement: "PRD50 separa validação humana de métrica não observável", status: "satisfied", evidence: "tests/validation_taxonomy.test.js" },
  // S51.10.2 — verificadas na auditoria da matriz. Estavam `pending` porque eu ainda não
  // tinha CHECADO, não porque faltasse cobertura; o checklist registrou a ignorância em vez
  // de chutar, e agora registra o que a leitura dos testes mostrou.
  { id: "DOD.20", kind: "static", requirement: "Lite não ganha dependências obrigatórias externas", status: "satisfied", evidence: "tests/full_contract.test.js" },
  { id: "DOD.21", kind: "static", requirement: "Full não modifica config global sem consentimento, backup e restore", status: "satisfied", evidence: "tests/install_global_consent.test.js" },
  // S51.10.4 — o manual saiu de v5.19.0 para a versão candidata, e a matriz de
  // capacidades passou a ser GERADA dos registries (não reescrita à mão), que é o que
  // impede o drift de voltar. `manual-lint` reprova baseline defasada em MAJOR/MINOR.
  { id: "DOD.22", kind: "static", requirement: "manuais descrevem a versão candidata, não v5.19", status: "satisfied", evidence: "tests/manual_lint.test.js" },
  { id: "DOD.23", kind: "runtime", requirement: "pacote TGZ passa clean-machine E2E nos três sistemas", status: "partial", missing: "A auditoria do S51.10.2 achou que `test:pack` (a prova do tarball REAL) rodava só no ubuntu, dentro do job `templates` — o job `e2e` cobre 3 SOs mas roda o lifecycle, não o empacotamento. Um defeito de empacotamento específico de Windows passaria batido. Corrigido: `test:pack` virou job próprio na matriz de 3 SOs. Segue `partial` porque é caixa `runtime`: a fiação existe, mas só o run da CI no commit final do RC prova a execução.", evidence: "tests/tgz_clean_env.test.js" },
  { id: "DOD.24", kind: "static", requirement: "release candidate possui rollback testado", status: "satisfied", evidence: "tests/uninstall_restore.test.js" },
])

const isDelivered = (i) => i.status === "delivered"
const itemIsClosed = (i) => isDelivered(i) || (i.nonGoal === true && Boolean(i.nonGoalReason))
const isSatisfied = (d) => d.status === "satisfied"

/**
 * Prontidão de RC do PRD51.
 *
 * `ready` responde "os sprints fecharam?" — todo P0 fechado. `programComplete` responde a
 * pergunta que interessa ao RC: "o DoD do §9 está satisfeito?". Os dois são deliberadamente
 * separados, pela mesma razão que o S51.0B separou os 4 estados do baseline: `ready:true`
 * nunca autorizou "concluído", e aqui não passa a autorizar.
 *
 * `openDoD` sai com o que falta, item a item, para que nada fique pendente em silêncio.
 */
export function prd51Readiness(items = PRD51_RC_ITEMS, dod = PRD51_DOD_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => !itemIsClosed(i))
  const p1Open = items.filter((i) => i.tier === "P1" && !itemIsClosed(i))
  const dodOpen = dod.filter((d) => !isSatisfied(d))
  return {
    schemaVersion: PRD51_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    programComplete: p0Pending.length === 0 && dodOpen.length === 0,
    counts: {
      items: items.length,
      p0: p0.length,
      p0Pending: p0Pending.length,
      p1Open: p1Open.length,
      dod: dod.length,
      dodSatisfied: dod.length - dodOpen.length,
      dodOpen: dodOpen.length,
    },
    p0Pending: p0Pending.map((i) => i.id),
    openDoD: dodOpen.map((d) => ({ id: d.id, kind: d.kind, status: d.status, requirement: d.requirement, missing: d.missing })),
    items,
  }
}
