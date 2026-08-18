# PRD54 — Manager-First Operational Shell

> **Para agentes executores:** este programa começa somente depois do PRD53
> concluído e certificado. Ele cria uma camada operacional sobre componentes já
> existentes. Não reimplementar Golden Run, State Store, journals, worktrees,
> checkpoints, skills, gates, verify, proof ou runtime.

**Goal:** transformar o GStack em uma experiência terminal-first coerente para
iniciante, desenvolvedor e power user: o usuário declara intenção, aprova um
plano compreensível e acompanha tarefas, agentes, evidências, preview e decisões
sem conhecer dezenas de comandos internos.

**Resultado de produto:** uma missão possui um Manager, um grafo canônico de
tarefas, capability set, ApprovalLease, worktrees isoladas, contexto incremental,
mensagens/clarificações, checkpoints e um veredito final derivado de gates do
mesmo run.

**Baseline de autoria:** auditoria point-in-time da v5.67.0, commit `70e92a4`.
O Sprint 54.0 deve substituir esse baseline pelo commit certificado que concluir
o PRD53.

**Status:** PRD aprovado para planejamento. Nada neste documento está
implicitamente implementado.

---

## 1. Decisão central

O GStack já possui a maior parte dos motores necessários. O gap não é adicionar
outro agente ou copiar um concorrente. O gap é um shell operacional único que:

1. transforma intenção em plano e tarefas;
2. exige aprovação antes de efeitos;
3. distribui trabalho com isolamento e budget;
4. mostra somente decisões humanas relevantes;
5. mantém contexto mínimo entre etapas e sessões;
6. comprova runtime, qualidade e entrega;
7. permite parar, retomar, revisar e restaurar.

O Manager é uma camada de coordenação e apresentação. Gates determinísticos
continuam sendo a autoridade. LLMs continuam sendo executores/revisores
probabilísticos, nunca a fonte final de `done`.

---

## 2. Critérios de entrada e hard blockers

O Sprint 54.0 retorna `blocked` se qualquer item abaixo não estiver provado no
mesmo commit:

- PRD52 e PRD53 concluídos, com evidence packs rastreados;
- `start` e `plan run` convergem para o mesmo Golden Run;
- State Store, Session Index, journals, Context Delta e checkpoints estáveis;
- ApprovalLease e capability sets comportamentalmente comprovados;
- skill lifecycle `selected -> loaded -> applied -> verified` operacional;
- worktree obrigatória para executor concorrente;
- `verify --profile full --json` sempre produz relatório final estruturado;
- zero P0/P1 conhecido no escopo suportado;
- pacote real e clean-machine verdes.

### 2.1 P0 obrigatório — lifecycle do runtime Windows

A auditoria reproduziu no Windows:

- `stop` retornando `access_denied`;
- processo sobrevivendo ao supervisor;
- porta e `web.log` permanecendo abertos;
- cleanup terminando em `EBUSY`;
- `runtime_e2e` falhando em dois de quatro cenários, inclusive isoladamente.

Antes de qualquer claim Replit-like, o supervisor precisa possuir ownership real
do processo e encerramento verificável. A implementação pode usar Windows Job
Object, helper supervisor proprietário ou mecanismo equivalente, mas deve provar:

1. shutdown gracioso bounded;
2. encerramento da árvore como fallback;
3. fechamento de stdout/stderr/log/cwd handles;
4. liberação da porta;
5. estado preservado enquanto houver processo vivo;
6. retry idempotente;
7. recuperação após crash do Manager;
8. execução 20x sem processo residual em Windows normal, shell restrito e CI.

`taskkill /T /F` isolado não satisfaz o contrato.

### 2.2 P1 obrigatório — workspace mutável durante runs

Um run não pode observar metade de um merge ou implementação concorrente.
Toda missão fixa `sourceCommit`, `workspaceSnapshotHash` e paths observados.
Mudança externa durante execução produz `workspace_changed` e checkpoint; nunca
resultado verde, JSON vazio ou evidência parcial tratada como conclusão.

---

## 3. Evidências e referências

Fontes internas obrigatórias:

- `.docs/PLANS/prd47.md` — Golden Path e experiência local-first;
- `.docs/PLANS/prd48.md` — UX terminal-first e sessões;
- `.docs/PLANS/prd49.md` — design e mídia governados;
- `.docs/PLANS/prd52.md` — baseline operacional e ApprovalLease;
- `.docs/PLANS/prd53.md` — currículo, skills, rules e conformance;
- `.docs/PLANS/prd53-prd54-calibration-20260727.md`;
- `.docs/PLANS/prd53-prd54-agents-contract-calibration-20260727.md`;
- `.docs/RESEARCH/replit-project-evidence/findings.json`;
- `.docs/RESEARCH/repository-registry.json`.

A auditoria local de `.verdent` é referência comportamental point-in-time sobre
configuração persistida, skills, logs, checkpoints e projeto gerado. Não é
auditoria do código proprietário interno e não autoriza cópia ou dependência.

### 3.1 Conclusão competitiva honesta

- **Replit:** referência superior para runtime, preview, deploy e jornada viva.
- **Verdent:** referência superior para Manager, tarefas, mensagens, aprovação de
  plano, pending requirements e continuidade de sessão.
- **GStack:** referência mais forte em gates determinísticos, provenance,
  rollback, redaction, worktrees e claims cross-harness honestas.

O projeto observado no Verdent não executou sua skill visual, não usou worktree,
não produziu specs Playwright nem preview comprovado. Portanto Manager fluido não
é, sozinho, prova de produto final melhor.

---

## 4. Componentes canônicos — reuse first

| responsabilidade | componente a reutilizar |
|---|---|
| entrada e plano | `src/commands/start.js`, `src/commands/plan.js` |
| execução | `src/project-plan/golden-run.js`, `run-loop.js`, `task-loop.js` |
| tarefas/sessões | `src/state/session-index.js`, `src/state/store.js` |
| journals | `src/project-plan/journal.js`, `src/workflow-graph/journal.js` |
| checkpoints | `src/project-plan/loop-checkpoint.js`, presenter existente |
| worktrees | `src/delegation/worktree.js`, `src/commands/worktree.js` |
| orquestração | `src/meta/orchestrator.js`, `src/commands/orchestrate.js` |
| modelo/budget | `src/model-policy/`, loop budget e token accounting existentes |
| contexto | Context Scout, Context Delta, Graphify/FTS e freshness |
| skills/gates | `src/skills/route.js`, gate registry/matrix/truth |
| evidência | Evidence Ledger, VFA, verify, proof e closeout |
| runtime | runtime manifest, supervisor, preview e logs existentes |
| policies | `.gstack/policy.json`, compiler e adapters de harness |

Arquivo novo exige ADR curto explicando por que nenhum componente acima pode
receber a responsabilidade.

---

## 5. Não objetivos

- GUI desktop/web nesta fase;
- copiar ou instalar Verdent/Replit;
- novo harness proprietário;
- SSH, gateway ou cloud handoff automático;
- MCP/config global silencioso;
- modo `yolo` como default;
- LLM como authority de permissão, segurança ou conclusão;
- transcript integral em texto puro por default;
- auto-commit/auto-merge no checkout principal;
- reimplementar engines existentes;
- esconder falha de runtime, auth, quota, sandbox ou browser como N/A verde.

---

## 6. Jornada por persona

### 6.1 Iniciante

1. executa `gstack_vibehard start`;
2. descreve o produto em linguagem natural;
3. quando faltar contrato adequado, escolhe criar o `AGENTS.md` bootstrap; se o
   contrato já existir, o Manager apenas o valida/reconcilia;
4. escolhe qual primeiro valor quer ver: frontend/preview, scaffold funcional,
   arquitetura/plano, modelo de dados/API ou documentação operacional;
5. responde somente decisões que mudam a solução;
6. recebe plano, riscos, tempo/custo estimado e preview esperado;
7. aprova ou edita;
8. acompanha progresso humano, não logs brutos;
9. responde clarificações bloqueantes;
10. recebe preview, testes e prova final;
11. escolhe continuar, restaurar, publicar ou encerrar.

