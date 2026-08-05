# PRD52 — Fechamento do Produto e Certificação Operacional

> **Para agentes executores:** usar `superpowers:executing-plans` ou
> `superpowers:subagent-driven-development`. Executar uma tarefa por vez, em
> branch/worktree isolada, com teste negativo antes da implementação. Nenhum
> sprint deste documento autoriza publicação automática.

**Goal:** transformar o estado atual da `v5.59.2` em um produto terminal-first
lançável, com Golden Path real, execução reproduzível, rollback e evidência do
mesmo artefato publicado.

**Architecture:** consolidar capacidades já existentes em um único caminho de
produto. O PRD herda o baseline fail-closed e seu wiring advisory no `verify`
entregues pelo PRD51 S51.0C; começa pelas verificações operacionais pré-publicação,
segue pelo cutover gradual do Golden Run, cria o ledger real de fechamento,
incorpora apenas práticas essenciais dos manuais e termina com certificação E2E
do pacote.

**Tech Stack:** Node.js 18+, JavaScript ESM com `tsc --checkJs`, Python para hooks,
Node Test Runner, Playwright, Git worktrees, SQLite/FTS, Graphify, Fallow e GitHub
Actions.

> **Baseline real:** `v5.59.2`, commit `5b14fa0`.
> **Data da reconciliação:** 2026-07-24.
> **Status:** plano de execução; nenhum item abaixo está implicitamente entregue.

---

## 1. Por que este PRD existe

PRD51 diagnosticou corretamente que o projeto possui componentes reais que ainda
não governam a jornada principal. Depois dessa auditoria, o Sprint 51.0C foi
concluído em duas partes e mergeado no `master` local no commit `5b14fa0`:

- as quatro fail-opens de `src/release/baseline.js` foram corrigidas;
- `verify --profile full --json` passou a expor `releaseBaseline`;
- o baseline é explicitamente `advisory` e não altera o status do `verify`;
- o `publish-guard` continua falhando fechado nos gates reais já existentes:
  `source-parity`, `dream-required`, `capability-e2e` e `golden-workflow`;
- `completeVerdict.ok` continua corretamente falso enquanto não existir o ledger
  real do Sprint 51.3 e as demais evidências de fechamento.

Continuam pendentes:

- validação pré-publicação em harness restrito, máquina fria e clean-machine
  Windows; o soak isolado de 20 ciclos já foi executado, mas não substitui essa
  matriz;
- um token npm foi exposto em transcript e precisa ser revogado;
- os Sprints 51.2 a 51.10 não foram iniciados;
- o Sprint 51.3 é o pré-requisito para `programComplete` deixar de ser falso por
  ausência de ledger;
- o Golden Run ainda não governa o caminho central do `start`.

Consequentemente:

| Estado | Situação na baseline |
|---|---|
| `releaseReady` | `unknown` até concluir a matriz pré-publicação no commit atual |
| `programComplete` | falso: PRD47 e outros residuais permanecem |
| `operationallyProven` | falso: soak isolado não substitui harness restrito, máquina fria e clean-machine |
| `fullyValidated` | falso/indeterminado: validações e contrato agregado incompletos |

PRD52 não adiciona uma nova arquitetura. Ele substitui a sequência de execução
restante do PRD51 a partir da `v5.59.2` e absorve a integração seletiva dos
manuais que faltava.

---

## 2. Limite epistemológico: “sem erros”

Nenhum software pode provar ausência universal de defeitos. Neste PRD,
“fechar sem erros” significa:

1. zero defeito conhecido P0/P1 aberto no escopo suportado;
2. zero falha ou flake na matriz definida neste documento;
3. nenhuma claim pública além da evidência;
4. pacote publicado idêntico ao pacote testado;
5. caminhos não testados claramente rotulados como experimentais ou não
   suportados;
6. rollback exercitado;
7. qualquer falha posterior produz diagnóstico, contenção e restauração, não
   corrupção silenciosa.

Uma execução verde, um mock, um arquivo criado ou um agente dizendo “concluído”
não satisfazem essa definição.

---

## 3. Autoridade e precedência

Em caso de divergência:

1. E2E do pacote real em máquina limpa;
2. evidence pack assinado/hashado do mesmo commit e tarball;
3. `proof` e gates do mesmo commit;
4. testes de integração do wiring;
5. código executável;
6. `projetogstack.md`;
7. `manualdeengenhariacomia.md`;
8. PRDs, CHANGELOG e transcript.

O manual de engenharia é fonte de práticas, não runtime. Nenhum agente deve
carregar os 50 módulos no contexto para criar um projeto.

---

## 4. Regras obrigatórias para o Claude Code

### 4.1 Protocolo por sprint

Para cada sprint:

1. confirmar branch, HEAD e árvore limpa;
2. ler os arquivos que serão alterados;
3. registrar uma contraprova que falha no código atual;
4. executar a contraprova e salvar a saída;
5. implementar a menor correção que fecha a causa, não o sintoma;
6. executar teste focado;
7. executar testes dos módulos vizinhos;
8. executar suíte completa;
9. verificar processos, portas, arquivos e diretórios residuais;
10. executar lint, typecheck real, QG e proof;
11. revisar o diff procurando mudança de contrato;
12. criar commit atômico;
13. executar novamente os gates no commit;
14. produzir evidence pack;
15. parar e solicitar revisão antes do merge.

### 4.2 Proibições

O Claude não pode:

- avançar porque uma execução isolada ficou verde;
- alterar teste para aceitar o defeito;
- trocar falha por warning para fechar gate;
- usar timeout maior como correção de race condition;
- classificar falha como “ambiental” sem contraprova;
- publicar por sprint;
- tocar diretamente em `master`;
- editar `.env*`, token ou config global de harness;
- instalar novo harness, MCP, memória ou framework;
- promover mock/fake como prova operacional;
- manter código dormente afirmando que ele governa o produto;
- usar `--yes` para ignorar aprovação de ação sensível;
- executar mais de um sprint que altere `start`, `proof`, schemas ou runtime em
  paralelo.

### 4.3 Condições de parada

Parar imediatamente quando:

- uma suíte antes verde regressar;
- JSON público mudar sem schema/versionamento;
- PID/porta/log/diretório permanecer após teste;
- o diff tocar arquivo não previsto;
- uma correção exigir escrita global;
- o mesmo gate falhar três vezes pela mesma causa;
- a evidência pertencer a outro commit;
- o agente não conseguir distinguir defeito de limitação do ambiente.

Nesses casos, produzir diagnóstico e handoff. Não improvisar outra arquitetura.

### 4.4 Contexto por sessão

Cada sprint deve começar em sessão nova ou Context Delta mínimo contendo:

- objetivo;
- commit base;
- arquivos-alvo;
- invariantes;
- teste vermelho;
- último gate;
- riscos;
- próximo passo.

