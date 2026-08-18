# PRD51 — Pacote decisório e closeout

**Data:** 2026-08-17 · **HEAD:** `8cb77de` · **Versão:** 5.107.0

## Estado medido

```
suíte        3308 testes · 3307 pass · 0 fail · 1 skip conhecido · EXIT=0
lint         795 arquivos · 0 erro
typecheck    tsc --noEmit · limpo
QG           L1 pass 0 blockers · L2 pass 0 blockers · L3 pass 0 blockers
registry     i18n:registry:check → fresco · exit 0
pack         test:pack OK · inventário instalado 1905 pontos · registry fresh
diff --check limpo
prd status   ready:false · programComplete:false · releaseReady:false (7 programas)
inventário   1905 pontos · 0 unknown · phase1Gate.ok true
```

---

## ETAPA 1 — Pacote decisório

Legenda de destino: **local_complete** · **human_action_required** ·
**external_evidence_required** · **deferred/nonGoal**

### Caixas do DoD

| id | estado | evidência | impacto no RC | owner | decisão recomendada | destino | condição objetiva de fechamento |
|---|---|---|---|---|---|---|---|
| **DOD.3a** (`verify --profile full` no HEAD) | `pending` (parte de DOD.3, caixa `runtime`) | prova só vale para o commit que a gerou (S51.0C) | bloqueia `programComplete` | lucas | executar no commit final do RC | external_evidence_required | `verify --profile full --json` → `ready:true` no commit do RC, com o hash do commit no relatório |
| **DOD.3b** (`proof --profile full` no HEAD) | `pending` | idem | bloqueia `programComplete` | lucas | executar junto de 3a | external_evidence_required | `proof --profile full --json` → `ready:true` no MESMO commit |
| **DOD.7** (nenhum P0 partial/pending) | **`pending` — corrigido nesta leva** | era `satisfied` por string fixa com 3 P0 abertos; agora `estadoDod7()` deriva | bloqueia `programComplete` | lucas | fechar os 2 P0 do PRD48 | human_action_required | `PRD48 P0.CODEX-SECURITY` e `P0.CODEX-HOOKS` fechados ou convertidos em non-goal com razão |
| **DOD.8** (residuais P1) | `pending`, 7 abertos, **todos com disposição** | `estadoDod8()` + `RESIDUAL_DISPOSITIONS` | bloqueia `programComplete` | lucas | manter aberto; decidir a conversão de `PRD49 P1.5` | deferred | cada residual `delivered` ou `nonGoal` com razão escrita |
| **DOD.12** (fonte única de registry/help/dispatch/firewall) | `partial` → **`deferred_to_post_rc`** | `tests/operation_registry.test.js`; `rcClaimsAffected: []` PROVADO | não bloqueia claim alguma | lucas | deferir ao PRD52 | deferred | catálogo de subcomandos e flags existir |
| **DOD.23** (TGZ clean-machine nos 3 SOs) | `partial` | fiação corrigida (job próprio na matriz); execução não feita | bloqueia `programComplete` | lucas | executar em máquina externa | external_evidence_required | run de CI no commit do RC + máquina limpa real |

### Itens do ledger

| id | estado | evidência | impacto no RC | owner | decisão recomendada | destino | condição objetiva |
|---|---|---|---|---|---|---|---|
| **P0.NODE-SUPPORT-GATE-INVALID** | **`delivered` nesta leva** | `tests/node_support_contract.test.js` | desbloqueou `p0Pending` do PRD51 | lucas | — | local_complete | ✅ decisão registrada + `engines`/bootstrap/CI coerentes |
| **P1.ARTIFACT-SOURCE-INFERRED** | `pending` | `origem.commit` do runner descreve o checkout que EXECUTA, não a procedência do tarball | não bloqueia (rodada autoritativa teve procedência reconciliada 1039/1039) | lucas | manter bloqueio explícito | deferred | `executorCheckout` separado de `artifactSource`, com manifest verificado contra SHA-256; sem manifest → `null`/`unproven`, nunca inferido |
| **P1.CLI-JSON-EXIT-CODE** | `pending`, `fixAuthorized:false` | 3 achados preservados | não bloqueia | lucas | **não corrigir nesta leva** | human_action_required | autorização explícita do usuário |
| **P1.HOOK-WIRING-UNCERTIFIED** (novo) | `pending` | `before_shell.py` removido; `permission_request.py` sem registro automático | não bloqueia | lucas | registrar risco, sem refactor | deferred → PRD52 | manifest explícito de hooks com evento/dono/modo de registro |
| **S51.4.5** | `delivered` (sprint) | `tests/operation_registry.test.js` | — | lucas | — | local_complete | ✅ entregue; o recorte vive em DOD.12 |