O iniciante não escolhe manualmente entre 110 skills, 21 agentes, tools ou gates.

### 6.2 Desenvolvedor

Pode inspecionar task graph, diff, worktree, modelo, budget, receipts, gates,
logs e checkpoints. Pode pausar, rerotear, repetir apenas branch falha e assumir
controle sem perder provenance.

### 6.3 Power user/automação

Usa os mesmos contratos via JSON estável, `--strict`, `--non-interactive`, run ID,
idempotency key e exit codes tipados. Nunca existe uma implementação paralela
“só para JSON”.

---

## 7. Arquitetura do Manager

### 7.1 Manager Shell

O Manager é o único entry point recomendado, mas os comandos avançados continuam
existindo. Fluxo canônico:

```text
Intent -> Intake -> Contract Bootstrap/Reconcile -> First Value Decision
       -> Context -> Plan -> Approval -> Task Graph -> Execute
       -> Observe -> Contract Reconcile -> Verify -> Proof
       -> Preview/Checkpoint -> Next Action -> Closeout
```

O Manager nunca edita código. Ele cria tarefas, emite controles e materializa a
visão do estado. Workers executam em worktrees. Verifiers reproduzem evidências.

### 7.2 Task Graph canônico

```json
{
  "schemaVersion": "gstack.task-graph.v1",
  "missionId": "mission-123",
  "sourceCommit": "<sha>",
  "workspaceSnapshotHash": "sha256:<hash>",
  "deliveryPriority": "frontend_preview",
  "decisionRefs": ["artifact://decisions/first-value"],
  "contractRef": "artifact://contracts/agents-md",
  "tasks": [
    {
      "taskId": "frontend-1",
      "parentId": null,
      "dependsOn": [],
      "title": "Implementar dashboard",
      "nodeKind": "implementation",
      "exitCriteriaRef": "artifact://acceptance/frontend-1",
      "status": "planned",
      "riskTier": "P1",
      "ownerRole": "frontend-architect",
      "harness": "claude",
      "model": "<resolved>",
      "effort": "medium",
      "worktreeId": null,
      "budgetRef": "artifact://budget/frontend-1",
      "approvalLeaseRef": null,
      "acceptanceRefs": [],
      "resultSchemaRef": "schema://gstack/task-result/v1",
      "resultRef": null,
      "resultStatus": "absent",
      "evidenceRefs": []
    }
  ]
}
```

Estados permitidos:

```text
planned -> waiting_approval -> ready -> running
running -> blocked|checkpoint_ready|verifying|cancelled
verifying -> passed|failed|inconclusive
passed -> merge_ready -> merged|restored
failed -> retry_ready|handoff|cancelled
```

Transição inválida falha fechado. Parent só conclui quando filhos obrigatórios e
merge barrier estão verdes.

`nodeKind` é `decision|implementation|verification|human`. Nós `decision` e
`human` nunca são despachados como worker; produzem DecisionReceipt ou
PendingRequirement. `dependsOn` continua sendo a única aresta de bloqueio.
`resultStatus=produced` exige resultado validado por `resultSchemaRef`;
`invalid|absent` bloqueia consumidores obrigatórios.

Tracer bullets são fatias verticais pequenas com critério de saída executável;
não autorizam merge nem reduzem gates.

### 7.3 Event Store e read model

State Store/journals continuam append-only. O Manager materializa um read model
reconstruível para consultas rápidas:

- missão e task graph;
- status atual e histórico;
- blockers e clarificações;
- worktrees/processos;
- último checkpoint verde;
- contexto/freshness;
- skills/gates aplicados;
- budget e uso;
- verify/proof/preview.

Read model nunca é autoridade. Divergência com journal/ledger invalida e exige
rebuild.

### 7.4 Message e Control Bus

Contratos mínimos:

```text
Message: messageId, missionId, taskId, from, to, kind, bodyRedacted,
         createdAt, correlationId, evidenceRefs
Control: controlId, action, actorId, targetId, expectedVersion,
         approvalLeaseRef, reason, createdAt
```

Ações:

- `clarify`, `answer`, `skip`;
- `approve_plan`, `edit_plan`, `reject_plan`;
- `pause`, `resume`, `cancel`;
- `retry_failed`, `handoff`;
- `review_response`;
- `restore_checkpoint`;
- `approve_merge`, `reject_merge`.

Controle usa optimistic concurrency por `expectedVersion`. Replay/id duplicado é
idempotente. Mensagem nunca concede autorização por texto livre.

### 7.5 Pending Requirements

Requisito humano pendente é separado de task status:

```text
PendingRequirement:
  requirementId, missionId, taskId, questionId, decisionKey, question
  decisionAffected, riskTier, options, default, blocking, status
  decisionState, sourceMessageId, answerId, requestedAt, resolvedAt
  responseRef, approvalLeaseImpact
```

A UI terminal mostra somente pendências acionáveis. Requisito resolvido não é
perguntado novamente enquanto facts/escopo permanecerem frescos.

Regras adicionais:

- mensagem livre não resolve múltiplos requisitos por proximidade textual;
- cada resposta referencia um `questionId` e produz um `DecisionReceipt`;
- resposta `tudo em pt-BR` resolve apenas `outputLanguage`;
- recomendação do planner permanece `recommended` até confirmação explícita;
- pergunta bloqueante sem resposta mantém somente a etapa afetada em
  `waiting_clarification` ou `checkpoint_ready`;
- perguntas podem ser apresentadas em grupo, mas mantêm binding individual.

### 7.6 Contract Bootstrap e reconciliação

O Manager oferece `AGENTS.md` como contrato operacional inicial quando isso
agrega valor; ele não o impõe em toda tarefa:

| estado | ação |
|---|---|
| greenfield sem contrato | oferecer bootstrap antes do scaffold |
| projeto existente sem contrato | propor contrato derivado de probes para aprovação |
| contrato existente | validar e reconciliar sem substituir silenciosamente |
| tarefa pequena com contrato suficiente | seguir direto, sem cerimônia adicional |

O bootstrap contém somente fatos observados, decisões confirmadas, recomendações
rotuladas e pendências. O arquivo não guarda status de task, budget, mensagens,
lease ou evidência dinâmica. Esses dados permanecem nos contratos tipados,
journals e ledgers.

Após scaffold ou alteração estrutural, o Manager compara contrato e realidade,
executa comandos aplicáveis, remove `[planejado]` somente com prova e apresenta
conflitos materiais ao usuário. Editar `AGENTS.md` manualmente nunca concede
permissão nem altera ApprovalLease.

### 7.7 First Value Gate

Depois do contrato inicial ou de sua validação, o Manager pergunta:

```text
O que você quer ver primeiro?
1. frontend/preview visual
2. scaffold funcional
3. arquitetura/plano
4. modelo de dados/API
5. documentação operacional
```

A resposta confirmada vira `deliveryPriority` no plano, task graph, journal,
Context Delta e handoff. Ela ordena a entrega, mas não reduz segurança, testes,
quality gates ou critérios de produção.

Para `frontend_preview`, o caminho padrão é:

```text
design intake -> primeira tela executável -> runtime -> preview
-> aprovação visual -> expansão de backend/páginas
```

Para as demais prioridades, o Manager entrega o primeiro artefato verificável
correspondente e mantém preview/runtime como requisito posterior quando
aplicável. Default só é permitido quando reversível, P2 e explicitamente
apresentado; caso contrário, a decisão permanece `pending`.

### 7.8 Handoff Envelope cross-harness

Troca entre Claude, Codex, OpenCode ou outro executor suportado preserva:

```text
HandoffEnvelope:
  missionId, taskId, userIntent, deliveryPriority, planHash
  sourceCommit, workspaceSnapshotHash, worktreeId, currentStage
  confirmedDecisionRefs, pendingRequirementRefs, acceptanceRefs
  completedSteps, failedCommand, failureSignature, gateResults
  contextDeltaRef, evidenceRefs, nextRecommendedAction
  sourceRefs, primaryRefs, sourceHashes, contextPressure: measured|estimated|unknown
```