Não reidratar a sessão com o transcript inteiro. O contexto do sprint deve caber
em um artefato versionado e revisável.

---

## 5. Escopo de produto

### 5.1 Público de lançamento

- iniciante capaz de usar terminal;
- desenvolvedor solo;
- equipe que precisa de padrão e rollback;
- power user que consome JSON e CI.

Leigo absoluto sem terminal continua fora do público principal desta versão.

### 5.2 Jornada que precisa funcionar

```text
Intent
-> Brief
-> Design (quando aplicável)
-> Plan
-> Approve Mission
-> Worktree
-> Implement
-> Run
-> Observe/Repair
-> Test
-> Review
-> Verify
-> Preview (quando aplicável)
-> Acceptance
-> Proof
-> Closeout
```

Únicos estados finais permitidos:

- `delivered`;
- `checkpoint_ready`;
- `blocked`.

`done`, `passed` ou “arquivos criados” não são vereditos de entrega.

---

## 6. Arquivos e responsabilidades

### Runtime

- `src/runtime/supervisor.js`: ownership, kill, liveness e resultado final;
- `src/commands/runtime-supervisor.js`: execução do SO, espera, render e cleanup;
- `tests/runtime_e2e.test.js`: processo/porta/log reais;
- `tests/runtime_windows_deterministic.test.js`: formatos de erro e races;
- `tests/runtime_stop_ownership.test.js`: PID estrangeiro e fail-closed;
- `tests/runtime_supervisor.test.js`: funções puras;
- novo `scripts/runtime-soak.mjs`: matriz repetida e evidence pack.

### Release e verdade

- `src/release/baseline.js`: quatro estados semânticos;
- `src/commands/proof.js`: veredito agregado;
- `src/commands/publish-guard.js`: bloqueio antes de release;
- `src/project-plan/publish-guard.js`: checks puros;
- `src/skills/closeout.js`: evidence do run;
- `src/dream/scoreboard.js`: placar derivado do auditor;
- `tests/release_baseline.test.js`;
- `tests/proof_release.test.js`;
- `tests/publish_guard_command.test.js`;
- `tests/closeout.test.js`.

### Golden Path

- `src/commands/start.js`;
- `src/project-plan/run-loop.js`;
- `src/project-plan/golden-run.js`;
- `src/project-plan/delivery-verdict.js`;
- `src/project-plan/runtime-repair-cycle.js`;
- `src/project-plan/acceptance-verification.js`;
- `src/project-plan/product-brief.js`;
- `src/project-plan/question-registry.js`;
- `tests/start_pipeline.test.js`;
- `tests/golden_run_controller.test.js`;
- `tests/delivery_verdict.test.js`;
- `tests/acceptance_verification.test.js`;
- `tests/runtime_repair_cycle.test.js`;
- `tests/prd47_baseline_negative_controls.test.js`.

### Manual-to-Core

- novo `src/project-plan/engineering-practices.js`;
- novo `src/project-plan/engineering-practices-schema.js`;
- novo `tests/engineering_practices.test.js`;
- `src/project-plan/intake.js`;
- `src/project-plan/product-brief.js`;
- `src/project-plan/question-registry.js`;
- `src/project-plan/planner.js`;
- `src/project-plan/recipes.js`;
- `src/skills/gate-matrix.js`.

### Contexto e ferramentas

- `src/skills/closeout.js`;
- `src/tools/refresh.js`;
- `src/tools/readiness.js`;
- `src/tools/graphify-adapter.js`;
- `src/context-docs/registry.js`;
- `src/context-docs/py/context_db.py`;
- `src/project-plan/context-delta.js`;
- `tests/closeout.test.js`;
- `tests/tool_readiness.test.js`;
- `tests/context_index_sources.test.js`;
- `tests/context_resume_benchmark.test.js`.

### CLI e contratos

- `src/cli/index.js`;
- `src/meta/command-layers.js`;
- novo `src/meta/command-registry.js`;
- `scripts/command-lint.mjs`;
- `src/project-plan/verify-runner.js`;
- `src/runtime/manifest.js`;
- testes de CLI, firewall, manifest e typecheck.

---

## 7. Sprint 52.0 — Segurança e checkpoint pré-publicação

**Objetivo:** preservar a baseline local `v5.59.2/5b14fa0` e impedir
publicação antes de revogação do token e evidência operacional no mesmo commit.

### Ação humana obrigatória e paralela

- [ ] Revogar no npm o token exposto no transcript.
- [ ] Confirmar que nenhum token equivalente permanece ativo.
- [ ] Não registrar novo token em arquivo persistente.
- [ ] Registrar o incidente sem incluir o valor do token.

A revogação bloqueia qualquer publicação, mas não impede a execução local e
read-only da matriz pré-publicação.

### Checkpoint do repositório

- [x] PRD51 S51.0C partes 1 e 2 mergeadas no `master` local.
- [x] Baseline fail-closed e `releaseBaseline` advisory provados por testes
  focados no commit `5b14fa0`.
- [ ] Congelar o commit enquanto a matriz pré-publicação é executada.
- [ ] Consultar npm e GitHub antes de publicar; não presumir que a versão local
  já existe remotamente.
- [ ] Não misturar o cutover estrutural do Golden Run à eventual republicação
  corretiva da baseline.
- [ ] Publicar somente uma versão ainda inexistente no registry, produzida do
  mesmo tarball certificado e apenas depois da revogação.
- [ ] Deprecar versão pública anterior somente se a falha correspondente tiver
  evidência reproduzível e a substituta estiver instalada com sucesso.

### Prova

- token revogado é confirmado sem registrar segredo;
- `git grep` não encontra o token completo em arquivos rastreados;
- HEAD, package version, tarball e evidence pack apontam para o mesmo conteúdo;
- nenhuma publicação ocorre antes de 52.1 ficar verde.

---

## 8. Sprint 52.1 — Certificação pré-publicação Windows Cross-Harness

**Objetivo:** provar que `dev -> stop -> dev` funciona na baseline atual em
shell normal, harness restrito e máquina limpa, sem matar PID estrangeiro nem
deixar resíduos.

O soak isolado de 20 ciclos é evidência herdada, não tarefa pendente. Esta sprint
começa por observação; só autoriza mudança de código se uma contraprova falhar.

### Contraprovas obrigatórias

- [ ] `taskkill` retorna PID inexistente com código/status localizado.
- [ ] `taskkill` retorna `Acesso negado`.
- [ ] kill retorna sucesso, probe imediata ainda vê vivo e probe final vê morto.
- [ ] kill retorna sucesso, processo continua vivo após o limite.
- [ ] processo morre, mas log permanece bloqueado temporariamente.
- [ ] porta permanece ocupada após PID sumir.
- [ ] PID foi reutilizado por processo estrangeiro.
- [ ] processo possui filhos.
- [ ] `stop` é chamado duas vezes.
- [ ] `dev --force` tenta reiniciar enquanto o antigo encerra.

