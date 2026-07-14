# PLANSPRINTSPRD42 — Calibração de execução (leitura obrigatória antes do PRD42)

> **Autoridade:** este documento é **bloqueante**. O executor de código do PRD42 (Fable 5) deve
> lê-lo por inteiro antes de qualquer edição de `src/`. Ele NÃO substitui o `prd42.md` nem o
> `comparacao-final-lancamento-20260713.md` — ele os **calibra** com o estado verificado do
> repositório, corrige premissas imprecisas e impede duplicação de mecanismos que já existem.
> Em conflito entre a prosa de um PRD e o código real citado aqui com `arquivo:linha`, **vence o
> código real** e este documento; discrepância nova → parar com `blocked_contract_drift` e
> atualizar PRD/ADR antes de criar uma segunda fonte de verdade.

**Data:** 2026-07-13 · **Baseline:** pacote `4.9.0`, HEAD `caf3a5b`, `master` limpo · **Alvo:**
`v5.0.0` após auditoria de prontidão e teste de máquina limpa.

---

## 1. Finalidade e regra de leitura

O PRD42 productiza a jornada Replit-like **sobre** o núcleo do PRD41. Antes de expandir produto,
é obrigatório **fechar a verdade operacional** (Capability Truth) e **reparar dois débitos de
baseline** que o PRD42 §0 assumiu prontos e a auditoria provou abertos. Sem isso, features novas
herdariam claims falsos.

Princípio-guia (do fundador): **nada é enfeite — tudo tem que funcionar de verdade para o usuário
final**. Critério transversal: nenhum gate/loop/claim "verde" sem execução comprovada por
evidência, e cada capacidade precisa de um **controle negativo** (teste que reprova se a
capacidade for removida).

## 2. Baseline verificada (v4.9.0 / HEAD caf3a5b)

- PRD41 fechado; npm `@gstack-vibehard/installer@4.9.0` = `latest`; GitHub `master`+tag `v4.9.0`;
  CI Test verde. Suíte JS ~1031 + Py 84; QG strict 0.
- 193 arquivos de teste JS; 20 agentes canônicos (`agents/agents/*.md`); 30 módulos em `src/skills/`.
- Runtime manifest em **schemaVersion 2** (só `services[]`). `verify` usa **`--profile`** (não tier).
- `dev`/`stop`/`logs` **existem** (`commands/runtime-supervisor.js`, dispatch `cli/index.js:319-321`).

## 3. Achados confirmados pela auditoria (calibram os sprints)

### 3.1 Divergências de claim vs código

| Achado | Veredito | Evidência (`arquivo:linha`) |
|---|---|---|
| Lite materializa Casdoor/Headroom MCP + `sandbox:"openhands"` | **CONFIRMADO — bug de usuário final** | `create.js:1538` (scaffold sem guarda) → `:1422` `writeGatewayMcpConfig` incondicional → `.mcp.json` com casdoor-gateway+headroom (`:494-517`); `:649` `sandbox:"openhands"` sem condição; `:540,:577` passos openhands; contradiz o print `:1531` "pulando: Casdoor…" |
| Claims percentuais sem prova | **CONFIRMADO** | `harness/instructional.js:41` "Headroom … até 95%" (**user-facing**, vai p/ AGENTS.md/GEMINI.md); `printing-press/registry.js:7` "~60-80%" (comentário JSDoc, menor) |
| Metadata legado `agent-hooks` vs matriz honesta | **CONFIRMADO** | `create.js:33-45` `OMNIHARNESS_MAP` dá `agent-hooks` a windsurf/opencode/codex/cursor; `agents/adapter-matrix.js:47-95` os classifica `instructional`/`rules_only`/`partial`; só `claude`=`real_hooks` |
| Adapter OpenHands com `--path`/`--runtime=runsc` | **REFUTADO** | Não existe adapter algum; só o claim estático `sandbox:"openhands"`. Trabalho real = **representar honestamente** (Docker padrão; Windows `wsl_only\|unsupported`), não remover flags inexistentes |
| FastContext opt-in "não implementado" | **CONFIRMADO e honesto** | `commands/context.js:220-221`, `context-docs/scout.js:13-14` rejeitam com erro honesto — estado declarado, não bug |