O receptor valida hashes/freshness, retoma do último checkpoint seguro e não
reinicia pelo help genérico. Falha conhecida viaja com comando, assinatura e
hipótese atual para impedir repetição cega. Se o envelope estiver incompleto ou
stale, o sistema retorna `checkpoint_ready` e pede apenas a informação ausente;
nunca exige que o usuário reconstrua toda a missão.

Resumo de handoff é fonte secundária. Claim, autorização, falha e decisão crítica
devem reabrir a referência primária indicada; pointer ausente ou stale torna o
handoff incompleto.

---

## 8. Modos, autorização e isolamento

### 8.1 Capability set

Usar o contrato do PRD53:

- `question|assessment`: read-only;
- `plan`: somente artefatos de plano;
- `execute`: efeitos cobertos pela ApprovalLease.

Mudança de plano/escopo/policy/worktree/budget invalida a lease. `--yes` não
aprova ações P0, deploy, secrets, cloud handoff ou escrita global.

### 8.2 Workspace transacional

Cada worker recebe worktree própria. O Manager registra:

- commit base e snapshot hash;
- paths permitidos;
- branch/worktree;
- lock de tarefa;
- checkpoint anterior;
- diff e commit produzidos;
- resultado dos gates.

É proibido executar worker no checkout principal. O checkout principal pode ser
usado por comandos knowledge/read-only e pelo merge transacional aprovado.

Protótipo é evidência executável opcional para responder uma incerteza nomeada.
Ele roda em worktree/branch isolada e registra:

```text
prototypeRef, questionId, sourceCommit, treeHash, resultRef
```

Protótipo nunca é auto-mergeado nem satisfaz `delivered` por si só.

Se HEAD/path observado mudar fora do run:

1. pausar;
2. registrar `workspace_changed`;
3. invalidar contexto/cache/lease afetados;
4. oferecer rebase/replan/handoff;
5. nunca continuar sobre estado híbrido.

### 8.3 Merge barrier

Merge exige:

- worker finalizado;
- verifier independente;
- diff hygiene;
- gates comuns verdes;
- aceites compliant;
- sem conflito com outra branch;
- approval quando risk tier exigir;
- checkpoint restaurável.

Sem auto-merge por default.

---

## 9. Multiagentes, modelos e budget

### 9.1 Manager, planner, worker e verifier

- Manager coordena e conversa;
- Planner decompõe e gera rubrica/aceites;
- Workers implementam em paralelo somente quando DAG e budget permitem;
- Reviewer LLM é advisory;
- Verifier determinístico decide o gate;
- risco alto exige verifier diferente do executor.

### 9.2 Paralelismo

Antes do fan-out, mostrar:

- tarefas independentes;
- contexto compartilhado por hash;
- worktrees previstas;
- modelos e effort;
- quota observada ou `unknown`;
- budget reservado;
- custo/tempo estimado;
- opção sequencial.

Quota desconhecida nunca é suficiente por decreto. Budget é reservado
atomicamente e não reinicia em retry/resume.

### 9.3 Model routing explicável

O Manager resolve modelo por role/task/risk e mostra:

- modelo/provider escolhido;
- motivo e effort;
- dados que sairão da máquina;
- quota/fallback;
- custo conhecido/estimado/desconhecido;
- consequência de trocar.

Modelo real divergente do route receipt sem fallback registrado falha a tarefa.

---

## 10. Contexto, memória e cache

### 10.1 Context Pack por referência

Cada tarefa recebe somente:

- objetivo e aceite;
- facts/práticas aplicáveis;
- paths/linhas do Scout;
- artefatos por hash;
- diff/checkpoint relevante;
- gotchas deduplicados;
- policy/lease/gates necessários.

Transcript completo não entra. Context Delta e graph freshness pertencem ao
commit/worktree da tarefa.

Cada item referencia `sourceClass`, `primaryRefs` e hashes quando aplicável.
Pressão de contexto é `measured|estimated|unknown`; não há threshold universal.
Handoff ocorre em fronteira natural e preserva checkpoint, decisões e critérios
de saída.

### 10.2 Memória assíncrona

Busca de memória pode ocorrer em background e ser anexada em chamada posterior,
mas somente fatos com provenance/freshness entram no contexto. Sugestão de
memória não altera task, lease ou policy.

### 10.3 Cache affinity

Manter stage/model/provider estável pode melhorar prompt cache, mas policy,
qualidade e quota vencem affinity. Relatórios separam input/output/cache
read/cache create/context avoided. Nenhuma economia é alegada sem baseline.

---

## 11. Skills, rules, gates e design

### 11.1 Ativação explicável

O usuário vê uma síntese:

```text
Ativado: frontend-design
Motivo: nova interface sem design system declarado
Estágio: design
Gate: design-system-gate (blocking)
Estado: selected -> loaded -> applied -> verified
```

O catálogo completo fica oculto por default. `manager inspect --skills` mostra
detalhes técnicos.

### 11.2 Design-first

Para UI greenfield visível:

1. perguntar se existe modelo/design system;
2. importar referência quando autorizada;
3. se não existir, oferecer direções comparáveis;
4. aprovar direção antes da implementação ampla;
5. gerar primeira tela executável e preview cedo;
6. validar responsividade, console, rede, a11y e segurança visual;
7. continuar para páginas/backend apenas após checkpoint.

Essa seção apenas conecta PRD47/49 e gates existentes. Não cria novo design
engine. Skill instalada mas não aplicada é falha observável.

### 11.3 Next Action

Após checkpoint/closeout, oferecer no máximo três ações policy-aware. Podem ser
determinísticas ou produzidas por modelo barato, mas:

- nunca executam automaticamente;
- não ampliam escopo sem nova lease;
- não repetem requisito resolvido;
- mostram consequência e custo;
- são redigidas antes de persistir.

---

## 12. Runtime, preview e observabilidade

Manager só declara preview quando:

- runtime manifest válido e confiado;
- processo pertence ao supervisor;
- readiness responde;
- porta está registrada;
- visual gate aplicável foi executado;
- URL e status pertencem ao mesmo run.

Estados: `starting|ready|unhealthy|stopping|stopped|blocked|orphaned`.

Notificações ao usuário somente para:

- aprovação/clarificação necessária;
- bloqueio/falha;
- preview pronto;
- conclusão comprovada;
- restore/rollback.

LSP, console, rede e health são feedback rápido/advisory. Verify/proof continuam
a autoridade de entrega.

---

## 13. Privacidade, trace e retenção

Default:

- eventos mínimos, redigidos e project-scoped;
- hashes em vez de prompts/artefatos completos;
- nenhuma leitura de `.env*`;
- transcript não vira memória;
- nenhum upload sem consentimento.

Modo debug opt-in pode guardar trace completo somente com:

- aviso de dados;
- criptografia local;
- TTL e tamanho máximos;
- exclusão verificável;
- secret canary;
- export controlado;
- referência no evidence ledger.

Logs, screenshots, DOM, tool results e mensagens passam pela mesma redaction.

---

## 14. Superfície CLI e JSON

Proposta de camada fina, sujeita a command parity antes de estabilizar:

```text
gstack_vibehard start
gstack_vibehard task inbox [--json]
gstack_vibehard task inspect <id> [--json]
gstack_vibehard task message <id> --text <texto>
gstack_vibehard task approve <id> --expected-version <n>
gstack_vibehard task pause|resume|cancel <id>
gstack_vibehard task retry <id> --failed-only
gstack_vibehard task checkpoints <id> [--json]
gstack_vibehard task restore <id> --checkpoint <n>
```

Comandos existentes permanecem. Aliases/slash commands apenas chamam esses
contratos; não criam outro motor.

Todo `--json`:

- stdout JSON puro;
- schema versionado;
- exit code tipado;
- relatório final mesmo em failure/timeout/interruption;
- progresso em JSONL separado;
- `partial:true` nunca aparece como conclusão;
- idempotency/correlation IDs.