### Correção condicional se a matriz falhar

Se todas as provas passarem, não alterar o runtime. Se alguma falhar, registrar
a contraprova e corrigir somente a causa observada. O reparo deve preservar:

1. Em `runtime-supervisor.js`, capturar stdout/stderr/exit status do `taskkill`.
   Não usar `stdio:"ignore"` no caminho de diagnóstico.
2. Manter mensagens localizadas apenas como diagnóstico; liveness final é a
   autoridade.
3. Tratar resultado imediato como `pending`, não veredito final.
4. Após `waitPidsExit`, reconciliar cada PID:
   - morto -> `stopped` ou `already_gone`;
   - vivo + permissão negada -> `access_denied`;
   - vivo + erro desconhecido -> `signal_failed`;
   - vivo sem erro -> `still_alive`.
5. Implementar fallback direto somente quando:
   - ownership foi verificado;
   - `taskkill` foi negado;
   - policy permite;
   - o fallback não amplia o alvo além do PID pertencente ao GStack.
6. Não afirmar árvore encerrada se o fallback só matou o processo principal.
7. Verificar liberação de porta e handle de log.
8. `clearState` deve devolver erro; nunca engolir falha.
9. `dev --force` deve consumir o mesmo reconciliador e abortar se o runtime
   anterior não foi encerrado.

### Teste de race obrigatório

O teste deve modelar:

```text
probe imediata = alive
wait final = dead
resultado final = stopped
state = removível
```

O comportamento atual retorna `still_alive` e mantém state; o teste precisa
falhar antes da correção.

### Matriz restante

- reaproveitar o relatório dos 20 ciclos isolados já concluídos;
- executar o cenário real em harness restrito;
- executar a suíte completa três vezes em máquina fria;
- executar clean-machine Windows com home e prefix temporários;
- validar cancelamento, segunda chamada de `stop`, PID estrangeiro e
  `dev --force`;
- contar PIDs, portas, logs e diretórios antes e depois;
- produzir relatório JSON com commit, SO, Node, harness mode e falhas.

`operationallyProven` permanece falso até todas as células obrigatórias terem
evidência do commit atual e zero resíduo.

### DoD

- [ ] contraprovas focadas verdes;
- [ ] harness restrito verde;
- [ ] três suítes completas em máquina fria;
- [ ] clean-machine Windows verde usando o pacote real;
- [ ] zero `gstack-e2e-*`;
- [ ] zero processo, porta, log ou diretório pertencente ao teste;
- [ ] PID estrangeiro preservado;
- [ ] `dev --force` fail-closed;
- [ ] proof full verde no commit;
- [ ] revisão independente apenas se o algoritmo de ownership mudar.

Checkpoint: se a matriz ficar verde e o token estiver revogado, a baseline pode
seguir para publicação corretiva sem incluir 51.2. Se falhar, corrigir, reiniciar
a matriz inteira e não publicar.

---

## 9. Sprint 52.2 — Golden Run em Shadow Mode

**Objetivo:** medir divergência entre status legado e Golden Run sem mudar ainda
a saída do usuário.

### Implementação

- executar `goldenRun` para todo `start`;
- persistir `legacyVerdict` e `goldenVerdict`;
- não mudar exit code nem status público;
- emitir warning apenas em modo diagnóstico;
- gerar relatório de divergência;
- não executar proof adicional nessa fase;
- não adicionar nova pergunta ao wizard.

### Corpus de comparação

No mínimo:

- projeto sem UI;
- projeto com UI saudável;
- preview unhealthy;
- teste falho;
- verify falho;
- acceptance pendente;
- runtime não iniciado;
- usuário cancela;
- dry-run;
- brownfield dirty;
- Lite sem ferramenta opcional;
- Full com ferramenta ausente.

### Gate

Shadow mode só termina quando:

- divergências esperadas estão classificadas;
- nenhuma divergência é silenciosa;
- não existe regressão de saída/exit code;
- custo adicional é medido;
- 30 fixtures determinísticas passam.

### Controles inspirados no Fable Method

O Fable Method entra somente como referência metodológica MIT, nunca como plugin,
instalador, dependência runtime ou segundo motor de loop. Adaptar no Golden Run:

- `intentAlignment`: registrar o que código, teste e especificação dizem antes
  de alterar comportamento; divergência volta ao planejamento;
- `twinSearch`: toda correção de defeito procura ocorrências equivalentes antes
  de declarar resolução completa;
- `claims`: cada alegação final referencia comando, observação, commit e
  artefato reproduzível;
- juiz read-only: reexecuta claims, confere diff/status, caça teste enfraquecido,
  escopo expandido e resíduos; veredito LLM continua advisory;
- trap suite em 52.9: teste errado contra spec, falso “concluído”, ação não
  autorizada, correção parcial, API lembrada sem fonte e debris.

Não copiar `fable-loop`: ele duplicaria o Loop Engine, o Golden Run e o
Meta-Harness existentes. Os controles entram em shadow mode e só são promovidos
se acrescentarem detecção sem regressão ou custo desproporcional.

Fonte: <https://github.com/Sahir619/fable-method>.

---

## 10. Sprint 52.3 — Ledger unificado e claims de conclusão

**Dependência:** executar somente depois do cutover estrutural de 52.2, que
corresponde ao Sprint 51.2. Esta sprint corresponde ao Sprint 51.3.

**Objetivo:** alimentar os quatro estados com evidência real sem transformar o
resumo advisory em um gate global redundante.

### Herdado e fechado pelo 51.0C

- [x] `programItems=[]` não produz `programComplete:true`;
- [x] validação humana ausente não produz `fullyValidated:true`;
- [x] `fullyValidated` é independente de `operationallyProven`;
- [x] proof sem commit ou de outro commit não produz `releaseReady:true`;
- [x] scoreboard recebe commit real ou injetado, nunca inventa provenance;
- [x] `verify --profile full --json` inclui `releaseBaseline.advisory=true`;
- [x] o baseline não altera `report.status`.

### Contrato preservado

- manter `gstack.release-baseline.v1` e compatibilidade aditiva;
- ausência de evidência continua representada como falso com razão explícita;
- `completeVerdict.ok` exige os quatro estados verdadeiros;
- `releaseBaseline` permanece advisory no `verify`;
- `completeVerdict` governa apenas a claim de produto/programa “concluído”;
- o `publish-guard` continua governado pelos gates operacionais reais já
  existentes, sem novo bloqueio global por `programComplete`;
- releases corretivas podem existir sem alegar conclusão do programa.

### Wiring restante