### Os cinco residuais P1 (fora os tratados acima)

| id | disposição | owner | milestone | recomendação |
|---|---|---|---|---|
| PRD47 P1.8 | `external_evidence_required` | lucas | CI real + credenciais Stripe/Supabase | manter aberto; não é dívida técnica |
| PRD48 P2.1 (i18n da CLI) | `deferred` | lucas | **Fase 2 — cutover English-first** | **destravado**: a Fase 1B fechou (1905/0). Migrar 1.045 saídas num closeout seria o oposto de plano aprovado |
| PRD49 P1.5 | `deferred` | lucas | PRD52 | **converter em `nonGoal`** — a exclusão do `defuddle` já é decisão de produto (upstream exige `npm install -g`). Não convertido aqui: fechar por conta própria é o atalho que o §9 proíbe |
| PRD49 P1.6 | `deferred` | lucas | PRD52 | exige provedor real de mídia |
| PRD49 P1.8 | `deferred` | lucas | PRD52 | exige ambiente Python pinado |
| PRD50 P1.7 | `external_evidence_required` | lucas | rodada de rótulo humano cego | fechar sem os rótulos inverteria a metodologia do PRD50 |

### Condições externas

| id | estado | evidência | owner | destino | condição objetiva |
|---|---|---|---|---|---|
| **external_clean_machine_e2e** | não executado | `test:pack` e job `e2e` herdam ambiente preparado — nenhum é máquina LIMPA | lucas | external_evidence_required | execução em hardware/imagem sem GStack instalado, nos 3 SOs |
| **execução real do CI** | **nunca executado** | `runtime-compat.yml` existe e nunca rodou no GitHub | lucas | external_evidence_required | run no commit do RC; até lá cross-OS é `unproven` |
| **revogação do token npm** | **`security_blocking`** | decisão de 2026-08-18 — SUPERSEDE a linha anterior desta tabela, que dizia "não será feita" | lucas | human_action_required | rotação humana COMPROVADA; nada será afirmado sobre revogação até lá |
| **sync:qg** | ✅ executado | `QG_VERSION = 5.107.0 (já sincronizado)`, hash de `qg.py` inalterado (`71cd140b…`), backup feito e descartado sem uso | claude | local_complete | ✅ idempotente, nada a restaurar |
| **Headroom** | **não roteado** | `headroom doctor`: proxy não alcançável em `127.0.0.1:8787`; claude e codex `not routed`; `no savings recorded` | lucas | external_evidence_required | doctor com proxy ativo + harness roteado, antes de qualquer claim de economia |

---

## ETAPA 5 — Closeout

### local_complete

- Fase 1B do inventário i18n: 1905 pontos, **0 unknown**, `phase1Gate.ok true`
- Fatia 6 (`i18n:registry:check` em CI) e Fatia 7 (prova de `npm pack`)
- `P0.NODE-SUPPORT-GATE-INVALID` fechado: decisão + coerência `engines`/bootstrap/CI
- DOD.7 corrigido de `satisfied` falso para derivado real
- DOD.8 com disposição, dono e milestone por residual
- DOD.12 com recorte decidido e `rcClaimsAffected: []` provado
- `before_shell.py` removido, com controle anti-órfão
- `gc.py` com contrato executável
- `sync:qg` executado, idempotente
- Suíte, lint, typecheck, QG L1/L2/L3, registry check, pack, diff --check: **todos verdes**

### human_action_required

1. **PRD48 `P0.CODEX-SECURITY` e `P0.CODEX-HOOKS`** — são o que mantém `ready:false`.
2. **`PRD49 P1.5`** — autorizar a conversão em `nonGoal`.
3. **`P1.CLI-JSON-EXIT-CODE`** — autorizar (ou não) a correção funcional.
4. **Token npm** — `security_blocking` até **rotação humana comprovada** (decisão de 2026-08-18).

### external_evidence_required

1. Run real do CI (`test.yml` + `runtime-compat.yml`) no commit do RC.
2. DOD.3a/3b — `verify` e `proof --profile full` no commit final.
3. DOD.23 / clean-machine em máquina externa, 3 SOs.
4. Suíte 3× em máquina fria (DOD.1) + `workflow_dispatch` do `capability-e2e`.
5. Headroom roteado, se a economia for reivindicada.
6. Credenciais de terceiros (PRD47 P1.8) e rótulo humano cego (PRD50 P1.7).

### deferred / nonGoal