---

## 15. Métricas de produto

Medidas por missão, com estado `measured|estimated|unknown`:

- tempo até primeiro plano;
- perguntas iniciais e checkpoints;
- tempo até primeiro preview saudável;
- taxa de tarefas sem intervenção;
- retries, oscillation e handoffs;
- restore success;
- runtime orphan/EBUSY rate;
- input/output/cache read/cache create;
- contexto evitado por delta;
- skills selected/applied/verified;
- aceites compliant;
- proof ready rate;
- falhas por harness/model;
- satisfação humana separada de gate técnico.

Não existe meta percentual pública sem baseline reproduzível.

---

## 16. Cenários e controles negativos

Mínimos:

1. SaaS com login, billing e painel;
2. landing page greenfield;
3. brownfield com árvore suja;
4. API sem UI;
5. monorepo com duas tarefas paralelas;
6. runtime que falha ao encerrar no Windows;
7. interrupção e retomada em outra sessão;
8. plano editado após aprovação;
9. quota/modelo indisponível;
10. harness instrucional;
11. restore após gate vermelho;
12. secret canary em mensagem/DOM/log.

Controles negativos:

- Manager tenta editar código;
- worker escreve no checkout principal;
- duas tarefas escrevem o mesmo path sem lock;
- HEAD muda durante verify;
- `verify --json` falha e não emite relatório final;
- task parent conclui com filho obrigatório pendente;
- mensagem livre concede deploy;
- ApprovalLease é reutilizada em outro worktree;
- próxima ação executa sem confirmação;
- skill instalada é mostrada como aplicada;
- `test:e2e` existe sem specs;
- modelo real difere sem fallback;
- LLM rebaixa `deny` para allow;
- cache read é somado a contexto evitado;
- transcript contém secret canary;
- `stop` deixa PID, porta ou handle;
- read model diverge do journal;
- harness advisory aparece como enforced;
- auto-commit/merge ocorre no main;
- preview é declarado com health/visual gate ausente;
- skill ou prática substitui a intenção de produto por criação exclusiva de documentação;
- resposta parcial resolve pergunta irmã sem binding;
- idioma confirma stack, escopo ou compliance;
- `AGENTS.md` bootstrap é reportado como produto entregue;
- `[planejado]` é convertido em verificado sem execução;
- edição manual do contrato amplia lease/permissão;
- handoff perde `userIntent`, `deliveryPriority`, falha ou pendências;
- receptor do handoff reinicia pelo help genérico;
- primeira entrega diverge da prioridade confirmada.

Todos devem falhar fechado ou produzir checkpoint/handoff explícito.

---

## 17. Plano de execução

### Sprint 54.0 — Freeze, baseline e P0 runtime

**Entregas:** evidence pack PRD53; reprodução do runtime; ownership design;
shutdown/kill/handle cleanup; 20x Windows; verify JSON final em falha.

**DoD:** zero EBUSY/orphan; porta/log liberados; state idempotente; checkout
limpo; full verify/proof do mesmo commit.

### Sprint 54.1 — Task Graph e read model

**Entregas:** schemas; transições; adapter sobre State Store/Session Index;
`deliveryPriority`, DecisionRefs e ContractRef no task graph; rebuild do read
model; task inbox/inspect JSON.

- node kinds, critérios de saída e resultados tipados sobrevivem ao rebuild;
- arestas `dependsOn` inválidas ou resultado inválido bloqueiam filhos.
**DoD:** nenhum segundo event store; parent/children/dependencies reproduzíveis;
prioridade e decisões sobrevivem a rebuild; read model adulterado é reconstruído.

### Sprint 54.2 — Message, Control e Pending Requirements

**Entregas:** bus tipado; optimistic concurrency; contratos Question/Answer/
DecisionReceipt; clarify/approve/edit/pause/resume/cancel/review; pending tracker
com binding individual.
- pacote de operação humana referencia runbook, evidências esperadas e comando de
  retomada, sem virar autorização ou proof.

**DoD:** texto livre não autoriza nem resolve pergunta irmã; resposta parcial
confirma somente seu `questionId`; replay é idempotente; somente pendências
acionáveis interrompem o usuário.

### Sprint 54.3 — Workspace transacional e checkpoints

**Entregas:** snapshot hash; lock por task/path; worktree obrigatória;
workspace_changed; merge barrier; timeline/restore.
- protótipo isolado registra pergunta, commit/tree hash e resultado;
- protótipo não é auto-mergeado nem conclui task de produção.

**DoD:** duas sessões não observam estado híbrido; main não recebe escrita de
worker; restore preserva audit trail.

### Sprint 54.4 — Orquestração, modelos, budget e contexto

**Entregas:** manager/planner/worker/verifier; fan-out explicado; quota/budget;
model route receipt; context pack; cache affinity/accounting; Handoff Envelope
com intenção, prioridade, decisões, pendências, falha e checkpoint.
- handoff reabre fontes primárias para claims críticos;
- context pressure permanece `measured|estimated|unknown`.

**DoD:** quota unknown não vira suficiente; budget não reinicia; contexto de
outro commit falha; economia não medida permanece unknown; troca de harness não
repete trabalho nem perde missão/failure signature.

### Sprint 54.5 — Skills, rules, design e next action

**Entregas:** explicação de ativação; lifecycle no Manager; Contract Bootstrap
condicional; reconciliação de `AGENTS.md`; First Value Gate; design-first wiring;
next actions bounded; LSP feedback.

**DoD:** contrato suficiente não reabre cerimônia; contrato ausente é oferecido,
não imposto; contrato não substitui produto; UI sem intake/design bloqueia;
skill ignorada não vira capability; `[planejado]` só muda com prova; next action
não autoexecuta nem herda escopo.

### Sprint 54.6 — Runtime, preview e jornada vertical

**Entregas:** status integrado; preview cedo; jornadas `frontend_preview` e
`scaffold_functional`; observe/autocorrect bounded; notificações; reconciliação
pós-scaffold; closeout e proof no Manager.

**DoD:** primeiro artefato corresponde à `deliveryPriority`; preview somente
saudável e comprovado; stop confiável; contrato final reflete fatos executados;
jornada do iniciante concluída sem comando interno manual.

### Sprint 54.7 — Benchmark competitivo e RC

**Entregas:** briefing/fixture congelados; execução GStack; evidência comparável
Verdent/Replit-like quando acessível; rubrica cega; clean-machine; docs e
rollback drill.

**DoD:** sem claim baseada em marketing; limitações documentadas; pacote real
verde; zero P0/P1 conhecido; release somente com autorização do mantenedor.

---

## 18. Rollback

Cada sprint é feature-flagged e reversível. Rollback deve restaurar:

- command routing anterior;
- schemas/read models compatíveis;
- policy/capability set;
- worktrees/locks;
- runtime/processos/portas;
- contexto/cache;
- docs/claims.

Runs antigos permanecem legíveis. Migração destrutiva exige backup, forward e
backward compatibility testados.

---

## 19. Definition of Done do programa

PRD54 só está concluído quando:

- P0 do runtime Windows está morto com prova repetida;
- PRD53 está certificado;
- `start` é a jornada única para iniciante;
- `AGENTS.md` é oferecido/reconciliado conforme o estado do projeto, não imposto universalmente;
- contrato bootstrap não substitui produto nem armazena estado dinâmico;
- First Value Gate fixa `deliveryPriority` e a primeira entrega a respeita;
- Manager nunca edita código;
- task graph e read model são reconstruíveis;
- mensagens/controles são tipados e idempotentes;
- pending requirements não se confundem com task status;
- respostas possuem binding individual; resposta parcial não amplia decisão;
- handoff preserva intenção, prioridade, decisões, pendências, falha e checkpoint;
- Contract Reconciliation converte `[planejado]` somente com evidência;
- workers concorrentes usam worktrees e locks;
- workspace mutado invalida o run;
- ApprovalLease governa todos os efeitos;
- paralelismo mostra quota/budget/contexto e aceita escolha sequencial;
- modelo executado corresponde ao receipt ou fallback explícito;
- contexto é incremental, fresh e redigido;
- cache/uso/economia não têm dupla contagem;
- lifecycle de skill é visível e comprovado;
- design-first usa os gates existentes;
- runtime/preview pertencem ao mesmo run e ficam saudáveis;
- stop remove árvore, porta e handles;
- trace default é mínimo e redigido;
- `--json` sempre fecha com relatório estruturado;
- verify/proof continuam autoridade final;
- restore/rollback foram exercitados;
- benchmark e clean-machine não encontram P0/P1;
- nenhuma config global do usuário foi alterada sem consentimento/backup;
- claims públicas distinguem native/enforced/advisory/not_run.