- [ ] criar ledger canônico dos PRDs 45 a 52;
- [ ] registrar item, escopo, status, evidência, commit, owner e non-goal;
- [ ] alimentar `programItems` exclusivamente pelo ledger;
- [ ] alimentar `humanValidation` pelo protocolo real do PRD50;
- [ ] alimentar runs operacionais pelo evidence pack da matriz;
- [ ] expor o mesmo resumo em `proof` e closeout sem transformá-lo em gate
  duplicado;
- [ ] docs públicas consultam o artefato vivo, não fixture histórica;
- [ ] dirty tree, commit divergente ou ledger adulterado invalidam a claim.

### Contraprovas

- ledger ausente ou vazio;
- item partial removido do ledger para fabricar conclusão;
- proof de commit A usado no B;
- validação humana ausente;
- uma execução verde promovida a prova operacional;
- baseline adulterada;
- `releaseReady:true` usado para afirmar `programComplete:true`;
- patch corretivo bloqueado apenas porque o roadmap ainda está aberto.

### DoD

- ledger real torna `programComplete` explicável, não necessariamente verdadeiro;
- `completeVerdict` permanece falso enquanto qualquer estado faltar;
- verify, proof e closeout mostram o mesmo resumo do mesmo commit;
- publish-guard mantém seus gates reais e não ganha deadlock circular;
- JSON anterior permanece compatível;
- testes negativos cobrem todos os contraexemplos.

---

## 11. Sprint 52.4 — Cutover incremental do Golden Path

Executar em três branches sequenciais. Não combinar.

### 52.4A — Review e Acceptance

- conectar reviewer independente advisory;
- verifier determinístico decide;
- resolver aceites do Product Brief;
- `pending_verifier` bloqueia entrega, não criação/checkpoint;
- backend sem UI não exige preview;
- projeto com UI exige jornada e a11y aplicáveis;
- remover testes que preservam os gaps somente depois dos novos testes falharem
  no código antigo.

### 52.4B — Runtime, Observe/Repair e Preview

- conectar `runtime-repair-cycle.js` ao pipeline;
- cap de tentativas obrigatório;
- não repetir a mesma correção/diff;
- backoff apenas para falha transitória;
- auth, schema, policy e teste determinístico não são retry automático;
- preview saudável bloqueia entrega quando aplicável;
- reparo esgotado produz checkpoint/handoff.

### 52.4C — Proof, Closeout e Status

- proof real obrigatório para intenção de entrega/publicação;
- consulta, planejamento e dry-run não executam proof;
- closeout usa o mesmo proof, não resultado derivado de verify;
- status público passa a `delivered|checkpoint_ready|blocked`;
- status legado permanece uma versão em compatibilidade, marcado deprecated;
- remover status legado somente após telemetria local/testes mostrarem zero
  consumidor interno.

### DoD do cutover

- nenhum `delivered` sem aceites, preview aplicável e proof;
- JSON e texto derivam do mesmo objeto;
- rollback para shadow mode testado;
- E2E terminal de `start` verde;
- nenhuma pergunta irrelevante adicionada.

---

## 12. Sprint 52.5 — Manual-to-Core seletivo

**Objetivo:** o produto guiar corretamente sem exigir leitura dos manuais e sem
converter 50 módulos em funcionalidades.

### Registry de práticas

`engineering-practices.js` deve declarar, para cada prática:

```json
{
  "id": "data-recovery",
  "treatment": "core | conditional_question | conditional_recipe | consult_only",
  "triggers": ["production", "persistent_data", "regulated"],
  "questions": ["rpo", "rto"],
  "outputs": ["brief.nonFunctional.recovery"],
  "gates": ["backup-restore-proof"],
  "appliesTo": ["saas", "api", "data"],
  "exclusions": ["static-site"]
}
```

### Core obrigatório

- objetivo e critérios de aceite;
- plano e rollback;
- isolamento;
- estratégia de testes;
- segurança/secrets;
- migração e backup quando há dados persistentes;
- acessibilidade quando há UI;
- health/logs quando há runtime;
- observabilidade mínima quando há produção;
- proof e closeout.

### Perguntas condicionais

- design system: quando há UI;
- autenticação/tenancy: quando há usuário/dados privados;
- deploy: quando há intenção de entrega;
- escala/SLO: quando há produção ou volume declarado;
- RTO/RPO: quando há dado crítico/persistente;
- compliance: quando domínio regulado;
- custo/modelo: quando há IA ou provider externo.

### Recipes condicionais

- idempotência/outbox: side effects externos ou processamento assíncrono;
- saga: transação real entre múltiplos serviços;
- CQRS: assimetria comprovada de leitura/escrita;
- microsserviços: ownership, escala ou isolamento de deploy comprovados;
- multitenancy/RLS: SaaS multi-tenant;
- canary: produção com risco compatível.

### Consult-only

- teoria geral;
- comparações educacionais;
- padrões avançados sem trigger;
- módulos que não alteram decisão do projeto atual.

### Contraexemplos

- landing page estática não pergunta saga, RTO/RPO ou Kubernetes;
- SaaS com Stripe pergunta idempotência, secrets, tenancy, backup e rollback;
- API interna sem UI não exige design system;
- brownfield não troca arquitetura sem decisão explícita;
- “quero microsserviços” sem requisito produz recomendação e trade-off, não
  adoção automática.

### DoD

- matriz coberta por testes;
- perguntas só aparecem por trigger;
- planner registra razão da prática aplicada;
- manual nunca é carregado integralmente no prompt;
- cada gate do registry aponta para implementação real ou fica
  `consult_only`, nunca fictício.

---

## 13. Sprint 52.6 — Contexto, Graphify e closeout transacionais

**Objetivo:** a próxima sessão encontrar o estado final sem transcript inteiro.

### Implementação

- closeout executa refresh bounded;
- falha de refresh deixa `fresh:false`;
- Context DB indexa PRD49–PRD52 e manuais atuais;
- documentos locais têm prioridade sobre mirrors externos;
- filtros por origem, tipo e recência;
- deduplicação por hash;
- Graphify registra versão, input tree hash e commit de origem;
- Graphify `unknown` nunca vira fresh;
- Context Delta contém apenas decisões, diff, gates, bloqueios e próximo passo;
- toda afirmação derivada registra `sourceClass` (`primary_source|secondary_source`), `primaryRefs` e hashes quando disponíveis;
- resumo, memória, mirror ou índice são fonte secundária: ajudam a localizar, mas nunca substituem a fonte primária para decisão, autorização, claim ou gate;
- Headroom só informa economia com proxy, routing e tráfego comprovados.

### Evitar ciclo de freshness

Artefato gerado após commit não deve exigir outro commit infinito. A prova deve
usar:

- `sourceCommit` do código indexado;
- `sourceTreeHash` dos inputs relevantes;
- artefatos gerados ignorados ou armazenados como evidence do run;
- comparação explícita com HEAD antes de reutilizar.