### 3.2 Condições de entrada do §0 do PRD42 — `blocked_by_baseline` real

| Condição | Estado | Evidência |
|---|---|---|
| `start` ligado ao LoopEngine canônico | **FALHA** | `commands/start.js:6,252` usa `runPipeline`/`PIPELINE_STAGES` (`project-plan/run-loop.js`); zero import de `loop-engine.js`. É o débito DEFERIDO no S41.4 |
| Dream Audit behavioral canônico no CLI | **FALHA** | `commands/dream.js:56` chama `audit({root})`; flag `--behavioral` inexiste; `commands/proof.js:41` idem. Motor existe (`dream/auditor.js:291`, `dream/claim-contract.js`, S41.9) |
| QA visual sem a11y hardcoded | OK | `skills/visual-gate.js:48-65` (S41.6) |
| Gate Registry fonte única da DECISÃO | OK (com ressalva) | `commands/proof.js:109-116` (blockers 100% do registry); warnings de readiness (`:79-80,:111`) concatenados fora — não afeta `ready`, unificar no S42.0B |
| Subcomandos do preflight existem | OK | `proof`/`dream audit`/`tools readiness` roteados em `cli/index.js` |
| npm scripts do S42.13 | **4/10 FALTAM** | criar `test:golden`, `test:e2e:capabilities`, `test:e2e:package`, `agents:check` nos sprints que os usam |

## 4. Correções ao relatório (ausente ≠ existente-a-estender)

O PRD42 escreve "modificar X" para vários módulos que **não existem** — nesses casos é **CRIAR**,
não modificar. E cita "corrigir adapter OpenHands" quando não há adapter (é **representar**). A
matriz abaixo é a fonte para não duplicar mecanismo nem inventar arquivo.

### Matriz CRIAR · ESTENDER · CORRIGIR · PROVAR · NÃO-DUPLICAR

**CRIAR (greenfield):** `src/capabilities/{registry,contract,probe}.js`;
`src/skills/{step-close,change-surface,quality-profile,budget-policy,qa-plan,execution-contract,
behavioral-conformance,debug-investigation,design-direction,acceptance-demo,delivery-scorecard}.js`;
`src/project-plan/{question-registry,intake,product-brief,artifact-review,traceability}.js`;
`tests/golden/`+`scripts/golden.mjs`; `.github/workflows/capability-e2e.yml`;
`scripts/clean-machine-proof.mjs`; subcomando `agents conformance`; runbook clean-machine.

**ESTENDER (existe):** `commands/start.js` (DIRIGIR pelo LoopEngine — **não** 2ª FSM);
`commands/dream.js` (behavioral default+flag); `runtime/manifest.js` v2→v3 c/ migração;
`commands/verify.js` (`--tier` aditivo ao `--profile`); `skills/design-system.js` v1→v2 c/
migração; `commands/runtime-supervisor.js` (`dev/stop/logs`); `scripts/test-pack.mjs` +
`scripts/test-e2e-lifecycle.mjs` (reusar p/ package lifecycle — **não** reescrever);
`skills/gate-registry.js` (unificar warnings de readiness).

**CORRIGIR:** vazamento Lite em `create.js` (`:1422/:649/:540/:577`); `OMNIHARNESS_MAP`↔
`adapter-matrix` (`:33-45`); claims `instructional.js:41` e `printing-press/registry.js:7`.

**PROVAR (E2E + controle negativo):** Casdoor RBAC (401/403/viewer/admin); Atomic merge
concorrente (2 views, mesma linha); AgentMemory write→restart→search; OpenHands sentinel fora do
mount; Golden drift; package lifecycle byte-a-byte; clean-machine por plataforma.

**NÃO DUPLICAR:** LoopEngine (única máquina de estados); `test-pack`/lifecycle/clean-machine
(estender); Gate Registry (sem registry paralelo); ECC/OpenHands/Replit/RTK = **referência, nunca
dependência runtime**; backend é "operacional" só com probe + versão fixada + teardown.

## 5. Sequência calibrada