---

## 20. Ordem obrigatória

1. concluir mudanças concorrentes e obter checkout estável;
2. corrigir P0 runtime/verify JSON;
3. concluir e certificar PRD52;
4. executar PRD53 calibrado;
5. 54.0 e 54.1;
6. 54.2 e 54.3;
7. 54.4 e 54.5;
8. 54.6;
9. 54.7 e decisão humana de release.

Não implementar UI de Manager antes de estabilizar Task Graph, Event Store e
ApprovalLease. Não executar benchmark antes de congelar fixture/rubrica. Não
publicar enquanto runtime Windows ou full verify falharem.

---

## 21. Veredito

O estado da arte para o GStack não é ter mais agentes que Verdent nem copiar a
interface do Replit. É entregar a simplicidade operacional deles sem abrir mão
da verificabilidade do GStack.

O Manager torna o sistema compreensível. Worktrees e leases tornam-no seguro.
Context Delta e cache accounting tornam-no econômico. Runtime e preview tornam-no
vivo. Gates, proof e rollback tornam a entrega defensável.

Sem o P0 do runtime resolvido, isso é roadmap. Com os contratos deste PRD
comprovados, passa a ser produto.
---

## 22. Calibração normativa — Task Graph, Event Store e capabilities

> Esta seção complementa as seções 7–9 e os Sprints 54.1, 54.2 e 54.4. O
> Manager consome ClaimReceipts e ApprovalLease dos PRDs 52/53; não cria um
> segundo motor de prova ou autorização.

### 22.1 Validação fail-closed do Task Graph

Antes de persistir ou executar:

- `taskId` único e não vazio;
- todo `parentId` e `dependsOn` referencia tarefa existente;
- nenhuma auto-dependência;
- detectar ciclo e retornar o caminho reproduzível;
- grafo vazio não representa missão concluída;
- dependência `failed|cancelled|inconclusive` propaga bloqueio tipado;
- parent só conclui por filhos obrigatórios, merge barrier e gates;
- `attemptId` e retry são explícitos e não reiniciam budget;
- reserva de budget é atômica antes do fan-out.

Grafo inválido não degrada para sequência e não inicia worker. Isso corrige o
comportamento permissivo atual do Meta-Harness para dependências desconhecidas e
ciclos.

### 22.2 Event Store tipado e VFA honesta

Envelope mínimo:

```text
eventId, sequence, schemaVersion, missionId, runId, parentRunId, sessionId,
taskId, attemptId, correlationId, causationId, actor, timestamp, worktreeId,
eventType, status, evidenceRefs, metricsRefs, payloadHash, redactionVersion
```

Eventos mínimos:

```text
run_requested, run_started, run_paused, run_resumed, run_cancel_requested,
run_cancelled, run_failed, run_completed, task_started, task_blocked,
task_verified, tool_started, tool_completed, tool_failed, approval_requested,
approval_resolved, gate_started, gate_completed, checkpoint_created
```

Regras:

- sequence monotônica por stream e writer serializado;
- append/read model toleram crash e permitem rebuild;
- stream vazio nunca prova execução;
- storage obrigatório indisponível bloqueia efeito P0/P1;
- hash-chain é tamper-evident, não “imutável” contra quem pode reescrever toda a
  cadeia;
- assinatura/âncora externa é capability separada e só pode ser alegada quando
  implementada;
- fork concorrente, truncamento ou falha entre append/index são detectados.

### 22.3 Cancelamento e pausa reais

```text
accepting -> draining -> stopping -> stopped|orphaned
```

Ao entrar em `draining`, a admissão fecha antes do drain: nenhum worker, task ou
tool call novo inicia. O sistema aguarda trabalho em voo por prazo bounded,
persiste o estado terminal e aplica kill à process tree quando necessário.

Falha e efeito são contratos distintos:

```text
failureScope: attempt|task|worker|manager|environment
recoveryAction: retry|restart_component|restart_worker|handoff|block
effectState: none|started|partial|committed|compensated|unknown
```

`recoverable` é derivado de scope, effect state, idempotência, compensação e
policy; nunca é boolean livre do executor. Retry/fallback automático só é seguro
em `none` ou quando idempotência/compensação está comprovada. `partial` exige
estratégia específica; `committed` não repete sem idempotency key ou compensação;
`unknown` falha fechado para P0/P1.

- aceitar cancel-before-start;
- propagar parent para descendants e process tree;
- impedir nova tool call após `cancel_requested`;
- drenar tarefas em voo com timeout bounded;
- matar process tree no SO, não apenas mudar status lógico;
- liberar portas, handles, worktrees e locks em `finally`;
- persistir estado terminal mesmo com cleanup parcial;
- retry de cancel é idempotente;
- resume parte de requirement/checkpoint fresco, não reinicia genericamente.

### 22.4 Meta-Harness sob o Manager

Antes de ser usado pelo Manager:

- dependência desconhecida e ciclo falham;
- gate default nunca é verde; ausência retorna `blocked_gate_missing`;
- gate real inclui perfil de testes/Fallow/QG/diff-hygiene aplicável;
- falha de provenance obrigatória não é best-effort;
- exceção em executor/reviewer/gate sempre faz cleanup;
- reviewer/verifier recebem child run IDs e causalidade;
- modelo nunca conclui via `mark_all_complete` ou texto;
- conclusão deriva de filhos, gates e evidence.

QA Multi-Lens entra como parte do gate do mesmo run. VFA entra pelo Event Store.
Challenge-Response consome ApprovalLease pelo Control Bus. Type coverage é
pré-condição de release do core, não decisão do modelo.

### 22.5 Wiring nos sprints

**54.1 — Task Graph/read model**

- validar IDs, referências e DAG;
- adicionar `attemptId`, propagação terminal e budget atômico;
- implementar envelope, sequence, causalidade e rebuild;
- serializar append e rejeitar stream vazio como prova.

**54.2 — Message/Control/Pending Requirements**

- consumir ApprovalLease do PRD52 com expected status/version e consumo único;
- implementar cancel-before-start, cascade, bounded drain e terminal persistido;
- mensagem/audit receipt nunca autorizam efeito;
- fechar admissão antes de bounded drain;
- persistir `failureScope`, `recoveryAction` e `effectState`;
- impedir fallback que duplique efeito parcial ou committed.


**54.4 — Orquestração/modelos/budget/contexto**

- remover permissividades do Meta-Harness listadas na seção 22.4;
- integrar QA Multi-Lens e ClaimReceipts sem duplicar verifier;
- contabilizar tokens/custo de planner, worker, reviewer, verifier, memory,
  compression, evaluation e background tasks;
- preservar context pack por hash em child runs.

### 22.6 Controles negativos adicionais

1. ID duplicado, dependência ausente e ciclo;
2. cancel-before-start e cancel durante wave;
3. provenance vazia, concorrente e indisponível;
4. challenge enforced com CLI/policy malformada;
5. gate ausente enquanto reviewer aprova;
6. executor lança e deixa worktree/processo;
7. parent conclui com filho obrigatório pendente;
8. stream é reescrito por inteiro e chamado de “imutável”;
9. ApprovalLease é audit-only e mesmo assim autoriza;
10. worker relata success com ClaimReceipt inválido.

### 22.7 Referência Agno e limite arquitetural