### Contraprovas

- PRD atual ausente;
- mirror externo vence decisão local;
- grafo de commit antigo;
- closeout parcial chamado fresh;
- banco corrompido;
- Headroom instalado, mas sem proxy;
- nova sessão recebe secret ou transcript completo.

---

## 14. Sprint 52.7 — Firewall, CLI, typecheck e Manifest V2

**Objetivo:** reduzir divergência de contratos antes do RC.

### Command registry único

Criar `src/meta/command-registry.js` como fonte de:

- handler;
- alias;
- subcomandos;
- help;
- flags;
- efeitos;
- consentimento;
- JSON schema;
- camada.

Efeitos:

- `read`;
- `write_project_state`;
- `write_project_config`;
- `network`;
- `execute`;
- `secret_access`;
- `global_write`.

Corrigir:

- `plan run`;
- `visual hooks install`;
- `research --repo`;
- `research`/`pp` no help;
- `context status --db --json`;
- paridade dispatch/help/layer.

### Typecheck

- `typecheck` passa a executar `tsc --noEmit -p jsconfig.json`;
- syntaxcheck mantém parser ESM separado;
- verify usa typecheck real;
- teste negativo introduz erro JSDoc e exige release bloqueado.

### Runtime Manifest

Para o lançamento, manter **V2 como contrato canônico**. Não promover V3 junto
ao Golden Path.

- remover claim de V3 entregue;
- isolar código/migração V3 como experimento não exportado ou removê-lo;
- rejeitar manifest desconhecido, nunca reduzir V3 silenciosamente para V2;
- criar ADR para evolução posterior.

Essa decisão reduz risco de migração antes do lançamento.

---

## 15. Sprint 52.8 — Residuais que afetam o usuário

Entram:

- intake guiado de harness/modelo;
- auth/modelo `unknown` nunca fabricado;
- policy decision presenter no `start`;
- uma única próxima ação segura por falha;
- minimality gate ligado ao planner/reviewer;
- design intake e a11y para UI;
- uninstall/restore de projeções de hooks;
- enforcement real/advisory visível;
- atualização do `projetogstack.md`.

Não bloqueiam o lançamento core:

- NotebookLM;
- Defuddle;
- mídia generativa;
- Scroll World com provider externo;
- tradução integral da CLI;
- GUI;
- novos harnesses;
- novos agentes;
- Headroom roteado por padrão.

Esses itens devem aparecer como experimentais, opt-in ou non-goal.

---

## 16. Sprint 52.9 — Golden E2E de fechamento

**Objetivo:** provar a jornada do usuário com o tarball real, não com imports
internos.

### 16.1 Cenário offline determinístico obrigatório

Em VM limpa:

1. `npm pack`;
2. instalar o TGZ com prefix/home temporários;
3. snapshot byte a byte de configs de harness;
4. executar `start` com fixture de intenção:
   `SaaS com login, cobrança e painel admin`;
5. responder intake por stdin/fixture versionada;
6. criar app com providers locais/fakes declarados;
7. subir runtime;
8. executar navegador real;
9. testar:
   - login;
   - autorização;
   - painel;
   - webhook duplicado/idempotente;
   - validação de input;
   - viewport mobile;
   - acessibilidade;
   - console sem erro;
   - rede sem 5xx;
10. executar review, verify, acceptance e proof;
11. confirmar `delivered`;
12. gerar Context Delta;
13. parar runtime;
14. provar zero PID/porta/log/diretório;
15. executar uninstall/restore;
16. comparar configs byte a byte;
17. salvar evidence pack.

O teste offline não pode afirmar que Stripe/Supabase reais foram validados.

### 16.2 Canary credentialed

Job separado, manual/noturno, com secrets do CI:

- Stripe test mode;
- provider de auth suportado;
- deploy de preview suportado;
- webhook real;
- rollback.

Falha do canary impede claim da integração, mas não falsifica o E2E offline.

### 16.3 Brownfield

Fixture com:

- Git dirty;
- `opencode.jsonc` com providers/modelos;
- config Claude/Codex existente;
- package manager diferente;
- porta ocupada;
- arquivo local modificado após instalação.

O GStack deve:

- diagnosticar;
- não sobrescrever;
- pedir decisão proporcional;
- manter dirty changes;
- restaurar byte a byte no uninstall.

### 16.4 Matriz

- Windows 11;
- Ubuntu LTS;
- macOS atual do runner;
- Node 18, 20, 22 e 24 enquanto suportado;
- Lite;
- Full;
- ferramenta opcional ausente;
- rede indisponível;
- shell/harness restrito.

### Evidence pack

```text
.gstack/release-candidate/<commit>/
  manifest.json
  tarball.json
  proof.json
  baseline.json
  runtime-soak.json
  start-run.json
  acceptance.json
  browser/
  hook-topology.json
  protocol-channels.json
  clean-machine-runbook.md
  security/
  install-impact.json
  uninstall-restore.json
  context-delta.json
  sbom.cdx.json
  provenance.intoto.jsonl
  checksums.txt
```

Cada arquivo deve registrar schema, commit, SO, Node, timestamp e hash.

O runbook de máquina externa é projeção operacional versionada: define preparação,
canários, evidências esperadas, restore e retomada, mas não é skill, autorização ou
proof. Somente receipts produzidos pela execução externa entram como evidência.

---

## 17. Sprint 52.10 — RC e lançamento

### RC

1. congelar código;
2. atualizar Context/Graphify;
3. gerar TGZ;
4. calcular hash;
5. rodar Sprint 52.9 com esse TGZ;
6. executar três suítes completas em máquina fria;
7. executar QG 1–3;
8. executar `verify --profile full`;
9. executar `proof --profile full`;
10. revisar evidence pack por humano e reviewer independente;
11. publicar como prerelease/dist-tag `next`;
12. instalar do registry e comparar hash/conteúdo;
13. repetir smoke de instalação, runtime e uninstall.

### Promoção para latest

Só promover quando:

- quatro estados obrigatórios forem `true`;
- zero P0/P1 conhecido;
- CI cross-OS verde;
- soak zero flake;
- golden E2E verde;
- rollback verde;
- configs globais preservadas;
- claims e docs derivadas da prova;
- token de publicação de curta duração;
- GitHub Release formal criada com SBOM, checksums e limitações.

Se o pós-publish falhar:

- deprecar a versão;
- restaurar `latest` para a última versão comprovada quando permitido;
- publicar incidente;
- não chamar hotfix de concluído antes da nova certificação.

---

## 18. Gates finais

### Comandos mínimos