**Fase 0 (verdade + reparo de baseline, bloqueante):**
S42.0A verdade Lite/harness/claims (`v4.10.0`) → S42.0B Dream behavioral CLI + Capability Contract
(`v4.10.1`) → S42.0C start↔LoopEngine (`v4.10.2`) → S42.0D backend E2E em jobs dedicados
(`v4.10.3`) → S42.0E Golden + package lifecycle + curadoria Replit (`v4.10.4`).
**S42.1 só inicia após o proof consolidado da Fase 0.**

**Fase 1 (produto):** S42.1 Intake/Brief · S42.2 Design v2 · S42.3 Skill Execution Contract ·
S42.4 Behavioral Conformance · S42.5 Artifact Reviews · S42.6 Runtime v3/UX (`v4.11`→`v4.16`).

**Fase 2 (qualidade):** S42.7 Step-close · S42.8 Quality Profiles/tiers/budgets · S42.9 Debug
científico (`v4.17`→`v4.19`).

**Fase 3 (fechamento):** S42.10 Handoff compacto · S42.11 Paralelismo adaptativo · S42.12
Acceptance Demo/scorecard/health (`v4.20`→`v4.22`).

**Fase 4:** S42.13 E2E de produto + **Clean-Machine Test Pack** + auditoria → `v5.0.0`.

## 6. Preflight, gates e evidências (por sprint)

**Preflight (§0 recalibrado):** `node -p version` (>=4.9.0) · `git status --short` (limpo) ·
`node src/index.js proof --profile full --json` (**full**, não `release`: no estado por-sprint o
`release` reprova por `version-bump`/source-parity, honesto só no publish) · `dream audit --json`
· `tools readiness --json`. Falha de condição real ⇒ parar `blocked_by_baseline`.

**Cadência invariante:** branch `feat/s42-N-slug` → **teste RED** que reproduz o gap + controle
negativo → commits por unidade (trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)
→ QG strict `blocking_severity_count:0` → `npm run lint` + `npm run typecheck:ts` → suíte JS+Py
completa (bg) → `npm version X.Y.Z --no-git-tag-version` (re-sync `~/.codex/hooks/qg.py` se o
`qg.py` mudou) → CHANGELOG topo → `git merge --no-ff` → `graphify update` → **`proof --profile
full` no repo REAL** (ready:true) → memória. `.docs/` é gitignored → `git add -f` p/ arquivos que
testes leem.

**Evidências obrigatórias por capacidade:** adapter + probe + **controle negativo** + hash de
artefato + `freshAt`. Nenhum `active=true` derivado de presença em disco. Backend só `real`/
`healthy` com probe vivo; senão `configured`/`not_proved`/`blocked_missing_engine` (nunca skip
verde).

## 7. Condições de parada (hard stops)

- Reintroduzir o vazamento Lite, ou Lite gerar MCP/processo/sandbox de componente Full.
- Declarar backend operacional só por arquivo/config gerado.
- Criar 2ª máquina de estados em paralelo ao LoopEngine.
- Reimplementar `test-pack`/lifecycle/clean-machine em vez de estender.
- Harness `instructional/rules_only/partial` aparecer como `enforced`/`agent-hooks`.
- `not_applicable` contado como `passed`; score sem threshold como verde; required skipado por
  engine ausente em release.
- Publicar npm/GitHub ou auto-merge sem ordem humana explícita.
- Tocar `.env*`, config global oculta, ou projeto do usuário sem safe-write/restore.

## 8. Definition of Done do documento

- [x] Finalidade, autoridade e regra de leitura obrigatória.
- [x] Baseline v4.9.0 / HEAD `caf3a5b` verificada.
- [x] Achados confirmados (Lite, start↔LoopEngine, Dream behavioral, harness, claims).
- [x] Correções ao relatório (ausente vs existente) + matriz criar/estender/corrigir/provar/não-duplicar.
- [x] Sequência calibrada 42.0A→42.0E + fases 1–4.
- [x] Preflight, gates, evidências, condições de parada e DoD por sprint.
- [x] `proof --profile full` por-sprint; `release` reservado ao fechamento de publicação.
- [x] Não altera código; não contradiz garantias de segurança/rollback/escopo local do GStack.