Referência: <https://github.com/agno-agi/agno>, commit
`21de30f323f4ceaf07a429cb2be9bea236643a9d`, Apache-2.0.

Adaptar eventos tipados, run lineage, cancelamento, expected-state approval e
métricas. Não incorporar do Agno AgentOS, UI, FastAPI, scheduler, canais, A2A,
telemetry default ou seu workflow engine. O agendador local mínimo de retomada da
seção 25 é implementação própria e limitada do GStack, não integração com Agno.

### 22.8 DoD adicional do PRD54

- Task Graph inválido nunca inicia execução;
- cancelamento lógico e process-tree cleanup passam em Windows, Linux e macOS;
- provenance obrigatória falha fechado e possui sequência causal;
- Meta-Harness não mantém gate default verde, dependência permissiva ou cleanup
  best-effort;
- toda capability mostrada como `REAL` possui ClaimReceipt fresco;
- Event Store, journal, VFA, proof e read model têm fonte canônica única;
- nenhuma funcionalidade do Agno vira dependência runtime.
---

## 23. Calibração normativa — Continuation Contract no Manager

> Esta seção complementa 7.4, 7.5, 7.8, 11.3, 14 e os Sprints 54.2, 54.4,
> 54.5, 54.6 e 54.7. Em conflito com a frase “next actions nunca executam
> automaticamente”, vale a distinção abaixo: ação fora da lease nunca é
> automática; próximo passo reversível dentro da lease deve continuar.

### 23.1 Invariante de pausa

O Manager só pode devolver controle ao usuário quando existir:

1. `PendingRequirement` acionável;
2. gate humano exigido por policy/ApprovalLease;
3. blocker técnico comprovado com opções de recuperação;
4. estado terminal solicitado pelo usuário.

Mensagem informativa, conclusão de subetapa, revisão interna, troca de skill,
troca de harness ou recomendação P2 não são motivo de pausa.

### 23.2 Extensão canônica de PendingRequirement

Não criar segundo sistema de prompts. Estender o contrato existente:

```text
PendingRequirement:
  requirementId, missionId, taskId, promptId, questionId, decisionKey
  responseMode: binary | choice | free_text | typed_confirmation
  question, options, recommendedOption, riskTier, blocking
  acceptedResponses, yesAction, noAction, defaultPolicy
  checkpointRef, approvalLeaseRef, dedupeKey
  operatorRunbookRef, expectedEvidenceRefs, resumeCommandRef
  expectedVersion, expectedStatus, expiresAt, responseRef
  approvalLeaseImpact
```

Regras:

- `defaultPolicy` pode ser `none|recommended_reversible|checkpoint`;
- P0/P1 e irreversível usam `none`;
- `dedupeKey` impede reapresentar a mesma decisão fresca;
- `yesAction/noAction` são comandos tipados do Control Bus, não texto para
  executar em shell;
- resposta é aceita somente contra `promptId/questionId`, versão e estado
  esperados;
- prompt expirado ou stale gera nova leitura do estado antes de perguntar.
- pacote de operação humana é projeção do requisito: não é skill, lease, gate ou
  proof;
- `expectedEvidenceRefs` define schemas/hashes esperados e o retorno só é
  consumido após validação;
- máquina externa retoma pelo `resumeCommandRef` no checkpoint, sem reconstruir
  a missão por texto livre.

### 23.3 UX obrigatória de continuação

Toda pausa acionável termina com uma pergunta explícita:

```text
Etapa concluída: revisão do frontend.

Próxima ação:
Conectar /ausencias às actions reais e executar a jornada E2E.

Deseja continuar agora?
[Sim, continuar] [Não, parar aqui]

Responda: sim ou não.
```

Para plano pendente:

```text
Aprovar o plano <id> no escopo <resumo>?
[Sim, aprovar] [Não, revisar]
```

Para blocker técnico:

```text
O navegador de testes não está instalado.
Instalar o browser Playwright no escopo permitido?
[Sim, instalar] [Não, continuar sem prova visual]
```

O resultado `não` preserva checkpoint e descreve a consequência. Não pode
encerrar silenciosamente a missão.

### 23.4 Máquina de estados da continuidade

```text
running
  -> waiting_requirement
  -> waiting_approval
  -> checkpoint_ready
  -> blocked
  -> delivered

waiting_requirement + answer_yes -> ready|running
waiting_requirement + answer_no  -> checkpoint_ready|alternative_ready
waiting_approval + approved      -> ready|running
waiting_approval + rejected      -> checkpoint_ready
checkpoint_ready + continue      -> running, se lease/checkpoint frescos
```

- sem pendência, `continue` retoma do último checkpoint verde;
- plano pendente não aceita `continue` como aprovação;
- P0 não aceita aliases genéricos;
- múltiplas pendências retornam cards separados;
- replay da resposta não repete efeito;
- `pause` e `cancel` continuam comandos diferentes.

### 23.5 Limite de reabertura e addendum threshold

O Manager continua automaticamente quando a ação:

- está no plano e na lease;
- é reversível;
- não altera risk tier, policy, custo autorizado ou efeitos externos;
- usa paths/tools já permitidos;
- é necessária para cumprir o DoD aprovado.

Exige addendum e nova aprovação quando:

- muda produto, stack, fornecedor, auth, tenancy ou compliance;
- adiciona migração destrutiva, deploy, cobrança, rede ou segredo;
- expande allowed paths/tools/commands;
- altera risk tier ou remove gate;
- muda a entrega prioritária aprovada.

Skills retornam `applied|not_applicable|conflict_found`; não podem emitir
`approval_resolved`.

### 23.6 Maturidade no Manager

Consumir os estados canônicos do PRD52 e mostrar ambos:

```text
Status da execução: delivered
Maturidade da entrega: demo_ready
Falta para workflow_ready:
- conectar ações reais;
- validar autorização/persistência;
- executar navegador E2E.
```

O Manager não deriva maturidade de copy da página. Ela vem de receipts/gates do
mesmo commit.

### 23.7 Wiring nos sprints

**54.2 — Message/Control/Pending Requirements**

- schema estendido, parser localizado, dedupe e expected-state;
- comandos `answer_yes|answer_no|select_option|typed_confirmation`;
- prompt binário obrigatório em toda pausa acionável.

**54.4 — Orquestração/handoff**

- preservar prompt pendente, aliases, decisões, lease e checkpoint;
- `continue` sem pendência retoma; com plano pendente reapresenta aprovação;
- troca de harness não reabre decisões.

**54.5 — Skills/design/next action**

- skills não pausam por defaults P2 cobertos;
- design system é perguntado uma vez quando material;
- direção aprovada fecha decisões secundárias reversíveis;
- ação fora da lease é oferecida; passo dentro da lease é executado.

**54.6 — Runtime/preview**

- readiness testa browser executável, não apenas pacote;
- servidor gerenciado oferece URL estável e health probe;
- HTTP, browser e interação geram receipts separados;
- maturidade é reduzida honestamente quando a prova visual não roda.

**54.7 — Benchmark/RC**

- replay integral das fixtures Verdent do PRD53;
- medir pausas, repetição, retomada e tempo até preview;
- certificar em Claude, Codex e OpenCode nos níveis reais de enforcement.

### 23.8 DoD adicional

- nenhuma pausa sem pergunta/ação ou blocker comprovado;
- nenhuma decisão fresca é perguntada duas vezes;
- `continue` possui resultado determinístico em todos os estados;
- plano novo nunca é aprovado por alias genérico;
- execução dentro da lease não para por cerimônia de skill;
- handoff preserva missão, prioridade, prompt e checkpoint;
- `demo_ready`, `workflow_ready` e `production_ready` possuem receipts distintos;
- terminal e `--json` representam a mesma decisão e o mesmo estado.
## 24. Addendum normativo - Estado operacional de versao, cache e probes

O Manager deve transformar falhas de instalacao, catalogo e ambiente em estados
compreensiveis e acionaveis. Ele nao pode apresentar "atualizado" apenas porque
um download terminou nem apagar opcoes conhecidas por uma falha transitoria.