```powershell
npm run lint
npm run lint:commands
npm run typecheck
npm run typecheck:ts
npm run agents:check
npm run test
npm run test:py
npm run coverage:ci
npm run test:e2e
npm run test:e2e:terminal
npm run test:e2e:lifecycle
npm run test:e2e:package
npm run test:cleanmachine
node scripts/runtime-soak.mjs
node src/index.js dream audit --json
node src/index.js tools readiness --json
node src/index.js verify --profile full --json
node src/index.js proof --profile full --json
```

Se `test:cleanmachine` não existir com esse nome, usar o script canônico
`npm run test:cleanmachine` já presente no `package.json`; command-lint deve
falhar caso o nome documentado não exista.

### QG

```powershell
python ~/.codex/hooks/qg.py --path . --level 1 --strict
python ~/.codex/hooks/qg.py --path . --level 2 --strict
python ~/.codex/hooks/qg.py --path . --level 3 --strict
```

### Verificação de resíduos

- processos pertencentes ao run: zero;
- portas pertencentes ao run: zero;
- logs bloqueados: zero;
- diretórios temporários do run: zero;
- worktrees não encerradas: zero;
- config global alterada sem ownership: zero;
- secrets em evidence/context: zero.

---

## 19. Definition of Done do produto

- [ ] token exposto revogado;
- [ ] runtime funciona no Codex restrito e shell normal;
- [ ] 60/60 runtime soak sem resíduo;
- [ ] baseline governa proof/publish/closeout;
- [ ] scoreboard possui commit real;
- [ ] Golden Path governa `start`;
- [ ] únicos estados finais são delivered/checkpoint_ready/blocked;
- [ ] manual-to-core pergunta apenas o necessário;
- [ ] landing page não recebe perguntas corporativas irrelevantes;
- [ ] SaaS recebe segurança, idempotência, tenancy, backup e rollback;
- [ ] Context Delta representa o HEAD;
- [ ] PRD49–PRD52 são encontráveis no índice;
- [ ] Graphify possui provenance verificável;
- [ ] Headroom não alega economia sem tráfego;
- [ ] firewall classifica por operação;
- [ ] help, dispatch e JSON possuem fonte única;
- [ ] typecheck real bloqueia release;
- [ ] Runtime Manifest V2 é a única verdade do lançamento;
- [ ] Golden E2E do TGZ passa nos três SOs;
- [ ] brownfield preserva configs e dirty tree;
- [ ] uninstall restaura byte a byte;
- [ ] pacote do registry corresponde ao TGZ certificado;
- [ ] quatro estados estão verdadeiros;
- [ ] zero P0/P1 conhecido;
- [ ] GitHub Release formal publicada;
- [ ] README e manual descrevem exatamente o que foi provado.

---

## 20. Critério de sucesso do usuário

O produto só está fechado quando, em máquina limpa, um usuário puder dizer:

> Quero criar um SaaS com login, cobrança e painel admin.

E o GStack:

1. fizer apenas perguntas justificadas;
2. declarar efeitos, custo e rollback;
3. executar isolado;
4. criar e subir o app;
5. observar e reparar dentro do cap;
6. testar backend, UI, segurança e acessibilidade;
7. mostrar preview funcional;
8. provar critérios de aceite;
9. salvar contexto mínimo para retomada;
10. parar sem resíduos;
11. restaurar configurações no uninstall;
12. responder `delivered`, `checkpoint_ready` ou `blocked` com evidência do
    mesmo commit.

Até essa jornada passar usando o pacote real, o produto pode ser descrito como
promissor e tecnicamente forte, mas não como concluído ou livre de defeitos no
escopo suportado.

---

## 21. Ordem obrigatória

1. 52.0 — revogação do token em paralelo e checkpoint da baseline;
2. 52.1 — matriz pré-publicação no commit `5b14fa0`;
3. checkpoint humano: publicar a baseline corretiva somente se 52.0 e 52.1
   estiverem verdes, sem incorporar o cutover estrutural;
4. 52.2 — shadow Golden Run, correspondente ao Sprint 51.2;
5. 52.3 — ledger unificado, correspondente ao Sprint 51.3;
6. 52.4A — review/acceptance;
7. 52.4B — runtime/repair/preview;
8. 52.4C — proof/closeout/status;
9. 52.5 — manual-to-core;
10. 52.6 — contexto/freshness;
11. 52.7 — firewall/CLI/typecheck/manifest;
12. 52.8 — residuais de jornada;
13. 52.9 — certificação E2E;
14. 52.10 — RC e lançamento.

Nenhum sprint pode ser pulado por já existir um módulo com nome semelhante. A
evidência precisa provar o wiring e a jornada correspondente.


---

## 22. Calibração normativa — Sprint 51.6, claims executáveis e Agno

> Esta seção é obrigatória e complementa os Sprints 52.2, 52.4, 52.6, 52.7,
> 52.9 e 52.10. Em conflito com texto anterior sobre prova de capability, esta
> seção prevalece. Ela não autoriza modificar o WIP do Sprint 51.6 fora da
> sequência já aprovada.

### 22.1 Decisão sobre as 20 capabilities do Sprint 51.6

A direção “escrever contratos para as capabilities prontas” é aceita com uma
correção essencial: preencher `CLAIM_CONTRACTS` não constitui prova. No estado
auditado, `hasBehavioralContract()` verifica somente quatro strings não vazias.
Assim, um contrato declarativo pode promover uma capability para `REAL` sem
executar o E2E, sem disparar a contraprova e sem validar freshness.

A contagem “15 prontas / 5 com gap” é um snapshot, não uma constante do produto.
O placar deve ser derivado do runner no commit. Contratos escritos no Sprint
51.6 entram como `contract_candidate` até produzirem receipt executado.

### 22.2 Claim Contract executável em 52.2 shadow mode

Implementar runner allowlisted. Nunca executar shell arbitrário vindo do
registry.

```text
ClaimContract
  claimId, schemaVersion, contractVersion, riskTier
  evidenceAdapterId, scenarioIds[], negativeControlIds[]
  freshnessPolicy, requiredProfiles[], sourceCommit

ClaimReceipt
  claimId, contractHash, sourceCommit, sourceTreeHash
  scenarioResults[], negativeControlResults[]
  startedAt, completedAt, status
  evidenceRefs[], environmentRef, toolchainRef
```

Cada `evidenceRef` declara:

```text
evidenceKind: automated_check | automated_review | human_review
authority: authoritative | advisory | attestation
producer, schemaVersion, contentHash, sourceRefs[]
```

`automated_check` só é `authoritative` com adapter e oráculo determinísticos
registrados. Revisão por modelo permanece `advisory`; revisão humana atesta a
decisão, mas não substitui checks exigidos. Campo ausente, combinação incompatível
ou fonte secundária sem referência primária torna o receipt inválido.

Estados:

```text
passed | failed | stale | not_run | invalid
```

Regras:

- `e2eCommand` é texto diagnóstico; não é autoridade executável;
- adapters, cenários e controles negativos são IDs registrados em código;
- `REAL` exige receipt `passed` do mesmo contrato, commit, tree, perfil e
  toolchain;