- **deferred:** DOD.12 → PRD52 · `P1.ARTIFACT-SOURCE-INFERRED` · `P1.HOOK-WIRING-UNCERTIFIED` → PRD52 · PRD48 P2.1 → Fase 2 · PRD49 P1.5/P1.6/P1.8 → PRD52
- **nonGoal:** nenhum criado nesta leva. `RESIDUAL_DISPOSITIONS` não tem `nonGoal` no vocabulário, de propósito.

### Veredito

```
releaseReady     false
programComplete  false
ready            false   (PRD48 P0.CODEX-SECURITY, P0.CODEX-HOOKS)
DoD              18/24 satisfeitas · 6 abertas
P0 do PRD51      0 pendentes
residuais P1     7 abertos, 0 sem disposição
```

**PRD51 não está completo, e nenhum campo o declara.** Das 6 caixas abertas do
DoD, 3 são `runtime` (só fecham executando no commit do RC), 1 depende dos P0 do
PRD48, 1 tem recorte deferido e 1 agrega os residuais. Nenhuma é dívida técnica
desta leva.

---

## Não afirmado

- Token npm revogado — segue `security_blocking`; nada é afirmado até a rotação ser comprovada.
- Clean-machine executado — não há máquina externa.
- CI executado — `runtime-compat.yml` nunca rodou.
- Headroom roteado — `doctor` mostra proxy inacessível e harness não roteado.
- Compatibilidade cross-OS — `unproven`, e assim permanece até o CI real.


---

# Adendo — 2026-08-18: decisões humanas aplicadas

**HEAD:** `58b6129`

```
suíte JS   3358 · 3357 pass · 0 fail · 1 skip · EXIT=0
pytest     110 pass · 61 subtests
lint 797 · typecheck limpo · QG L1/L2/L3 0 blockers · registry fresco
test:pack OK · diff --check limpo
ready:false · programComplete:false · DoD 18/24
```

## O que fechou

| id | antes | agora |
|---|---|---|
| **PRD49 P1.5** | `deferred` | **`nonGoal`** aprovado — `status` segue `partial`, porque a skill de fato não foi vendorizada. Non-goal fecha por DECISÃO, nunca por promoção de status. |
| **P1.CLI-JSON-EXIT-CODE** | `pending` | **`delivered`** em 3 commits (`context`, `research`, `task run`) |

## O que mudou de tamanho

**P0.CODEX-HOOKS** — esta leitura foi **REVOGADA em 2026-08-18**. O texto abaixo
fica como registro do erro, não como estado:

> ~~A integração real não existe, e escrevê-la exige o modelo de confiança que a
> extração não revela.~~

O que estava certo: `on_session_start` e `on_stop` têm **zero ocorrências** no
binário, e o wiring de `config.toml` era inerte — a remoção dele vale e não volta.

O que estava **errado**: concluir que a integração não era construível. O contrato
canônico é **`~/.codex/hooks.json`** (`SessionStart`, `PreToolUse`, `PostToolUse`,
`PermissionRequest`, `Stop`, `UserPromptSubmit`), e `config.toml [hooks.state]` é
**ledger de confiança** — o mecanismo de aprovação, não um impedimento. Li a
exigência de `trusted_hash` como barreira; ela pertence a quem aprova.

**P0.CODEX-SECURITY**: modelo de ameaça achou 6 vetores auto-aprovados. O central
era o comando **composto** — `re.match` ancora no início, então `ls && cat .env`
passava inteiro. Fechados por análise por segmento. O que falta não é correção, é
**enforcement observado**.

## Segue aberto

- **2 P0 do PRD48** — agora por ENFORCEMENT não observado, não por defeito de script.
- **DOD.1/3/23** — caixas `runtime`, só fecham no commit final do RC.
- **DOD.8** — 5 residuais, todos com disposição, dono e milestone.
- **DOD.12** — recorte deferido ao PRD52.
- **Token npm** — `security_blocking` até rotação humana comprovada. **Não afirmado como revogado.**
- CI real, clean-machine e Headroom seguem `external_evidence_required`.

## Erros meus, corrigidos e registrados

1. O re-ancorador de provenance tratava override por `expectedIds`, e `[]` casa
   com qualquer ponto sem ids — moveu **dois overrides para callsites errados**.
   Overrides saíram do script: âncora humana exige auditoria, não heurística.
2. A primeira versão das correções de `--json` passava a frase como **argumento**
   do helper, o que tira o literal do callsite de um sink — **8 pontos de mensagem
   sumiram do censo**. Corrigido com thunk, o idioma que `ctxFail` já usava.
3. Um padrão `--version` na allowlist ficou **inalcançável** (a trava dispara
   antes): pior que ausente, porque parecia cobertura. Removido.