### 24.1 Estados apresentados

O read model pode consumir os receipts canonicos dos PRDs donos e apresentar:

- `up_to_date`;
- `update_available`;
- `downloaded_not_applied`;
- `version_mismatch`;
- `rollback_available`;
- `rollback_failed`;
- `fresh`;
- `stale_cache`;
- `unavailable`;
- `invalid_metadata`.

Esses estados sao de operacao/readiness e nao criam uma segunda maquina de
release. PRD52 continua dono da transicao e do proof; PRD46 continua dono da
freshness de fontes.

Exemplo de apresentacao:

```text
Versao em execucao: 5.60.0
Versao esperada: 5.61.0
Estado: baixada, mas nao aplicada
Proxima acao: tentar novamente ou restaurar a versao anterior
Projeto e configuracoes: preservados
```

### 24.2 Last-known-good sem desaparecimento de capacidade

Quando catalogo de provider/modelo ou outra fonte remota falhar:

- manter o snapshot valido mais recente;
- mostrar idade, origem e status `stale_cache`;
- nao declarar quota, autenticacao ou disponibilidade como pronta;
- nao remover silenciosamente opcoes ja configuradas;
- oferecer refresh bounded ou continuar em modo degradado quando a policy
  permitir;
- metadata invalida nunca substitui o snapshot valido.

### 24.3 Probes negativos com TTL

Deteccoes de CLI/editor/runtime devem:

- classificar ausencia como `not_found`, nao erro interno;
- armazenar resultado negativo com TTL;
- repetir somente por expiracao, mudanca observavel de PATH/config ou refresh
  explicito;
- deduplicar mensagens;
- limitar concorrencia e wall time;
- nunca iniciar login, instalacao ou rede sem consentimento.

O Manager apresenta uma linha util e uma acao recomendada; nao despeja a saida
repetida de `where`, `which` ou stack traces.

### 24.4 Wiring e DoD adicional

- Sprint 54.0 consome o proof de transicao do PRD52 no baseline;
- Sprint 54.1 inclui versao/cache/probes no read model, sem duplicar autoridade;
- Sprint 54.2 representa recuperacao como `PendingRequirement` somente quando
  decisao humana for realmente necessaria;
- Sprint 54.6 mostra degradacao sem interromper preview que nao dependa da fonte;
- Sprint 54.7 inclui fixtures de version mismatch, stale cache, metadata invalida
  e probe negativo deduplicado.

DoD:

- terminal e JSON exibem o mesmo estado;
- `downloaded_not_applied` nunca aparece como sucesso;
- catalogo remoto vazio nao apaga providers/modelos conhecidos;
- `stale_cache` nunca equivale a autenticado ou disponivel;
- probe ausente nao gera erro repetido;
- toda acao mutante continua sujeita a consentimento, backup e rollback.

## 25. Calibração normativa — missões autônomas e retomada agendada

Esta seção torna a autonomia uma função de produto para usuários não técnicos. O
Manager continua reutilizando Loop Engine, ApprovalLease, Event Store, journal,
checkpoints, budgets, adapters e PendingRequirement; não cria um segundo runtime.

Em conflito com qualquer formulação anterior que proíba genericamente `scheduler`,
vale a distinção desta seção: permanece proibido importar o scheduler/runtime do Agno
ou construir um orquestrador genérico; é obrigatório implementar o agendador local
mínimo necessário para retomar uma missão já autorizada.

### 25.1 Jornada padrão da missão autônoma

Para o usuário padrão, o fluxo é:

1. descrever o resultado desejado;
2. receber um plano em linguagem simples;
3. autorizar uma vez a missão local e seus limites;
4. deixar o Manager distribuir, executar, verificar, corrigir e retomar o trabalho;
5. voltar quando a missão concluir ou quando existir uma decisão realmente humana.

Antes de iniciar, a superfície padrão mostra somente:

- o que será construído;
- qual projeto será alterado;
- estimativa de tempo/uso quando disponível;
- o que o GStack pode fazer sozinho;
- quais efeitos externos não estão incluídos.

Worktrees, hashes, receipts, adapters e detalhes da ApprovalLease ficam disponíveis em
`inspect --full`, mas não são requisitos para o usuário começar.

### 25.2 Autorização única e execução contínua

A ação principal da UX equivale a `Começar e continuar sozinho`. Ela cria ou resolve a
ApprovalLease já definida no PRD52; não cria uma autorização paralela.

Dentro da lease válida:

- não pedir aprovação por comando, subetapa, teste, retry ou troca interna de agente;
- verificadores alimentam o próximo ciclo automaticamente;
- mensagens de progresso não pausam a missão;
- a conclusão de um card libera o próximo trabalho elegível;
- agentes podem reivindicar tarefas prontas atomicamente;
- o usuário pode pausar, cancelar ou inspecionar a qualquer momento.

O GStack reduz prompts sob seu controle, mas não promete suprimir aprovação imposta
pelo harness, sistema operacional ou provider. O adapter declara essa limitação antes
da missão.

### 25.3 Supervisor local mínimo

O supervisor persiste a missão fora da conversa e possui somente cinco
responsabilidades:

1. observar o estado canônico sem chamar modelo quando não há trabalho;
2. iniciar a próxima tarefa elegível;
3. preservar heartbeat, cursor, checkpoint e consumo cumulativo;
4. reagendar uma retomada já autorizada;
5. notificar o usuário somente por `PendingRequirement` acionável ou estado terminal.

Ele usa o mecanismo do sistema operacional suportado pelo host e não exige sessão do
harness aberta. Não implementa marketplace, fila distribuída, painel remoto ou
scheduler de propósito geral.

Backends mínimos por host devem ser provados na Host Capability Matrix. Quando nenhum
backend persistente estiver disponível, o estado é `resume_scheduling_unavailable`; a
missão ainda pode executar na sessão atual sem falsa promessa de retomada.

### 25.4 Projeção simples de estado

A UX apresenta estes rótulos derivados do Event Store, sem criar uma nova máquina de
estados canônica:

- `Trabalhando`;
- `Precisa de você`;
- `Aguardando renovação do limite`;
- `Retomada agendada`;
- `Concluído`;
- `Não foi possível continuar`.

`Precisa de você` exige exatamente uma pergunta atual, com opções curtas e o efeito da
resposta. Status, log de atividade e resultado de verificador não são perguntas.

### 25.5 Aviso de 90% e escolha do usuário

Ao atingir 90% de um denominador conhecido, o Manager cria checkpoint e apresenta:

1. `Pausar e retomar quando o limite renovar`;
2. `Continuar até o limite máximo`;
3. `Encerrar e entregar o progresso atual`.

Regras de apresentação:

- percentual exato somente para `usageBasis: measured`;
- estimativa deve ser rotulada `estimada`;
- `unknown` mostra que o saldo não pôde ser consultado, sem barra ou percentual falso;
- sem medição oficial da quota do provider, 90% refere-se apenas ao budget da missão;
- o aviso é deduplicado por missão, denominador e janela de consumo.

Se o usuário estiver ausente e não houver política previamente escolhida, o Manager
continua somente até um checkpoint seguro e pausa no limite. Ele não presume extensão
de custo.

O usuário pode escolher antecipadamente `pausar e retomar automaticamente` para o
restante da missão. Essa escolha é revogável e não autoriza efeitos externos novos.

### 25.6 Contrato mínimo de retomada

O agendamento persiste:

```text
ResumeSchedule:
  scheduleId, missionId, checkpointRef, approvalLeaseRef
  providerRef, harnessRef, resumeAfter, timeSource
  expectedPlanHash, expectedVersion, expectedStatus, status
  createdAt, cancelledAt, firedAt, idempotencyKey
```

Valores fechados:

```text
timeSource: provider_reset | retry_after | user_selected
status: scheduled | cancelled | fired | superseded | failed
```

Regras:

- usar `resetAt` ou `Retry-After` somente quando acompanhados de fonte observável;
- sem horário confiável, usar o horário escolhido pelo usuário;
- máquina desligada não executa trabalho local;
- após suspensão, desligamento ou horário perdido, retomar uma única vez no próximo
  despertar/login suportado;
- autenticação expirada produz `Precisa de você`, sem tentar contorná-la;
- plano, versão/estado, worktree ou lease stale bloqueiam a retomada e apresentam uma
  decisão única;
- disparo duplicado é idempotente;
- cancelamento fecha admissão antes que novo worker seja criado;
- retomada não reinicia budget, attempts nem aviso já emitido para a mesma janela.

O Event Store registra, no mínimo:

```text
quota_warning_emitted, resume_scheduled, resume_cancelled,
resume_due, resume_started, resume_skipped, resume_failed
```

`resume_due` não prova que a missão retomou; somente `resume_started` ligado ao
checkpoint revalidado comprova nova execução.

### 25.7 Recuperação antes de handoff

Uma falha técnica não chama imediatamente o usuário. Dentro do budget e dos efeitos
seguros, o Manager tenta a escada definida no PRD52:

1. diagnóstico e retry corrigido;
2. agente independente para analisar a falha;
3. replanejamento da tarefa afetada;
4. modelo/harness alternativo já autorizado;
5. restauração do checkpoint saudável.

O Manager encerra a escada cedo quando a próxima etapa não for suportada, repetir um
efeito não for seguro ou o circuit breaker indicar ausência de progresso. Nesse caso,
`Precisa de você` mostra o problema, o que já foi tentado e no máximo três opções.

### 25.8 Superfície de produto

A superfície CLI existente deve evoluir sem criar outro motor:

```text
gstack_vibehard start "<objetivo>" --autonomous
gstack_vibehard task status <id>
gstack_vibehard task pause|resume|cancel <id>
gstack_vibehard task schedule-resume <id> --at <timestamp>
gstack_vibehard task inbox
```

Os nomes finais dependem de command parity antes da estabilização. A função obrigatória
é a capacidade, não cada spelling provisório. A interface visual futura consome os
mesmos contratos.

### 25.9 Wiring nos sprints

**54.1 — Read model**

- projetar estado simples, consumo, checkpoint e próxima retomada;
- manter o Event Store como fonte canônica.

**54.2 — Message, Control e Pending Requirements**

- adicionar a escolha única de política aos 90%;
- deduplicar aviso e autenticação pendente;
- não representar progresso como pergunta.

**54.3 — Workspace e checkpoints**

- persistir checkpoint independente da sessão;
- revalidar plano/worktree antes da retomada.

**54.4 — Orquestração e budget**

- aplicar recuperação progressiva antes de handoff;
- preservar budget cumulativo entre agents/harnesses/resume;
- reservar trabalho atomicamente antes do fan-out.

**54.6 — Runtime**

- implementar supervisor e agendamento local mínimos;
- instalar/remover a integração com o agendador do host de forma explícita e
  reversível;
- comprovar cancelamento, idempotência e retomada após despertar.

**54.7 — Benchmark/RC**

- reexecutar as fixtures da seção 28 do PRD53;
- medir autonomia, pausas, perda de progresso e precisão de quota por harness.

### 25.10 Não objetivos e DoD adicional

Não implementar nesta entrega:

- runtime próprio que substitua Claude, Codex ou OpenCode;
- board colaborativo completo ou clone do Workbench;
- aprovação por comando;
- Docker obrigatório para toda missão;
- execução automática de deploy, publicação, compra ou outro efeito externo não
  incluído na autorização inicial;
- polling periódico com modelo quando uma observação local determinística basta;
- promessa de percentual ou horário de renovação sem dado confiável.

DoD adicional:

- uma missão local reversível pode concluir sem pausa humana desnecessária;
- teste/verificador vermelho volta ao loop sem pedir autorização por padrão;
- o aviso de 90% é honesto, único e ligado a um denominador;
- a política de retomada sobrevive à sessão e pode ser cancelada;
- reinício, despertar ou disparo duplicado não repetem efeitos;
- budget acumulado nunca reinicia ao trocar agente, harness ou sessão;
- detalhes técnicos permanecem disponíveis sem serem impostos ao usuário leigo;
- nenhuma limitação do harness é apresentada como capacidade comprovada do GStack.

## 26. Calibração normativa — evidência no Task Graph e origem das falhas

Esta seção fecha as lacunas de apresentação e propagação identificadas pela auditoria.
Ela consome contratos dos PRDs 52/53 e não transforma o Manager em dono de release,
hooks, evidence ou avaliação.

### 26.1 Transições dependentes de evidência

Cada aresta que depende de prova referencia requisitos/claims por ID e classifica a
evidência requerida como `fresh|stale|incomplete|absent|invalid`.

Regras:

- `verifying -> passed` exige evidence fresca e completa para os critérios obrigatórios
  da tarefa;
- `passed -> merge_ready` revalida freshness contra HEAD, plan e worktree atuais;
- evidence stale/incompleta bloqueia somente tarefas e claims que dependem dela;
- evidence opcional ausente permanece na superfície não verificada, sem bloquear tarefa
  não dependente;
- read model não converte `stale|incomplete|absent|invalid` em sucesso;
- refresh bem-sucedido cria nova referência; não edita a evidence antiga.

O motivo de bloqueio preserva `requirementId|claimId`, evidence esperada, evidence
observada e próxima ação. Isso impede um blocker genérico de paralisar toda a missão.

### 26.2 PendingRequirement para migração e ambiente

Migração ou condição ambiental não gera pergunta automaticamente. O Manager continua
sozinho quando existe recuperação reversível coberta pela ApprovalLease. Criar
`PendingRequirement` somente quando faltar decisão, autenticação, autoridade ou ação
física do usuário.

Extensão aditiva do contrato existente:

```text
requirementKind: decision | authentication | migration_choice |
                 environment_remediation
blockerOriginRef, affectedTaskIds, resumeCommandRef
```

A pergunta mostra o que está bloqueado, o que o GStack já tentou e no máximo três
opções. Resolver o requisito retoma somente as tarefas afetadas; não reinicia a missão
nem seu budget.

### 26.3 Escopo e origem da falha são eixos distintos

Manter `failureScope` como alcance operacional e acrescentar:

```text
failureOrigin: product | workspace | environment | harness |
               provider | external_dependency | unknown
attributionBasis: verified | inferred | unknown
originEvidenceRefs[]
```

Um timeout do provider pode bloquear a tarefa sem provar defeito do produto. Uma falha
do produto continua falha mesmo quando observada por um harness degradado, desde que a
atribuição seja reproduzível. `inferred|unknown` nunca é apresentado como causa
confirmada.

### 26.4 Lifecycle de hooks como projeção

O Manager pode apresentar `discovered|invoked|duplicate|failed|removed|restored` apenas
a partir dos receipts canônicos do PRD52. Ele não infere funcionamento pela presença do
arquivo e não cria outro registry de hooks.

Ações de instalar, atualizar, remover ou restaurar hook usam Control tipado,
`expectedVersion`, rollback e drain quando houver processo em voo. Falha externa é
propagada à tarefa dependente com `failureOrigin` e evidence refs; não desaparece como
N/A verde nem vira automaticamente falha global do produto.

### 26.5 Wiring e DoD adicional

- Sprint 54.1 projeta freshness/completeza da evidence e `failureOrigin` no read model;
- Sprint 54.2 incorpora `requirementKind` sem criar outro sistema de prompts;
- Sprint 54.3 revalida evidence antes de `passed|merge_ready`;
- Sprint 54.6 consome lifecycle de hooks e preserva rollback/drain existentes;
- Sprint 54.7 inclui fixtures de evidence stale, migração acionável, provider
  indisponível e harness degradado;
- blocker externo nunca desaparece, mas também não reprova claims independentes;
- nenhuma atribuição de culpa é mostrada como verificada sem `originEvidenceRefs`;
- pendência histórica do PRD51 não é marcada resolvida apenas porque o Manager sabe
  representá-la.