- timeout, fixture ausente, `not_run`, `invalid`, `stale` ou controle negativo
  que não falha mantêm `NOT_PROVED`;
- sabotagem, remoção ou desvio da capability deve quebrar a contraprova;
- proof e docs usam receipts vivos, não a existência dos quatro campos;
- no shadow mode, divergência é registrada sem mudar ainda a saída pública.

### 22.3 ApprovalLease: contrato pertencente ao PRD52

O PRD53 consome ApprovalLease e o PRD54 depende dela. Portanto, o contrato nasce
neste PRD:

```text
requested -> pending -> approved|rejected|expired|revoked
approved -> consumed
```

Campos mínimos:

```text
leaseId, nonce, actorId, runId, parentRunId, planHash, scopeHash, policyHash,
worktreeId, budgetRef, allowedPaths, allowedTools, allowedCommands,
networkPolicy, expectedVersion, expectedStatus, issuedAt, expiresAt
```

- 52.2 gera e compara leases em shadow mode;
- 52.4 aplica enforcement antes de efeitos;
- resolução usa `expectedVersion` e `expectedStatus`;
- replay e consumo duplicado são idempotentes e não repetem efeitos;
- audit receipt nunca equivale a autorização;
- mudança de plano, escopo, policy, worktree ou budget exige nova lease;
- banco/journal indisponível bloqueia ação P0/P1;
- `--yes` genérico não autoriza efeito irreversível.

### 22.4 Disposição das cinco capabilities com gap funcional

| Capability | Gap real | Fechamento obrigatório |
|---|---|---|
| `qa-multi-lens` | scanner regex dos arquivos mudados; falta prova dentro do Golden Run, provenance e efeitos | 52.4A/B e PRD53 53.3 |
| `vfa-provenance` | hash-chain local não é assinatura imutável; cadeia vazia passa; append/index concorrentes não são serializados; produtores fazem best-effort | 52.4C, PRD53 53.3 e PRD54 54.1 |
| `challenge-response` | hook enforced falha aberto com CLI ausente ou JSON inválido; instrucional é apenas posthoc | 52.4A, PRD53 53.3/53.4 e PRD54 54.2 |
| `meta-harness` | dependência desconhecida permissiva, ciclo degradado para sequência, gate default verde, gate CLI limitado a diff-hygiene e cleanup incompleto em exceção | 52.4A/B, PRD53 53.4 e PRD54 54.1/54.4 |
| `type-coverage` | `checkJs:false`, `strict:false`; coverage agregado não prova contratos críticos/options-bags | 52.7 e PRD53 53.3 |

Nenhuma delas vira `REAL` apenas porque recebeu metadados no Sprint 51.6. Até o
fechamento, permanece `NOT_PROVED` ou recebe claim pública reduzida exatamente ao
comportamento já comprovado.

### 22.5 Wiring obrigatório nos sprints existentes

**52.4A — Review/Acceptance**

- aplicar ApprovalLease após shadow;
- P0/P1 enforced falha fechado com CLI/policy/lease ausente, ilegível ou stale;
- harness instrucional continua `posthoc_audit_only`, nunca `enforced`;
- QA Multi-Lens participa do gate do mesmo run, mas não prova qualidade sozinho.

**52.4B — Runtime/Repair**

- orquestrar somente DAG com IDs únicos, dependências existentes e sem ciclos;
- gate do passo usa perfil real de testes/Fallow/QG/diff-hygiene, nunca default
  verde;
- erro, cancelamento e timeout fazem cleanup em `finally`;
- worktree, processo, porta, handle e branch residuais falham o run.

**52.4C — Proof/Closeout**

- proof executa Claim Contracts exigidos pelo perfil;
- provenance obrigatória falha fechado quando ausente, vazia após efeitos,
  bifurcada, truncada ou inválida;
- `REAL` referencia ClaimReceipt fresco do mesmo commit.

**52.6 — Contexto/freshness**

A auditoria desta rodada executou `context search` e encontrou
`sqlite3.OperationalError: no such column: d.duplicate_of`. O sprint deve:

- testar consulta real contra banco migrado, não apenas existência do arquivo;
- retornar `failed_schema`, nunca `callable`, para mismatch de schema;
- migrar ou reconstruir de modo transacional e reexecutar a consulta;
- invalidar readiness/freshness até a prova passar.

**52.7 — Type coverage**

- ativação incremental de `checkJs`/strict por módulos core;
- manifest explícito de arquivos incluídos/excluídos;
- zero `@ts-ignore` novo sem waiver tipado e expirável;
- coverage por contratos críticos além do percentual agregado.

**52.9/52.10 — Certificação**

O evidence pack inclui `claim-receipts/` e `approval-leases/`. A promoção exige:

- zero capability core/release promovida só por metadado;
- as cinco capabilities comprovadas ou publicamente rebaixadas;
- receipts positivos, contraprovas e freshness do TGZ/commit certificado;
- nenhum placar hardcoded.

### 22.6 Referência Agno: adaptar contratos, não integrar runtime

Referência auditada: <https://github.com/agno-agi/agno>, commit
`21de30f323f4ceaf07a429cb2be9bea236643a9d`, licença Apache-2.0.

Adaptar:

- eventos tipados e linhagem `runId/parentRunId/sessionId`;
- aprovação resolvida por estado/versão esperados;
- cancelamento idempotente e hierárquico;
- scorers reproduzíveis e métricas de chamadas auxiliares.

Não importar Agno, AgentOS, FastAPI, UI, telemetria default, scheduler, canais ou
workflow engine. O GStack mantém um único control plane local.

### 22.7 DoD adicional

- Claim Contract declarativo sem receipt continua `NOT_PROVED`;
- controle negativo declarado, mas não executado, não conta;
- ApprovalLease é provada em shadow e depois enforced sem fail-open P0/P1;
- Context DB executa busca real após migração;
- cada uma das cinco capabilities possui owner, sprint, cenário positivo,
  contraprova e critério de freshness;
- proof, Dream Audit e documentação derivam do mesmo receipt set.
---

## 23. Calibração normativa — continuidade, escopo aprovado e maturidade

> Esta seção complementa 52.2, 52.4, 52.9 e 52.10. Em conflito com linguagem
> anterior sobre continuidade, maturidade ou reaprovação, esta seção prevalece.

### 23.1 ApprovalLease cobre a execução, não apenas o primeiro efeito

Uma ApprovalLease válida autoriza a continuidade automática de todos os passos
reversíveis e já descritos por `planHash + scopeHash + policyHash`, até um gate
humano, risco novo, mudança de escopo, expiração ou revogação.

- skill, hook, subagente ou troca de harness não reabre decisão confirmada;
- recomendação P2 já coberta pelo plano não cria nova pausa;
- correção necessária para cumprir o DoD permanece na lease quando não amplia
  arquivos, ferramentas, efeitos externos, custo, risco ou requisitos;
- mudança de fornecedor, autenticação, compliance, migração destrutiva, efeito
  externo, escopo ou risk tier exige addendum e nova lease;
- `continue`, `siga` ou equivalente nunca aprova plano novo, lease ausente ou
  efeito P0/irreversível;
- uma pausa sem `PendingRequirement` acionável ou falha técnica comprovada é
  defeito do Golden Run.

### 23.2 Estado do run e maturidade da entrega são eixos diferentes

```text
runStatus:
  running | checkpoint_ready | blocked | delivered | cancelled

deliveryMaturity:
  prototype | demo_ready | workflow_ready | production_ready
```

Semântica mínima:

- `prototype`: artefato parcial, sem jornada comprovada;
- `demo_ready`: UI/CLI navegável com dados controlados; efeitos reais podem não
  estar conectados;
- `workflow_ready`: jornada principal, persistência, autorização, erros,
  auditoria e rollback aplicáveis passaram em E2E;
- `production_ready`: `workflow_ready` mais segurança, operação, deploy,
  observabilidade, recuperação e proof de release do mesmo commit.

`delivered` significa que o escopo aprovado terminou; não implica
`production_ready`. Build verde, HTTP 200 ou actions isoladas não promovem uma
UI estática para `workflow_ready`.

### 23.3 Prova de preview e interação

Para UI:

- HTTP 200 prova somente disponibilidade da rota;
- build prova compilação, não experiência visual;
- `demo_ready` exige rota saudável e conteúdo coerente com as claims;
- `workflow_ready` exige navegador executável, jornada E2E, console/rede,
  responsividade, acessibilidade aplicável e efeitos reais verificados;
- pacote Playwright instalado sem browser executável produz `not_run`, nunca
  `passed`;
- browser indisponível deve gerar pergunta explícita de instalação quando a
  policy permitir, ou claim reduzida quando o usuário responder não.

### 23.4 DoD adicional

- proof e closeout mostram `runStatus` e `deliveryMaturity` separadamente;
- badge/copy de produto não excede a maturidade comprovada;
- nenhuma skill reabre decisão coberta por lease fresca;
- `continue` não promove `pending` para `approved`;
- Golden E2E inclui pausa legítima, continuidade automática dentro da lease,
  mudança de escopo e expiração/revogação;
- evidence pack registra a prova usada para cada promoção de maturidade.
## 24. Addendum normativo - Certificacao real de instalacao e upgrade

Este addendum deriva de um caso observado no qual o instalador registrou download,
instalacao e reinicio, mas o processo iniciado continuou reportando a versao
anterior. Para o GStack, iniciar uma instalacao nao prova que o pacote novo esta
em execucao.

### 24.1 Limite arquitetural

O GStack continua sendo uma CLI distribuida por pacote. Este PRD nao cria
auto-updater desktop, daemon residente, atualizacao silenciosa ou catalogo remoto
novo. A certificacao cobre:

- instalacao limpa do tarball produzido pelo pipeline;
- upgrade explicito de uma versao suportada para a candidata;
- downgrade/rollback suportado;
- execucao real da CLI instalada;
- paridade entre pacote, registry, tag, changelog e runtime.

### 24.2 Estado transacional da operacao

O evidence pack de instalacao/upgrade deve registrar, sem secrets:

```json
{
  "schemaVersion": "gstack.package-transition.v1",
  "currentVersion": "x.y.z",
  "targetVersion": "x.y.z",
  "packageHash": "sha256:...",
  "operation": "install|upgrade|rollback",
  "status": "downloaded|installing|applied|rolled_back|failed",
  "observedVersion": "x.y.z",
  "restartObserved": true,
  "rollbackReason": null,
  "proofRef": "path-or-hash"
}
```

O estado `applied` exige que um processo novo, iniciado depois da transicao,
reporte `observedVersion == targetVersion`. Exit code zero do instalador,
arquivo baixado ou reinicio solicitado nao satisfazem essa condicao.

### 24.3 Golden E2E de pacote

O Sprint de certificacao deve executar, nos sistemas operacionais suportados:

1. `npm pack` do commit candidato;
2. instalacao do tarball em perfil limpo e efemero;
3. execucao de `--version`, `doctor`, `verify` e `proof`;
4. criacao de fixture com configuracao e projeto preservaveis;
5. upgrade N -> N+1;
6. novo processo confirma a versao N+1;
7. configs e projeto permanecem byte-for-byte quando nao pertencem ao GStack;
8. rollback N+1 -> N quando suportado;
9. novo processo confirma N e executa o proof de rollback;
10. cleanup comprova ausencia de processo, porta ou instalador orfao.
11. enumeracao das fontes de configuracao e registro de hooks antes e depois
    de install, upgrade e uninstall;
12. canarios independentes comprovam descoberta, invocacao, multiplicidade,
    ownership, remocao e restore dos hooks;
13. comandos JSON e servidores MCP comprovam stdout protocolar puro, payload
    ausente de stderr e controles negativos para contaminacao, ANSI e documentos
    duplicados.

O proof da transicao deve ser produzido pelo artefato observado depois da
instalacao. Um processo da versao antiga nao pode certificar sua propria
substituicao.

### 24.4 Paridade de release

Antes de publicar, o pipeline compara:

- `package.json`;
- metadata do tarball;
- resposta do registry usada no teste;
- tag Git;
- entrada de changelog/release;
- `gstack_vibehard --version`;
- schema/evidence pack de release.

Qualquer divergencia gera `release_metadata_mismatch` e bloqueia publicacao.
Falha de rede gera `not_run` ou `inconclusive`; nunca reutiliza silenciosamente
metadata de outra versao.

### 24.5 Estados e controles negativos

Estados adicionais de diagnostico:

- `downloaded_not_applied`;
- `version_mismatch`;
- `rollback_failed`;
- `release_metadata_mismatch`;
- `stale_registry_cache`.

Controles obrigatorios:

- instalador retorna zero, mas runtime continua em N;
- pacote N+1 contem metadata N;
- restart abre processo antigo;
- proof foi gerado antes da transicao;
- rollback restaura binario, mas nao restaura config governada;
- cache do registry pertence a outra versao;
- update falha e remove provider/modelo/config do usuario.
- hook esta presente, mas nao e descoberto ou invocado;
- o mesmo hook executa mais de uma vez para um unico evento;
- uninstall deixa referencias quebradas ou remove hook de ownership externo;
- banner, ANSI, dois documentos ou texto humano contaminam stdout JSON/MCP;
- payload protocolar aparece ou e duplicado em stderr.

Nenhum desses cenarios pode resultar em `ready`, `applied` ou
`production_ready`.
