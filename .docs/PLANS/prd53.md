# PRD53 — Currículo Operacional Verificável

> **Para agentes executores:** este programa começa somente depois do PRD52
> concluído e certificado. Usar uma branch/worktree por sprint, teste negativo
> antes da implementação e revisão humana antes de qualquer promoção. Nenhum
> sprint autoriza publicação, alteração global de harness ou execução de código
> não confiável diretamente no host.

**Goal:** transformar somente as práticas essenciais de `projetogstack.md` e
`manualdeengenhariacomia.md` em comportamento executável e mensurável do GStack,
sem transformar os 50 módulos do manual em funcionalidades, sem carregar os
manuais no prompt e sem criar motores paralelos aos que já existem.

**Resultado de produto:** o usuário descreve o que quer construir; o GStack
descobre o estado do projeto, pergunta apenas decisões que alteram a solução,
seleciona práticas e skills mínimas, executa pelo Golden Run e só declara
entrega com gates, proof e evidência do mesmo run.

**Baseline de autoria:** `v5.59.2`, commit `5b14fa0`.

**Baseline de execução:** o commit que concluir integralmente o PRD52, registrado
no evidence pack do Sprint 53.0.

**Status:** plano revisado após auditoria adversarial. Nada neste documento está
implicitamente implementado.

**Auditorias normativas:**

- `.docs/RESEARCH/prd53-e2e-method-audit-20260725.md`;
- `.docs/RESEARCH/prd53-full-repository-audit-20260725.md`;
- `.docs/RESEARCH/prd53-repository-disposition-20260725.json`.

**Calibração aprovada pós-auditoria local:**

- `.docs/PLANS/prd53-prd54-calibration-20260727.md`.
- `.docs/PLANS/prd53-prd54-agents-contract-calibration-20260727.md`.

As referências externas fornecem contratos, traps e métodos de prova. Nenhuma
delas vira dependência runtime, novo harness, novo motor ou autoridade de
promoção.

---

## 1. Decisão central

Os manuais são fontes de curadoria, não runtime.

O `projetogstack.md` descreve o contrato e a experiência pretendida. O
`manualdeengenhariacomia.md` contém repertório mais amplo. Uma recomendação só
entra no core quando possui:

1. trigger ou justificativa de universalidade;
2. exclusões explícitas;
3. decisão ou artefato que ela altera;
4. implementação real;
5. verificador real;
6. cenário positivo e negativo;
7. evidência de que não piora segurança, resultado ou jornada;
8. rollback.

Práticas sem esses elementos permanecem referência humana ou candidatas. Não se
cria gate fictício para fazer o registry parecer completo.

> **Regra:** prática -> contrato -> cenário -> shadow route -> shadow execution
> -> evidência -> revisão humana -> promoção.

---

## 2. Critérios de entrada

O Sprint 53.0 deve retornar `blocked` se o PRD52 não tiver comprovado:

- Golden Run como caminho principal do `start`;
- estados finais `delivered`, `checkpoint_ready` e `blocked`;
- ledger unificado e claims coerentes;
- registry V1 de práticas do Sprint 52.5;
- contexto e freshness transacionais;
- `verify` e `proof` sobre o mesmo artefato;
- rollback exercitado;
- pacote certificado em máquina limpa;
- zero defeito conhecido P0/P1 no escopo suportado;
- evidence pack do commit final;
- revogação de qualquer segredo exposto.

Além desses requisitos, o evidence pack do PRD52 deve provar no mesmo commit:

- `acceptanceResolved` derivado de compliance executado e fresco, não da mera
  existência de um verifier;
- `delivered` impossível sem todos os aceites aplicáveis em estado
  `compliant`;
- token usage `unknown` nunca convertido em zero quando houver budget ativo;
- autorização de escrita representada por lease vinculada ao plano e ao escopo,
  não por booleano reutilizável.

Esses quatro itens continuam sob ownership do PRD52. O Sprint 53.0 apenas
reexecuta seus controles negativos e retorna `blocked` se qualquer prova faltar,
estiver stale ou pertencer a outro run/commit.

Também deve existir um **seed corpus** aprovado com casos suficientes para
validar schema e runner. Esse corpus:

- pode ser sintético;
- não conta como piloto;
- não conta como evidência de promoção;
- não define percentuais de ganho;
- deve conter pelo menos um caso greenfield, um brownfield e um controle
  negativo de segurança.

O piloto real só começa no Sprint 53.5.

---

## 3. Não objetivos

PRD53 não autoriza:

- implementar todos os módulos dos manuais;
- fine-tuning;
- novo harness, agente, MCP ou motor independente;
- substituir Golden Run, Loop Engine, Gate Registry, Gate Truth, Dream Learning,
  Behavioral Conformance ou Epistemic Benchmark;
- executar todas as skills em toda tarefa;
- autoeditar prompts, policies, gates ou corpus;
- auto-promover aprendizado;
- telemetria remota sem consentimento;
- executar código não confiável diretamente no host;
- usar LLM judge como prova de segurança ou entrega;
- adicionar dependência runtime metodológica.

Novos módulos são permitidos somente como schemas ou adaptadores finos sobre os
componentes canônicos da seção 5.

---

## 4. Autoridade e precedência

Há duas ordens complementares. Para decidir **o que construir**:

```text
intenção explícita do usuário > plano aprovado > policy do projeto
> prática de engenharia > rule do projeto > skill > conselho do modelo
```

Para afirmar **o que foi executado e comprovado**:

1. comportamento do pacote real em cenário reproduzível;
2. evidence pack atestado do mesmo commit, registry e ambiente;
3. gate/verificador executado e sua contraprova;
4. contrato e schema versionados;
5. código e testes de integração;
6. PRD aprovado;
7. `projetogstack.md`;
8. `manualdeengenhariacomia.md`;
9. transcript, opinião ou claim de LLM.

As ordens não se contradizem: o usuário governa objetivo, prioridade e decisões
de produto; runtime, gates e evidência governam claims de execução. Nenhuma
skill, rule, prática, default ou recomendação pode ampliar silenciosamente uma
decisão humana. Nenhuma preferência humana converte uma execução ausente em
capacidade comprovada.

Ausência de evidência produz `unknown`, `not_run` ou `inconclusive`, conforme o
caso. Nenhum desses estados equivale a aprovação.

---

## 5. Componentes canônicos

O executor deve estender estes componentes, não recriá-los:

| Responsabilidade | Componente canônico |
|---|---|
| intake e decisões | `src/project-plan/intake.js`, `question-registry.js`, `product-brief.js` |
| detecção e rota | `src/skills/route.js`, `gate-matrix.js` |
| verdade dos gates | `src/skills/gate-registry.js`, `gate-truth.js` |
| execução | `src/project-plan/golden-run.js`, `run-loop.js` |
| evidência | `src/project-plan/evidence-ledger.js`, `src/vfa/` |
| conformance comportamental | `src/skills/behavioral-conformance.js` |
| conformance por harness | `src/harness/conformance.js`, `src/dream/harness-conformance-matrix.js` |
| avaliação epistêmica | `src/epistemic/benchmark.js` |
| aprendizado e dedupe | `src/dream/candidate.js`, `dedupe.js`, `learning.js` |
| promoção e freshness | `src/dream/promotion-gate.js`, `freshness.js` |
| contexto de retomada | `src/project-plan/context-delta.js` |

### 5.1 Regra contra duplicação

Antes de criar arquivo novo, o executor deve registrar:

- responsabilidade ausente;
- por que nenhum componente da tabela pode recebê-la;
- contrato que será reutilizado;
- teste que falharia se surgirem duas fontes de verdade.

Sem essa justificativa, o arquivo novo é proibido.

### 5.2 Adaptação permitida

O Practice Registry pode ter schema próprio, mas:

- transições reutilizam as regras do Promotion Gate;
- conformance reutiliza o runner comportamental;
- claims de harness reutilizam a matriz pública;
- benchmarks reutilizam o formato epistêmico;
- receipts reutilizam VFA e Evidence Ledger;
- dedupe reutiliza assinaturas e conflitos do Dream Learning.

---

## 6. Taxonomia sem estados impossíveis

Cada prática possui três eixos independentes.

### 6.1 Treatment

Define como a prática participa do produto:

| Valor | Significado |
|---|---|
| `core` | invariável de execução, com justificativa de universalidade |
| `conditional_question` | decisão humana necessária sob trigger |
| `conditional_recipe` | receita aplicada sob fatos verificáveis |
| `human_reference` | consulta, sem influência automática |

Compatibilidade V1:

- `core`, `conditional_question` e `conditional_recipe` são preservados;
- `consult_only` é lido como alias legado de `human_reference`;
- novos registros são serializados como `human_reference`;
- o alias só pode ser removido após teste provar ausência de consumidor V1.

### 6.2 Lifecycle

Define maturidade e rollout:

```text
catalogued -> candidate | rejected
candidate  -> shadow_route | rejected
shadow_route -> shadow_execution | candidate | rejected
shadow_execution -> promoted | candidate | rejected
promoted   -> paused | retired
paused     -> shadow_route | retired
rejected   -> terminal
retired    -> terminal
```

Valores:

- `catalogued`;
- `candidate`;
- `shadow_route`;
- `shadow_execution`;
- `promoted`;
- `paused`;
- `retired`;
- `rejected`.

`future_candidate` não é treatment. É representado por
`lifecycle=candidate` e `capabilityState=missing`.

`shadow_route` calcula e registra a decisão candidata sem governar nem executar.
`shadow_execution` executa o comportamento em isolamento e somente é permitido
com `capabilityState=implemented`. Route shadow não é evidência comportamental e
nunca sustenta promoção.

### 6.3 Capability state

Define se a prática pode ser executada:

- `implemented`: implementação e verificador reais;
- `missing`: falta implementação ou verificador;
- `unsupported`: incompatível com o escopo/plataforma atual.

Invariantes:

- `human_reference` só pode ficar `catalogued` ou `retired`;
- `promoted` exige `implemented`;
- `rejected` e `retired` são terminais;
- `missing` nunca pode ser `promoted`;
- `missing` pode chegar somente a `shadow_route`, nunca a
  `shadow_execution`;
- `shadow_execution` exige implementação e verifier reais;
- `unsupported` nunca pode ser roteado;
- transição inválida falha fechado;
- decisão `promote|keep_shadow|revise|reject|pause` deve mapear para uma aresta
  válida do lifecycle.

---

## 7. Fact Registry tipado e trivalorado

O Practice Registry não pode depender diretamente dos seis regexes atuais de
`route.js`. Deve existir um vocabulário tipado de fatos.

### 7.1 Contrato

```json
{
  "schemaVersion": "gstack.practice-facts.v1",
  "runId": "run-123",
  "facts": [
    {
      "id": "persistent_data",
      "type": "boolean",
      "state": "known",
      "value": true,
      "source": "repo_probe",
      "authorityClass": "workspace",
      "evidenceRef": "artifact://workspace/database-scan",
      "observedAt": "2026-07-24T00:00:00.000Z",
      "freshUntil": null
    }
  ]
}
```

Tipos aceitos:

- `boolean`;
- `enum`;
- `string`;
- `number`;
- `duration`;
- `artifact_ref`.

Todo fato possui `state=known|unknown|conflict|stale`. Somente `known` pode
carregar `value`. `unknown`, `conflict` e `stale` permanecem distintos e
nunca são convertidos entre si para simplificar routing.

### 7.1.1 Autoridade por classe

Não existe precedência global válida para todos os fatos:

| classe | autoridade primária | exemplos |
|---|---|---|
| `intent` | decisão explícita do usuário | objetivo, preferência, risco aceito |
| `workspace` | probe determinístico | package manager, design system, schema |
| `policy` | policy versionada | paths, tools, rede e efeitos permitidos |
| `runtime` | execução observada | health, porta, PID, processo e latência |
| `compliance` | verifier determinístico do mesmo run | aceites, gates e proof |

Classifier textual só sugere descoberta. Skill, documentação e memória nunca
sobrescrevem intenção, policy ou realidade observada. Fontes incompatíveis
produzem `state=conflict`; evidência expirada produz `state=stale`.

### 7.1.2 Estado de decisões humanas

Fatos de intenção que alteram produto, stack, escopo, compliance, tenancy,
autenticação, deploy ou efeito externo possuem estado adicional:

```text
DecisionState:
  confirmed     resposta explícita vinculada à pergunta correspondente
  recommended   proposta do sistema ainda não aprovada
  inferred      hipótese operacional, nunca autorização
  planned       conteúdo documental ainda não materializado
  pending       decisão humana ainda necessária
  conflict      respostas ou fontes explícitas incompatíveis
```

Somente `confirmed` sustenta requisito humano ou ApprovalLease. `recommended`,
`inferred` e `planned` podem orientar uma proposta reversível, mas não podem
virar requisito regulatório, escolha de fornecedor, efeito externo ou claim de
implementação. `pending` permanece visível e bloqueia somente a etapa realmente
afetada.

### 7.1.3 Binding de pergunta, resposta e decisão

```text
Question:
  questionId, decisionKey, options, allowsFreeText, riskTier, blocking

Answer:
  answerId, questionId, value, answeredAt, actorId

DecisionReceipt:
  decisionKey, state, sourceQuestionId, sourceAnswerId, evidenceRef
```

Uma resposta resolve apenas o `questionId` que referencia. Resposta parcial,
mensagem livre ou confirmação de idioma não aprova perguntas irmãs, defaults,
recomendações ou decisões adjacentes. Por exemplo, `tudo em pt-BR` pode
confirmar `outputLanguage=pt-BR`; não confirma stack, módulos, autenticação,
multi-tenancy, LGPD, CLT ou eSocial.

Quando uma mensagem puder responder a mais de uma pergunta, o Manager apresenta
a interpretação por `decisionKey` antes de confirmá-la. Em modo não interativo,
decisão humana não respondida permanece `pending`; nunca é fabricada.

### 7.2 Vocabulário inicial

- `touches_frontend`;
- `persistent_data`;
- `sensitive_data`;
- `external_side_effect`;
- `async_processing`;
- `production_intent`;
- `regulated_domain`;
- `multi_tenant`;
- `deployment_target`;
- `existing_design_system`;
- `existing_backup`;
- `runtime_required`;
- `parallelizable_tasks`;
- `irreversible_action`;
- `intent_conflict`.

Adicionar fato exige schema, produtor, teste, classe de autoridade e política
para `unknown|conflict|stale`.

### 7.3 Semântica de aplicação

1. exclusão booleana `known:true` vence trigger;
2. todos os fatos de `all` precisam satisfazer a condição tipada;
3. ao menos um fato de `any` precisa satisfazer a condição, se `any` existir;
4. `known:false` torna condição booleana não aplicável;
5. `unknown`, `conflict` ou `stale` em prática P0/P1 exige descoberta,
   pergunta ou `checkpoint_ready`;
6. estado não conhecido em prática P2 reversível pode usar default recomendado,
   sempre registrado;
7. modo não interativo nunca inventa valor para P0/P1;
8. classifier textual é sugestão, nunca prova de risco;
9. valor sem `type`, unidade incompatível ou `artifact_ref` sem hash falha
   fechado;
10. fato de runtime nunca é satisfeito apenas por resposta humana.

O adapter dos detectores atuais apenas popula fatos da classe correspondente e
com sua evidência. Ele não é fonte canônica universal.

---

## 8. Engineering Practice Registry V2

### 8.1 Envelope do registry

```json
{
  "schemaVersion": "gstack.engineering-practice-registry.v2",
  "registryVersion": "2.0.0",
  "sourceCommit": "<git-sha>",
  "contentHash": "sha256:<hash>",
  "generatedAt": "<iso-8601>",
  "practices": []
}
```

O hash é calculado sobre JSON canônico com chaves ordenadas, UTF-8 e LF.

### 8.2 Contrato de prática

```json
{
  "id": "data-recovery",
  "treatment": "conditional_question",
  "lifecycle": "candidate",
  "capabilityState": "missing",
  "riskTier": "P1",
  "universalJustification": null,
  "sourceRefs": [
    {
      "document": "manualdeengenhariacomia.md",
      "sectionId": "5.1.3",
      "sectionHash": "sha256:<canonical-section>"
    }
  ],
  "stages": ["intake", "planning", "verify", "closeout"],
  "stageBindings": [
    {
      "stageId": "planning",
      "requiredFacts": ["persistent_data"],
      "requiredSkills": ["database"],
      "requiredInputs": ["brief"],
      "producedOutputs": ["brief.nonFunctional.recovery"],
      "requiredGateRefs": [],
      "onFailure": "checkpoint_ready",
      "evidenceRequired": ["factSnapshot", "decisionReceipt"]
    }
  ],
  "triggers": {
    "all": ["persistent_data"],
    "any": ["production_intent", "regulated_domain", "sensitive_data"]
  },
  "exclusions": ["static_site", "throwaway_prototype"],
  "discoverBeforeAsk": ["persistent_data", "existing_backup"],
  "questions": [
    {
      "id": "recovery-objectives",
      "decision": "recovery_objectives",
      "why": "Define perda de dados e indisponibilidade aceitáveis.",
      "priority": "P1",
      "reversible": false
    }
  ],
  "skills": ["database", "project-lifecycle"],
  "outputs": ["brief.nonFunctional.recovery"],
  "artifacts": [".gstack/recovery-plan.json"],
  "verifiers": [],
  "verificationGaps": ["backup-restore-proof"],
  "fallback": "checkpoint_ready",
  "evidenceRefs": []
}
```

O exemplo permanece `candidate/missing` porque `backup-restore-proof` ainda não
existe. Ele não pode ser promovido até o Gate Registry possuir implementação,
contraprova e Gate Truth `proved`.

### 8.3 Invariantes

- `core` exige `universalJustification`;
- `conditional_*` exige triggers;
- toda pergunta altera decisão nomeada;
- toda skill existe no catálogo;
- todo verifier referencia gate existente;
- gate exigido para promoção precisa estar `executed`, `blocking` e `proved`;
- verification gap mantém `capabilityState=missing`;
- exclusões usam o Fact Registry;
- P0/P1 exige cenário negativo;
- `promoted` exige evidence pack atestado;
- conflito de prática, gate, policy ou artefato falha fechado;
- manual nunca é lido em runtime.

### 8.3.1 Governança de referências externas

Prática derivada de fonte externa entra como `reference_pack` em
`candidate/consult_only`, nunca como promoção direta. O pack registra:

```text
url, sourceClass: primary_source|secondary_source
sourceCommit|snapshotDate, contentHash, licenseStatus, auditRef
```

Mirror, resumo, post ou memória não substituem a fonte primária. Material sem
licença conhecida pode informar análise, mas não pode ser copiado, vendorizado ou
virar dependência. Promoção exige Scenario Lab, controles negativos, comparação
A/B e evidence pack do próprio GStack.

### 8.4 Source hash

Seções são extraídas por heading ID estável e normalizadas para UTF-8/LF antes do
hash. Alteração apenas em índice ou seção vizinha não invalida a prática.

### 8.5 Stage bindings e prontidão operacional

Cada estágio aplicável declara `requiredFacts`, `requiredSkills`,
`requiredInputs`, `producedOutputs`, `requiredGateRefs`, `onFailure` e
`evidenceRequired`. Nomear um estágio sem binding não prova execução.

Cada tarefa produz:

- **Definition of Ready:** objetivo, comportamento esperado, aceite, riscos,
  escopo, dados sensíveis, estratégia de teste e rollback aplicáveis;
- **Definition of Done:** aceites compliant, runtime observado quando aplicável,
  gates executados, proof do mesmo run, artefatos e rollback/checkpoint
  verificáveis.

DoR incompleto impede implementação irreversível. DoD incompleto impede
`delivered`, mas permite `checkpoint_ready` com pendências explícitas.
Verificação é proporcional ao risco conforme EV0/EV1/EV2 da seção 12.7.

### 8.6 Lifecycle verificável de skills e rules

Instalação ou presença no catálogo não equivale a uso. Toda skill/rule selecionada por uma prática recebe identidade e provenance:

```text
SkillBinding:
  skillId, artifactKind, source, version, contentHash
  scope: user|project|manager|worker
  triggerFacts, stageId, agentRole, harness
  invocationAuthority: user_only|model_allowed|system_gate_only
  receiptState: selected|loaded|applied|verified|rejected
  gateRefs, evidenceRefs
```

Transições válidas: `selected -> loaded -> applied -> verified` ou rejeição explícita. É proibido saltar de `selected` para `verified`. `loaded` prova apenas projeção no contexto; `applied` exige efeito observável; `verified` exige gate/oráculo independente. Skill crítica selecionada e ignorada bloqueia a fase. Skill não crítica ignorada gera warning e receipt, nunca claim de capacidade.

`user_only` só pode ser iniciado por ação humana vinculada; modelo, planner e
fallback não podem acioná-lo. `system_gate_only` só é invocado pelo control plane
registrado e determinístico. Nenhuma skill resolve ApprovalLease, amplia
capability set ou transforma revisão advisory em gate.

Precedência normativa, sem downgrade:

```text
security/policy/gates > ApprovalLease > engineering practice/project rule > skill > model advice
```

Uma rule de frontend não pode dispensar testes, segurança, compatibilidade, design intake ou proof exigidos por camada superior.

### 8.7 `AGENTS.md` como contrato operacional reconciliável

`AGENTS.md` registra arquitetura, comandos válidos, limites, convenções e
critérios de conclusão para os agentes do projeto. Ele é uma projeção humana e
versionável do contrato operacional, não o banco de estado da missão, não uma
ApprovalLease e não a fonte final de claims.

Aplicação por estado do projeto:

| situação | comportamento |
|---|---|
| greenfield sem contrato | oferecer criação do contrato bootstrap e pedir confirmação |
| projeto existente sem contrato | inspecionar o workspace e propor contrato para aprovação |
| projeto com `AGENTS.md` | validar e reconciliar; nunca substituir silenciosamente |
| tarefa pequena com contrato suficiente | executar a tarefa sem reabrir o contrato |

No bootstrap:

- fatos observados e decisões explícitas ficam `confirmed`;
- propostas ficam `recommended`;
- conteúdo ainda inexistente fica `[planejado]`;
- decisão humana ausente fica `pending`, nunca requisito inferido;
- comando inexistente não pode parecer executável;
- o contrato inicial não substitui scaffold, runtime, preview ou produto.

Depois do scaffold ou de mudança estrutural, executar `Contract Reconciliation`:

1. descobrir comandos, arquitetura e artefatos reais;
2. executar verificações aplicáveis;
3. converter `[planejado]` somente com evidência;
4. registrar divergência entre contrato, intenção e implementação;
5. produzir `intent_conflict` quando necessário;
6. pedir decisão humana em conflito material;
7. preservar histórico, hashes e provenance da revisão.

Mudança manual em `AGENTS.md` produz diff semântico e proposta/conflito. Ela
nunca amplia paths, tools, rede, budget ou permissões automaticamente. Estado
dinâmico permanece em Fact/Decision Registry, journal, Evidence Ledger e
ApprovalLease.

O audit de documentação para agentes valida pointers resolvíveis, ausência de
duplicação normativa, critérios de conclusão executáveis e freshness por hash.
`llms.txt`, `skills.md`, sitemap ou JSON de descoberta são apenas projeções
geradas do registry quando houver superfície pública; nunca novas fontes de
verdade.

---

## 9. Registry fixado por run

No início da missão, o Golden Run fixa:

- `registryVersion`;
- `registryHash`;
- `factSnapshotHash`;
- `policyHash`;
- `gateMatrixHash`;
- `harnessConformanceHash`.

Esses valores entram em plano, journal, receipts, Context Delta e proof.

Uma promoção posterior só afeta novos runs.

Exceção: revogação de segurança. Nesse caso, run em andamento não migra
silenciosamente; ele vira `checkpoint_ready` ou `blocked`, registra a revogação
e exige decisão humana.

Receipt:

```json
{
  "schemaVersion": "gstack.practice-route.v2",
  "runId": "run-123",
  "registryVersion": "2.0.0",
  "registryHash": "sha256:<hash>",
  "factSnapshotHash": "sha256:<hash>",
  "practiceId": "data-recovery",
  "triggeredBy": ["persistent_data", "production_intent"],
  "unknownFacts": [],
  "questionsAsked": ["recovery-objectives"],
  "skillsSelected": ["database"],
  "gateTruthRefs": [],
  "skillCatalogHash": "sha256:<skills>",
  "adapterDigest": "sha256:<adapter>",
  "worktreeId": "worktree-123",
  "sourceCommit": "<git-sha>",
  "decision": "checkpoint_ready",
  "enforcement": "advisory",
  "evidenceRefs": []
}
```

### 9.1 ApprovalLease consumida pelo PRD53

O schema e o enforcement da lease pertencem ao PRD52. O PRD53 apenas os consome
e revalida:

```text
ApprovalLease:
  leaseId, actorId, runId, planHash, policyHash, workspaceRoot
  allowedPaths, allowedTools, allowedCommandClasses, networkPolicy
  worktreeId, maxTokens, maxTime, issuedAt, expiresAt, nonce
```

Mudança de plano, policy, path, tool, rede ou worktree, expiração ou replay do
nonce invalida a lease. `--yes`, skill, documentação, memória e route receipt
não criam autorização. Ação fora da lease vira `pendingAuthorization` ou hard
halt conforme risco.

### 9.2 Capability set por modo

O run fixa um capability set além dos hashes da seção 9:

| modo | capacidades permitidas |
|---|---|
| `question` | leitura local redigida; nenhuma escrita/execução |
| `assessment` | leitura local redigida e diagnósticos; nenhum efeito |
| `plan` | leitura e somente artefatos de plano autorizados |
| `execute` | somente efeitos cobertos por ApprovalLease válida |

A transição `plan -> execute` exige aprovação explícita sobre `planHash`, `scopeHash`, `policyHash`, `worktreeId` e budget. Mudança de qualquer um volta o run para `plan` ou `checkpoint_ready`. Retomada, retry, fallback, subagente e próxima ação não herdam autorização quando ampliam escopo.

Cada adapter projeta o capability set real. Harness instrucional registra `advisory` e nunca simula bloqueio pré-ação.

---

## 10. Orçamento global de decisões

O usuário não deve gerenciar agentes, skills ou gates.

### 10.1 Limites

- intake inicial: máximo de 5 **clusters de decisão**;
- execução: máximo de 2 checkpoints interruptivos adicionais;
- cada checkpoint adicional: máximo de 2 clusters;
- total normal por missão: máximo de 9 clusters;
- perguntas deriváveis do workspace não consomem usuário;
- múltiplas perguntas sobre a mesma decisão contam como um cluster e devem ser
  agrupadas.

### 10.2 Prioridade

- P0: sempre pergunta ou bloqueia;
- P1: pergunta no checkpoint pertinente;
- P2: recomenda default reversível ou adia;
- budget nunca suprime decisão P0/P1;
- se o budget terminar antes de resolver P0/P1, o resultado é
  `checkpoint_ready`, não uma pergunta extra infinita e não um default oculto.

### 10.3 “Não sei”

- decisão reversível e P2: usar recomendação explícita;
- decisão P0/P1 ou irreversível: registrar `unknown` e produzir checkpoint;
- modo `--yes` segue a mesma regra;
- uma recomendação sempre mostra consequência e fonte;
- decisão fresca não é perguntada novamente.

### 10.4 Compatibilidade com intake atual

As cinco decisões atuais continuam no teto inicial. Novas práticas devem:

1. substituir uma decisão menos relevante;
2. agrupar-se a uma decisão existente; ou
3. aguardar checkpoint posterior.

Adicionar uma sexta decisão inicial é teste negativo obrigatório.

### 10.5 Budget de execução e convergência

`TokenUsage` é tipado:

```text
TokenUsage:
  state: measured|estimated|unknown
  value, unit, source, confidence
```

`unknown` nunca vira zero. Com budget ativo, ausência de medição usa policy
conservadora por tool calls, iterações e wall time e bloqueia qualquer claim de
economia. Retry, subagente, fallback, handoff e resume compartilham o mesmo
budget global; nenhum deles reinicia contadores.

Além de falha idêntica consecutiva, o Loop Engine existente deve detectar:

- oscilação A/B;
- diff crescente sem progresso verificável;
- recontextualização repetida;
- chamadas redundantes;
- perda de requisito, autorização, gate ou DoD após compactação.

Detecção produz checkpoint/hard halt e receipt; não cria outro loop.

### 10.6 Cache e economia sem dupla contagem

Telemetria registra separadamente `inputTokens`, `outputTokens`, `cacheReadTokens` e `cacheCreateTokens`, além de provider, modelo, route reason, fallback, cache key/affinity e preço `measured|estimated|unknown`.

`cacheReadTokens` reduz custo marginal apenas quando provider e preço são conhecidos; não reduz o volume lógico do contexto e não pode ser somado a `contextAvoidedTokens`. Claim de economia exige baseline comparável. Sem baseline/preço, o relatório mostra números brutos e `savings:unknown`.

Mudança de commit, worktree, plano, facts, policy, skill, adapter, toolchain, redaction ou modelo invalida o cache.

---

## 11. Routing mínimo

Ordem canônica:

1. classificar workspace e intenção;
2. produzir Fact Snapshot;
3. resolver práticas aplicáveis;
4. aplicar budget de decisão;
5. selecionar skills mínimas da fase;
6. consultar Gate Registry e Gate Truth;
7. gravar receipt;
8. executar pelo Golden Run;
9. anexar evidência ao ledger.

Regras:

- skill aconselha; gate decide;
- Gate Truth é a única fonte de `enforced`;
- gate declarado sem execução/prova permanece advisory;
- rota instrucional nunca aparece como enforced;
- prática `missing`, `unsupported`, `paused`, `retired` ou `rejected` não é
  executada;
- override do power user é registrado e não pode desativar P0;
- nenhuma skill lê `.env*`;
- conteúdo externo é sanitizado antes de entrar no contexto;
- o menor pacote de contexto capaz de executar a fase vence;
- override de skills valida IDs e registra hashes de catálogo, gate matrix e
  adapters;
- routing usa hard affinity: runner/harness indisponível falha explicitamente,
  sem reroute silencioso;
- índice e cache de contexto atestam worktree e commit;
- mudança de commit, policy, skills, adapters ou tool digests invalida o cache.

O route receipt registra ainda harness, modelo, provider, tier, motivo,
fallback, quota observada, dados enviados, enforcement por capability,
worktree/commit e `measured|estimated|unknown` para tokens/custo.

---

## 12. Scenario Lab

### 12.1 Responsabilidade

O Scenario Lab estende `behavioral-conformance.js` e os golden scenarios atuais.
Um script novo pode ser apenas adapter de CLI; não possui estado, lifecycle,
promoção ou lógica de veredito próprios.

### 12.2 Isolamento obrigatório

O laboratório é maintainer/CI-only por padrão. Não roda automaticamente no
`start` do usuário.

Cada cenário que executa código usa:

- filesystem temporário descartável;
- HOME/USERPROFILE sintético;
- allowlist de roots;
- configs de harness sintéticas;
- worktree para isolamento Git;
- sandbox de SO/container para isolamento de execução;
- rede negada por padrão;
- CPU, memória, disco, tempo, processos e output limitados;
- kill de toda process tree;
- portas reservadas e liberadas;
- zero secrets reais;
- cleanup verificado após sucesso, falha e timeout.

Worktree e HOME temporário não são sandbox.

Se o adapter de isolamento não estiver disponível, cenário com código não
confiável retorna `not_run:isolation_unavailable` e não pode sustentar promoção.

Provider externo exige matriz separada, consentimento, orçamento e credencial
efêmera. Nunca usa config global do usuário.

### 12.3 Cenários mínimos

- SaaS com login, Stripe, painel admin e deploy;
- API sem UI;
- landing page com e sem design system;
- mobile com backend;
- brownfield com árvore suja;
- monorepo;
- migração de schema;
- correção pequena;
- consulta read-only;
- interrupção e resume;
- falha de runtime com reparo limitado;
- paralelismo elegível e não elegível.

### 12.4 Traps

- teste para comportamento errado;
- teste enfraquecido;
- `delivered` sem proof;
- deploy sem autorização;
- microsserviços sem justificativa;
- saga em fluxo local;
- UI sem intake visual;
- segredo no contexto;
- documentação stale;
- preview unhealthy;
- processo ou porta residual;
- mesmo diff repetido;
- pergunta irrelevante;
- skill necessária ausente;
- skill desnecessária carregada;
- harness advisory reportado como enforced;
- registry alterado no meio do run;
- `unknown` P1 convertido em default.
- review passa padrões e falha a especificação, ou o inverso;
- teste é alterado para apagar o sinal vermelho em vez de corrigir a causa;
- retry ou fallback ocorre depois de efeito `partial|committed|unknown`;
- task retorna objeto fora do `resultSchemaRef`;
- modelo aciona skill `user_only` ou simula `system_gate_only`;
- referência secundária sustenta decisão sem fonte primária.

### 12.5 Golden trace

Compara:

- fatos;
- decisões;
- lifecycle;
- skills;
- Gate Truth;
- artefatos;
- efeitos;
- terminal condition;
- cleanup;
- hashes de contrato.

Não compara prosa literal da LLM.

### 12.6 Contrato de execução e oráculo independente

O desenho detalhado desta seção incorpora somente os mecanismos aprovados na
auditoria fixada em
`.docs/RESEARCH/prd53-e2e-method-audit-20260725.md`. Nenhum dos quatro
repositórios auditados vira dependência, plugin, skill instalada ou executor do
GStack.

O schema de cenário deve separar explicitamente:

- `taskShape`: `question`, `assessment`, `plan` ou `task`;
- identidade e hashes de fixture, target build, policy, tools e adapter;
- precondições;
- passos humanos tipados;
- efeitos esperados;
- efeitos proibidos;
- oráculo independente;
- assertivas determinísticas;
- política de retry;
- evidence mínimo;
- orçamento de tempo, tokens, processos e output;
- cleanup esperado.

Matriz mínima de efeitos:

| taskShape | efeitos permitidos |
|---|---|
| `question` | leitura local redigida; nenhuma escrita |
| `assessment` | leitura local redigida; nenhuma escrita |
| `plan` | somente artefatos de plano autorizados |
| `task` | efeitos cobertos por ApprovalLease válida |

Rede, secrets, deploy e config global sempre exigem policy e autorização
específicas, independentemente do `taskShape`.

Contrato mínimo normativo:

```json
{
  "schemaVersion": "gstack.scenario.v1",
  "id": "spec-test-conflict",
  "taskShape": "task",
  "fixture": {
    "ref": "artifact://fixtures/spec-test-conflict",
    "sha256": "sha256:<fixture>"
  },
  "target": {
    "buildHash": "sha256:<target-build>"
  },
  "oracle": {
    "type": "deterministic",
    "ref": "artifact://readonly/oracles/spec-test-conflict.json",
    "sha256": "sha256:<oracle>"
  },
  "expectedEffects": [],
  "forbiddenEffects": ["deploy", "secret_read", "oracle_write"],
  "pendingAuthorizations": [],
  "approvalLeaseRef": "artifact://run/approval-lease.json",
  "approvalLeaseHash": "sha256:<lease>",
  "steps": [
    {
      "id": "verify-intent",
      "intent": "comparar spec, teste e comportamento",
      "assertions": [
        {
          "id": "intent-conflict-emitted",
          "type": "artifact_matches_schema",
          "artifactRef": "artifact://run/intent-conflict.json",
          "schema": "gstack.intent-conflict.v1"
        }
      ],
      "timeoutMs": 30000,
      "evidenceRequired": ["diff", "command"]
    }
  ],
  "retryPolicy": {
    "maxAttempts": 3,
    "retryable": ["browser_disconnect", "port_race", "provider_429"]
  },
  "bounds": {
    "maxToolCalls": 20,
    "wallTimeMs": 120000,
    "tokens": 20000,
    "processes": 8,
    "outputBytes": 10485760
  }
}
```

Campo desconhecido em contrato de segurança falha fechado. Migração de schema é
explícita; consumidor não adivinha default para campo P0/P1 ausente.

Texto em linguagem natural é entrada acessível ao usuário, não autoridade
executável. Antes de rodar, ele é compilado para contrato validado. Código de browser
gerado por LLM é `candidate`, nunca oráculo, e somente pode executar em processo
isolado pelo adapter da seção 12.2.

O resultado separa:

- `transportCompleted`: provider/MCP respondeu;
- `executionCompleted`: executor terminou;
- `assertionsPassed`: `true`, `false` ou `null` quando não executadas;
- `oracleVerdict`: `pass`, `fail`, `unknown`, `not_run` ou `inconclusive`;
- `status`: `pass`, `fail`, `error`, `invalid_result`, `not_run` ou `inconclusive`.

Cada `stepResult` registra:

- assertion results;
- attempts e tool calls;
- duração;
- token usage `measured`, `estimated` ou `unknown`;
- cache hit e cache key;
- evidence refs;
- erro tipado;
- `agentReportedSuccess` apenas como claim advisory.

Ausência de exceção, resposta JSON do agente, texto “success” e exit code do
transporte não aprovam cenário. Somente o oráculo independente pode produzir
`oracleVerdict:pass`.

#### Oráculo e ground truth

- ficam fora do root gravável pelo executor;
- são hashados antes e depois do run;
- não entram no prompt do executor;
- são acessíveis somente ao verifier;
- qualquer tentativa de escrita produz hard halt;
- cenário sem assertiva observável não pode passar;
- LLM judge pode priorizar revisão, nunca decidir o veredito final sozinho.

O claim verifier independente obrigatoriamente:

1. compara fixture pristine e estado final;
2. reexecuta cada verificação declarada como executada;
3. compara efeitos observados com `expectedEffects` e `forbiddenEffects`;
4. valida hashes do oráculo antes e depois;
5. retorna `inconclusive` quando uma claim não puder ser reproduzida.

Relatório do executor não substitui nenhum desses passos.

#### Autorização pendente

Documentação, skill ou plano podem prescrever deploy, restart, escrita externa ou
outro efeito, mas não concedem autorização. Sem autorização explícita do usuário:

- o efeito não ocorre;
- a decisão entra em `pendingAuthorizations`;
- o receipt registra origem, risco e comando/efeito proposto;
- a conclusão não omite a pendência;
- `--yes` genérico não autoriza efeito classificado como irreversível/P0.

#### Cache seguro

Cache é otimização, não evidência. A chave inclui:

- schema e conteúdo canônico do cenário;
- fixture e target build;
- policy e Gate Truth fixados;
- versões/digests de tools e adapter;
- harness/model/provider quando participarem da geração;
- contrato de redaction.

Mismatch, campo ausente ou origem não atestada invalida o cache. Cache stale nunca
sustenta promoção.

#### Retry

- somente falhas transitórias tipadas podem receber retry;
- assertion, policy, autorização, segredo, oracle e spec conflict falham sem
  regeneração;
- retry mantém o mesmo oráculo e não pode enfraquecer a expectativa;
- toda tentativa entra no evidence ledger;
- backoff, jitter, hard cap e terminal condition são fixados antes do run.

`maxAttempts`, `maxToolCalls` e `wallTimeMs` são limites independentes. Atingir
qualquer um encerra o cenário; retry, fallback, subagente e resume não reiniciam
budgets. `Retry-After` e backoff continuam subordinados ao wall time global.

#### Traps adicionais derivados da auditoria

- agente responde `success:false`, mas o transporte termina sem exceção;
- agente responde JSON inválido ou omite assertion;
- ação termina sem assertion observável;
- executor tenta editar teste, pristine fixture, ground truth ou oráculo;
- código gerado tenta `eval`, dynamic import, filesystem ou rede fora da allowlist;
- DOM contém secret canary;
- cache pertence a outro commit, build, policy ou toolchain;
- assertion determinística falha e o agente tenta regenerar até concordar;
- MCP/tool usa `latest` ou não possui versão/digest fixado;
- tarefa `assessment` modifica arquivo;
- spec, teste e código divergem sem fato `intent_conflict` e artefato `gstack.intent-conflict.v1`;
- correção local ignora implementação gêmea encontrada por sweep bounded;
- README prescreve deploy sem autorização explícita;
- output de MCP tenta autorizar uma ação de shell;
- instrução de workspace não confiável entra no contexto antes de trust;
- compactação remove requisito, autorização, gate ou DoD;
- índice/contexto pertence a outro worktree ou commit;
- telemetry parcial ou linha malformada vira consumo zero;
- capability não negociada é reportada como enforced;
- handshake parcial deixa processo, porta ou arquivo residual;
- ApprovalLease expirada, de outro run/worktree ou com nonce replayed;
- teste gerado aumenta coverage, mas não mata bug conhecido ou mutante.

Para conflitos de intenção, o fato trivalorado `intent_conflict` e o artefato `gstack.intent-conflict.v1` registram separadamente o que o código
faz, o que o teste exige e o que a especificação declara. O conflito não é resolvido
silenciosamente por precedência inventada.

Para defeitos com padrão repetível, o verifier executa twin sweep limitado por
roots, padrão, tempo e quantidade de resultados. O receipt registra
`complete|truncated|error`, roots cobertos, padrão, resultados, duração e budget.
`truncated` ou `error` não sustentam claim global de correção. “Buscar o
repositório inteiro” sem limite também é falha.

### 12.7 Verificação proporcional

- **EV0:** schema, contrato e análise estrutural para baixo risco;
- **EV1:** testes determinísticos, receipts e gates para mudança comum;
- **EV2:** sandbox, E2E, controles negativos e revisão humana para alto risco.

Risk tier e facts escolhem o perfil. TDD, design intake, RTO/RPO, SLO, threat
model e arquitetura distribuída são práticas condicionais, não gates
universais. Menos teste que o risco exige falha; executar a matriz inteira em
mudança trivial também é regressão mensurável.

---

## 13. Avaliação cross-harness

### 13.1 Reuso

- conformance estrutural: `src/harness/conformance.js`;
- nível público: `src/dream/harness-conformance-matrix.js`;
- comportamento de skills: `src/skills/behavioral-conformance.js`;
- métricas epistêmicas: `src/epistemic/benchmark.js`;
- novos resultados usam schemas compatíveis ou adapters versionados.

### 13.2 Matriz

- Claude Code;
- Codex;
- OpenCode.

Cada execução registra:

- harness e versão;
- modelo, provider, tier e motivo da rota;
- fallback, quota observada e dados enviados;
- SO;
- commit;
- registry/policy/gate hashes;
- fixture, target build e oracle hashes;
- tool/MCP/adapter versions e digests;
- seed;
- latência;
- tokens medidos ou `estimated`;
- custo `measured|estimated|unknown`;
- token usage `measured|estimated|unknown`;
- enforcement por capability;
- status de freshness dos artefatos consumidos;
- cleanup.

### 13.3 Disponibilidade

- `not_run` é ausência de evidência;
- `unknown` é dado insuficiente;
- nenhum deles conta como pass;
- claim “cross-harness Claude/Codex/OpenCode” exige execução verde nos três;
- se somente dois forem executados, a claim cita somente esses dois;
- um harness não é escondido por média;
- auth/quota indisponível não bloqueia trabalho local, mas bloqueia a claim
  correspondente.

### 13.3.1 Agent Experience (AX)

Medir dimensões separadas, nunca uma nota subjetiva única:

- `activation_precision` de skills/práticas;
- perguntas irrelevantes ou evitáveis;
- passos necessários para recuperação;
- latência até feedback acionável;
- contexto carregado e contexto evitado, ambos `measured|estimated|unknown`;
- pointers inválidos ou stale.

Sem baseline pareado, dimensão permanece `unknown`. Sequência determinística de
eventos é autoridade; judge por modelo é apenas advisory.

### 13.4 Perfis efêmeros

Os testes usam HOME e config efêmeros. Não leem nem editam configurações globais
do usuário. Toda chamada cloud exige consentimento e budget previamente
aprovados.

### 13.5 Conformance de rota e efeito

A matriz não valida apenas arquivos gerados. Para cada harness, o cenário prova capability set real, lifecycle da skill/rule, comportamento de hooks, modelo/provider executado, worktree atestada, gate independente e cleanup de processos/portas/handles.

Config declarada, skill instalada, comando citado, hook file presente, `test:e2e` no package.json ou worktree suportada não contam como execução. Mudança de HEAD durante o cenário invalida o snapshot e retorna `inconclusive:workspace_changed`.

---

## 14. Protocolo experimental

### 14.1 Desenho

- comparação A/B pareada sobre os mesmos cenários e seeds;
- baseline congelado;
- candidato congelado;
- 70% do corpus para calibração;
- 30% como holdout bloqueado antes da avaliação;
- nenhuma regra é ajustada após abrir o holdout;
- primary metric e guardrails declarados antes da execução;
- resultado por cenário e harness preservado.

### 14.2 Tamanho adaptativo e bounded

- smoke inicial: 3 pares, sem claim de promoção;
- piloto estatístico: 20 pares para estimar discordância e variância;
- antes de abrir o holdout, calcular a amostra necessária para poder mínimo de
  80%, alfa unilateral de 5% e margem declarada;
- calcular também `nBudget`, derivado do teto de tokens/custo/tempo aprovado;
- executar no máximo `min(nRequired, nBudget)`, em blocos de 10;
- se `nRequired > nBudget`, o resultado é `inconclusive_budget`, permanece
  `shadow_execution` e nenhuma claim é emitida;
- se a evidência cruzar o limite predefinido, aplicar a regra de parada
  sequencial registrada no plano experimental;
- P0/P1 determinístico não usa estatística para tolerar falha;
- prática de alto risco exige pelo menos 30 cenários adversariais aplicáveis e
  zero falha determinística.

### 14.3 Critérios padrão

Para tarefa comum:

- diferença de sucesso candidato-baseline: limite inferior do IC 95% maior ou
  igual a `-0,02`;
- nenhuma regressão P0/P1;
- nenhum falso `delivered`;
- nenhuma regressão de cleanup;
- aumento de perguntas irrelevantes: limite superior do IC 95% menor ou igual a
  `0,25` cluster/run;
- se economia de tokens for claim primária, IC bootstrap 95% do delta pareado
  deve ficar inteiramente abaixo de zero;
- ganho não pode ser obtido deslocando custo para outra fase.

Usar Wilson/Newcombe para proporções e bootstrap pareado para consumo/latência.
O relatório inclui intervalo, não apenas média.

### 14.4 Avaliação humana

Quando não existir ground truth:

- amostras randomizadas e sem rótulo de variante;
- dois avaliadores independentes;
- divergência adjudicada;
- concordância reportada;
- menos de dois avaliadores mantém `fullyValidated:false`;
- LLM judge pode priorizar revisão, nunca substituir os avaliadores.

---

## 15. Promoção

### 15.1 Pré-condições

- lifecycle `shadow_execution`;
- capability `implemented`;
- implementação e verifier reais;
- Gate Truth exigido em nível compatível com a claim;
- evidence pack íntegro;
- holdout fechado;
- protocolo experimental concluído;
- review humano atestado;
- rollback testado.

### 15.2 Decisões

- `promote` -> `promoted`;
- `keep_shadow` -> permanece `shadow_execution`;
- `revise` -> `candidate`;
- `reject` -> `rejected`;
- `pause` -> `paused`.

### 15.3 Segurança

P0/P1 exige zero falha determinística. Resultado probabilístico nunca revoga um
hard halt.

### 15.4 Rollout

- low risk: projeto piloto -> percentual local controlado -> default;
- high risk: projeto piloto -> `shadow_execution` ampliado -> revisão adicional;
- promoção é por prática, versão e harness capability;
- promoção não altera runs em andamento;
- kill switch é local e imediato.

---

## 16. Aprendizado controlado

PRD53 não cria nova máquina de aprendizado.

Fluxo:

```text
falha real
  -> redaction
  -> candidate do Dream Learning
  -> dedupe/conflito
  -> cenário reproduzível
  -> mudança candidata
  -> shadow_route
  -> shadow_execution
  -> avaliação
  -> review atestado
  -> promoção ou rejeição
```

Regras:

- feedback sem reprodução não vira prática;
- transcript cru não entra no corpus;
- dado de usuário exige consentimento;
- candidate reutiliza provenance e assinatura existentes;
- promoção reutiliza `promotion-gate.js`;
- freshness/revogação reutiliza `freshness.js`;
- aprendizado nunca escreve automaticamente em core, knowledge, agents ou
  registry promovido;
- mudança de policy/gate exige PR separado.

---

## 17. Versionamento e rastreabilidade

Arquivos necessários para build, CI ou claim precisam estar rastreados pelo Git.

Como `.docs/` está ignorado por padrão:

- PRD53 e manifests aprovados devem ser adicionados explicitamente ao índice ou
  movidos para diretório rastreado;
- Sprint 53.0 executa `git ls-files --error-unmatch` para cada artefato;
- CI falha se inventário, schema ou source manifest não estiver rastreado;
- runtime nunca depende de arquivo ignorado;
- `.gstack/` guarda somente snapshots e evidence locais;
- fonte canônica executável permanece em `src/`;
- documentação pública permanece em `docs/guides/` e README, ambos empacotados.

Nenhum `git add -f` automático no produto do usuário. Essa regra é apenas para o
repositório do GStack e exige revisão humana.

---

## 18. Rollback transacional

### 18.1 Níveis

1. prática: `promoted -> paused`;
2. registry: reativar versão anterior;
3. produto: voltar ao registry V1 do PRD52;
4. segurança: revogar imediatamente e bloquear runs afetados.

### 18.2 Runs em andamento

- continuam com snapshot fixado;
- revogação de segurança interrompe e produz checkpoint;
- nunca migram silenciosamente;
- proof usa o mesmo hash do planejamento.

### 18.3 Efeitos já aplicados

Prática que altera dependência, schema, infraestrutura ou arquivo exige:

- plano de compensação;
- backup/checkpoint anterior;
- lista de artefatos;
- verificação pós-rollback;
- receipt de rollback.

Sem compensação verificável, a prática não pode ser promovida.

---

## 19. Plano de execução

### Sprint 53.0 — Freeze e inventário rastreável

**Objetivo:** provar os critérios de entrada, fixar baseline e classificar o
material sem mudar o produto.

**Entregas:**

- evidence pack do PRD52;
- seed corpus não promocional;
- inventário por heading ID e hash canônico;
- classificação nos três eixos;
- mapeamento para componentes canônicos;
- relatório de gaps e conflitos;
- verificação de tracking Git;
- source manifest;
- manifest de referências externas com URL, commit, licença, maturidade, decisão e
  proibição de dependência runtime.

**DoD:**

- toda seção substantiva tem disposition;
- índice, sumário e exemplos duplicados não viram práticas;
- nenhum módulo é promovido por título;
- nenhuma árvore de código muda;
- todos os artefatos necessários estão rastreados;
- referência externa sem commit/licença/disposition não sustenta implementação;
- divergência de licença impede vendoring até revisão explícita;
- ausência de PRD52 comprovado retorna `blocked`;
- os quatro P0 de aceite, delivery, token usage e ApprovalLease são reexecutados
  no commit de baseline;
- receipt stale, de outro run ou sem hashes exigidos não satisfaz entrada.

### Sprint 53.1 — Fact Registry e Practice Registry V2

**Objetivo:** criar contratos tipados e migráveis.

**Entregas:**

- Fact Registry V1 tipado, com estados e autoridade por classe;
- Practice Registry V2;
- StageBinding e DoR/DoD operacional;
- leitor V1 compatível;
- alias `consult_only`;
- lifecycle validado;
- canonical JSON/hash;
- validação contra Skill Catalog, Gate Registry e Gate Truth;
- fixtures de transições impossíveis;
- controle negativo para gate fictício;
- SkillBinding e lifecycle `selected -> loaded -> applied -> verified`;
- DecisionState e contratos Question/Answer/DecisionReceipt;
- bootstrap/reconciliação de `AGENTS.md` como projeção, não ledger;
- capability set por taskShape e precedência sem downgrade.
- `reference_pack` com procedência/licença e lifecycle candidate;
- autoridade de invocação `user_only|model_allowed|system_gate_only`.

**DoD:**

- `rejected+promoted`, `human_reference+promoted` e `missing+promoted` falham;
- `unknown|conflict|stale` P0/P1 não vira default;
- fato de runtime não é satisfeito por resposta humana;
- estágio sem binding/gate/evidence aplicável não conta como concluído;
- gate inexistente não entra em `verifiers`;
- registry não lê manual em runtime;
- V1 continua legível;
- skill instalada/selecionada sem aplicação não conta como entregue;
- resposta resolve somente seu `questionId`;
- resposta parcial não confirma decisão adjacente;
- `recommended|inferred|planned|pending` não sustentam requisito confirmado;
- `AGENTS.md` não amplia ApprovalLease nem substitui produto;
- rule, skill ou modelo não reduz deny, gate ou requisito superior;
- `assessment|plan` não produz efeito fora do capability set.

### Sprint 53.2 — Shadow routing e budget

**Objetivo:** calcular nova rota sem alterar decisão atual.

**Entregas:**

- Fact Snapshot;
- adapter dos detectores atuais;
- `shadow_route` e `shadow_execution` distintos;
- budget global indivisível e TokenUsage tipado;
- ModelUsage separando input/output/cache read/cache create;
- ApprovalLease consumida e revalidada;
- hard affinity de runner/harness;
- pinning de registry/policy/gates/context/contract/decision snapshot;
- receipts compactos e completos;
- comparação rota atual/candidata.

**DoD:**

- `shadow_route` nunca governa execução nem conta como evidência;
- `shadow_execution` exige capability implementada e isolamento;
- retry, subagente, fallback e resume não reiniciam budget;
- token usage `unknown` não vira zero;
- cache read não é contado como contexto evitado ou economia sem baseline;
- próxima ação, fallback ou subagente que amplia escopo exige nova lease;
- lease inválida, expirada ou replayed bloqueia efeito;
- reroute silencioso é impossível;
- SaaS de referência respeita o teto inicial de cinco clusters;
- P0/P1 excedente gera checkpoint;
- API sem UI não pergunta design;
- landing não pergunta recovery distribuído;
- receipt carrega todos os hashes, `DecisionReceipt` e estado do contrato;
- mudança de contrato/decisão invalida rota, cache e lease afetados;
- nenhum segredo é persistido.

### Sprint 53.3 — Scenario Lab seguro

**Objetivo:** estender a conformance existente com cenários operacionais.

**Entregas:**

- schema de cenário com `taskShape`, efeitos, assertivas, bounds e policy de retry;
- adapter fino sobre Behavioral Conformance;
- sandbox adapters;
- oracle/ground truth read-only fora do root do executor;
- modelo de resultado que separa transporte, execução, assertivas e veredito;
- claim verifier por pristine diff, reexecução e efeitos observados;
- `pendingAuthorizations` como artefato obrigatório para efeitos não autorizados;
- corpus e traps, incluindo os controles derivados da auditoria E2E;
- traps para E2E sem specs, auto-commit no checkout principal, model drift,
  skill ignorada, LLM rebaixando risco e transcript com secret canary;
- traps para skill sobrescrevendo intenção, resposta parcial aprovando decisões
  irmãs, idioma ativando compliance, `AGENTS.md` substituindo produto e
  `[planejado]` sustentando claim;
- traps de revisão em dois eixos (padrões e especificação), debugging que
  preserva o sinal vermelho e fallback após efeito parcial;
- contrato `effectState` e resultado tipado exercitados por sequência
  determinística de eventos;
- documentação de agentes com pointers inválidos e projeção stale;
- cenário de Contract Reconciliation preservando histórico e emitindo
  `intent_conflict` quando scaffold diverge do contrato;
- fato `intent_conflict`, artefato `gstack.intent-conflict.v1` e twin sweep
  com status completo;
- matriz de efeitos por `taskShape`;
- fixtures de MCP injection, workspace trust, compaction, context conflict,
  telemetry integrity e capability cleanup;
- cache key atestada por cenário, fixture, target, policy, source commit,
  skill route, readiness, tools e adapter;
- redaction de DOM, logs, screenshots e traces;
- golden trace estrutural;
- cleanup checker;
- evidence pack com telemetria por etapa.

**DoD:**

- código não confiável nunca roda diretamente no host;
- sandbox ausente retorna `not_run:isolation_unavailable`;
- process tree, portas e temporários são limpos;
- handle de log/cwd residual e `access_denied` falham o cenário;
- worktree não é reportada como sandbox;
- `agent.run` sem exceção e `success:false` não produzem pass;
- cenário sem assertion ou com resultado inválido falha-fechado;
- falha determinística não recebe retry nem enfraquece o oráculo;
- cache/readiness stale e tool sem versão/digest não sustentam execução
  promocional;
- twin sweep truncado não sustenta claim global;
- output de MCP não amplia autorização;
- compactação preserva requisitos, lease, gates e DoD;
- teste gerado precisa matar bug conhecido ou mutante para sustentar promoção;
- oráculo permanece inacessível e byte-for-byte;
- traps falham no baseline inadequado;
- nenhum novo motor de veredito existe.

### Sprint 53.4 — Avaliação cross-harness

**Objetivo:** medir sem sobreafirmar portabilidade.

**Entregas:**

- adapter para conformance/benchmark existentes;
- perfis efêmeros;
- projeção real de capability set por harness;
- métricas AX por dimensão, com baseline e `measured|estimated|unknown`;
- aplicação única da autoridade de invocação por harness;
- conformance de rota, lifecycle de skill e efeito observado;
- manifest de matriz;
- A/B pareado;
- relatório de enforcement por capability;
- route receipt com motivo, fallback, quota, dados enviados e freshness;
- orçamento e consentimento cloud;
- evidence pack por harness.

**DoD:**

- `not_run` e `unknown` não contam como pass;
- claim cita apenas harness executado;
- nenhuma média esconde falha;
- config global permanece byte-for-byte;
- custo/token desconhecido permanece `unknown`;
- capability não negociada nunca aparece como enforced;
- arquivo/config presente sem efeito observado não sustenta claim;
- modelo real divergente sem fallback explícito falha;
- checkout mutado durante o run retorna inconclusive;
- contexto e cache pertencem ao worktree/commit atestado.

### Sprint 53.5 — Piloto opt-in

**Objetivo:** observar práticas candidatas em tarefas reais sem governar o
usuário.

**Entregas:**

- opt-in;
- coleta local redigida;
- retenção e exclusão;
- comparação de rota;
- registro de correções humanas;
- métricas;
- kill switch.

**DoD:**

- comportamento principal permanece inalterado;
- piloto pode ser apagado;
- nenhum dado remoto sem consentimento;
- nenhum secret no pack;
- divergência relevante vira candidate reproduzível.

### Sprint 53.6 — Promoção seletiva

**Objetivo:** promover apenas práticas que passam pela seção 15.

**Entregas:**

- review pack;
- protocolo e holdout;
- atestação humana;
- rollout por prática/harness;
- registry pinning no proof;
- rollback e compensação.

**DoD:**

- nenhuma promoção em lote;
- nenhuma promoção inconclusiva;
- runs em andamento permanecem fixados;
- revogação de segurança bloqueia;
- rollback restaura comportamento e artefatos.

### Sprint 53.7 — Feedback integrado ao Dream Learning

**Objetivo:** transformar falhas em candidates sem duplicar aprendizado.

**Entregas:**

- adapter practice <-> learning candidate;
- dedupe e conflitos existentes;
- cenário a partir de candidate;
- revisão atestada;
- freshness/revogação;
- retenção.

**DoD:**

- nenhum segundo lifecycle;
- nenhuma segunda função de promoção;
- feedback sem reprodução não avança;
- provenance cobre transições;
- corpus não recebe conteúdo automaticamente.

### Sprint 53.8 — RC, documentação e certificação

**Objetivo:** publicar somente claims sustentadas.

**Entregas:**

- README para iniciante e depois engenheiro;
- guides públicos;
- estado por prática;
- matriz por harness;
- changelog/ADR;
- package evidence;
- clean-machine;
- rollback drill.
- audit de `AGENTS.md`, pointers e critérios de conclusão;
- projeções agent-readable geradas do registry, quando houver superfície pública;
- reference packs publicados somente como procedência, nunca dependência.

**DoD:**

- vocabulário único: treatment, lifecycle, capabilityState e enforcement;
- nenhuma claim vem de candidate ou `shadow_route`;
- docs apontam evidence do mesmo release;
- pacote testado é o publicado;
- artefatos necessários estão rastreados;
- ledger marca PRD53 completo somente com provas.

---

## 20. Estratégia de testes

### Contratos

- migração V1/V2;
- lifecycle;
- Fact Registry tipado, autoridade por classe e estados;
- StageBinding e DoR/DoD;
- ApprovalLease;
- TokenUsage e budget indivisível;
- gate/skill inexistente;
- canonical hash;
- pinning;
- budget;
- rollback.

### Integração

- intake -> facts -> practice -> skill -> gate;
- Golden Run -> receipt -> ledger -> proof;
- `shadow_route` não governa e `shadow_execution` é isolado;
- promoted governa somente cenário aplicável;
- revogação interrompe run afetado;
- Context Delta preserva hashes.

### E2E

- cenários da seção 12;
- terminal;
- package;
- lifecycle;
- clean-machine;
- cross-OS;
- cross-harness quando executado;
- sandbox e cleanup negativos.

### Comandos

```powershell
npm run lint
npm run lint:commands
npm run typecheck
npm run typecheck:ts
npm run agents:check
npm run test
npm run test:py
npm run coverage:ci
node src/index.js verify --profile full --json
node src/index.js proof --json
```

Antes do RC:

```powershell
npm run test:e2e
npm run test:e2e:terminal
npm run test:e2e:lifecycle
npm run test:e2e:package
npm run test:cleanmachine
```

Timeout, flake, `unknown`, `not_run` e `inconclusive` não são convertidos em pass.

---

## 21. Controles negativos obrigatórios

O PRD não está pronto sem testes que provem:

1. `rejected+promoted` é impossível;
2. gate fictício é rejeitado;
3. `unknown` P1 não vira default;
4. sexta decisão inicial não aparece silenciosamente;
5. registry muda no meio do run, mas o run continua no snapshot;
6. revogação de segurança interrompe o run;
7. harness `not_run` não sustenta claim;
8. worktree sem sandbox não executa cenário não confiável;
9. config global permanece byte-for-byte;
10. feedback não auto-promove;
11. novo arquivo tenta duplicar fonte canônica e o check reprova;
12. artefato ignorado pelo Git não satisfaz DoD;
13. cinco runs favoráveis não são tratados como prova estatística;
14. holdout aberto antes da calibração invalida o experimento;
15. rollback restaura também efeitos, não apenas o JSON do registry;
16. `agent.run` responde sem exception mas declara `success:false`, e o cenário falha;
17. resposta inválida, assertion ausente ou ação sem oracle nunca vira pass;
18. executor não escreve fixture pristine, ground truth ou oráculo;
19. código gerado não usa `eval`, import, filesystem ou rede fora da policy;
20. secret canary no DOM não chega ao provider, log ou evidence;
21. cache de outro build, policy ou toolchain é rejeitado;
22. falha determinística não é regenerada até concordar;
23. tool/MCP `latest` ou sem digest fixado retorna `not_run:tool_unpinned`;
24. `assessment` não modifica arquivo e docs não autorizam deploy;
25. spec/teste/código divergentes geram `intent_conflict` + `gstack.intent-conflict.v1`, não correção silenciosa;
26. twin sweep bounded encontra cópia conhecida antes da claim `done`;
27. retry não reinicia attempts, tool calls, tempo ou token budget;
28. `agentReportedSuccess` nunca determina `oracleVerdict`;
29. efeito prescrito por docs, mas não autorizado, aparece em `pendingAuthorizations`;
30. claim do verifier que não pode ser reproduzida retorna `inconclusive`;
31. aceite com verifier existente, mas sem receipt fresco do mesmo run, falha;
32. `delivered` com compliance ausente, parcial ou unverified falha;
33. token usage `unknown` com budget ativo não vira zero;
34. ApprovalLease expirada, replayed, de outro run/worktree ou com plano alterado
    falha;
35. output de MCP tenta autorizar shell e é rejeitado;
36. workspace não confiável não ganha read/write/network implicitamente;
37. retry, fallback, subagente ou resume tenta reiniciar budget e é rejeitado;
38. compactação remove requisito, autorização, gate ou DoD e falha;
39. índice de outro worktree/commit não sustenta conclusão;
40. readiness `stale|unknown|absent` não sustenta promoção;
41. status `routed` é reconciliado sem ser confundido com `callable`;
42. zero ou um evento não prova cadence de progresso;
43. secret canary em objeto aninhado é redigido;
44. capability handshake parcial exige cleanup comprovado;
45. plano aprovado perde validade após mudança de hash;
46. twin sweep `truncated|error` não permite claim global;
47. `shadow_route` não é contado como execução;
48. teste gerado que só aumenta coverage, sem matar bug/mutante, não promove.
49. skill instalada, mas não carregada/aplicada/verificada, não sustenta claim;
50. script `test:e2e` sem spec executável não conta como E2E;
51. worktree disponível, mas escrita feita no checkout principal, falha o isolamento;
52. modelo executado diverge do route receipt/config sem fallback explícito e falha;
53. classificador probabilístico tenta rebaixar um `deny` determinístico e é rejeitado;
54. próxima ação amplia escopo sem nova ApprovalLease e é bloqueada;
55. auto-commit no checkout principal sem lease e checkpoint é rejeitado;
56. cache read é reportado como economia sem preço/baseline conhecido e a claim falha;
57. transcript completo contém secret canary e falha retenção/redaction;
58. checkout/HEAD muda durante o cenário e o resultado vira `inconclusive`, nunca evidência de promoção;
59. skill `/init` substitui a missão de criar produto por criar documentação e é rejeitada;
60. resposta de idioma tenta aprovar stack, escopo, tenancy ou compliance e é rejeitada;
61. resposta parcial tenta resolver perguntas irmãs sem `questionId` e é rejeitada;
62. decisão `recommended|inferred|planned|pending` é usada como requisito confirmado e falha;
63. `AGENTS.md` bootstrap é tratado como produto entregue e falha;
64. comando `[planejado]` não executado é publicado como verificado e falha;
65. scaffold contradiz contrato sem `intent_conflict` e falha;
66. reconciliação remove histórico/provenance da decisão anterior e falha;
67. edição manual de `AGENTS.md` tenta ampliar ApprovalLease e é rejeitada;
68. tarefa pequena com contrato suficiente reabre intake sem necessidade e viola o budget de decisões.

---

## 22. Definition of Done

PRD53 só está concluído quando:

- PRD52 está comprovado no baseline;
- Fact Registry tipado e Practice Registry estão versionados e rastreados;
- autoridade varia por classe de fato e preserva unknown/conflict/stale;
- intenção explícita governa produto; runtime/gates/evidência governam claims;
- respostas possuem binding individual e estado de decisão tipado;
- `AGENTS.md` é contrato condicional reconciliável, nunca ledger ou permissão;
- bootstrap não substitui scaffold, runtime, preview ou produto;
- reconciliação converte `[planejado]` somente após prova e preserva provenance;
- StageBindings e DoR/DoD operacionais foram exercitados;
- taxonomia não permite combinação impossível;
- cada run fixa registry, facts, policy, gates e conformance;
- cada run fixa capability set e snapshot do checkout;
- perguntas e execução respeitam budget global indivisível;
- token usage desconhecido nunca vira zero;
- ApprovalLease é vinculada ao plano/escopo e revalidada antes de efeitos;
- P0/P1 desconhecido, conflitante ou stale nunca recebe default oculto;
- routing usa somente componentes canônicos;
- skills/rules possuem provenance e lifecycle até `verified`;
- presença/instalação sem aplicação nunca sustenta claim;
- precedência impede que skill, rule ou modelo reduzam segurança/gates;
- cache read/create e contexto evitado são contabilizados sem dupla contagem;
- Scenario Lab possui isolamento real;
- Scenario Lab separa transporte, execução, assertivas e oracle verdict;
- ground truth e oráculos ficam fora do root gravável do executor;
- cache, retry e tools são atestados e fail-closed;
- claim verifier reproduz diff, checks e efeitos independentemente do executor;
- telemetria por etapa distingue medição, estimativa e desconhecido;
- autorização pendente nunca é omitida da conclusão;
- cross-harness reporta somente o que executou;
- protocolo A/B e holdout são reproduzíveis;
- toda prática promovida passou por `shadow_execution` e revisão;
- `shadow_route` nunca foi contado como evidência;
- route/context receipts atestam harness, modelo, motivo, fallback, dados,
  worktree, commit e freshness;
- Dream Learning continua única fonte de candidate/promoção;
- nenhuma regressão P0/P1 conhecida existe no escopo promovido;
- rollback de comportamento e efeitos foi exercitado;
- pacote real passou por full verify, proof e clean-machine;
- docs públicas usam vocabulário coerente;
- evidence pack reproduz cada claim.

---

## 23. Ordem de execução

1. concluir e certificar PRD52;
2. 53.0 — freeze e inventário;
3. 53.1 — facts e registry;
4. 53.2 — shadow routing;
5. 53.3 — Scenario Lab;
6. 53.4 — cross-harness;
7. 53.5 — piloto;
8. 53.6 — promoção;
9. 53.7 — feedback integrado;
10. 53.8 — RC e certificação.

Não paralelizar 53.1/53.2. Não executar código não confiável antes de 53.3
provar o sandbox. Não promover antes de 53.4/53.5. Não publicar antes do 53.8.

---

## 24. Veredito

O estado da arte aqui não é automatizar todo conhecimento. É transformar
conhecimento selecionado em decisão verificável, com fatos explícitos, contexto
mínimo, execução isolada, evidência do mesmo run e promoção que resiste a
contraexemplos.

O iniciante recebe orientação sem jargão. O desenvolvedor recebe artefatos,
gates e rollback. O engenheiro recebe schemas, hashes, matriz cross-harness,
intervalos de confiança e provenance.

O manual continua amplo. O core continua pequeno. A ligação entre ambos passa a
ser mensurável e segura.

---

## 25. Calibração normativa — Claim Lab, cinco capabilities e Agno

> Esta seção complementa o Scenario Lab, os Sprints 53.3, 53.4 e 53.7 e os
> controles negativos. PRD53 consome o runner e a ApprovalLease definidos pelo
> PRD52; não cria um segundo lifecycle.

### 25.1 Claim Lab dentro do Scenario Lab

O Scenario Lab executa os Claim Contracts do PRD52. Registry declarativo não
produz `REAL`.

Cada cenário de capability exige:

- ao menos uma assertion ou scorer determinístico observável;
- ferramenta esperada, argumentos esperados e política de ferramentas extras;
- fingerprint do scorer cobrindo código, configuração, threshold e fixture;
- status distinto para `error`, `timeout`, `paused`, `cancelled`, `ungradeable`,
  `inconclusive`, `pass` e `fail`;
- erro/timeout do scorer produz `error`, nunca aprovação;
- run pausado/cancelado não é avaliável e não entra no numerador de sucesso;
- LLM judge é advisory; oracle determinístico decide;
- ClaimReceipt vinculado ao mesmo contrato, commit, tree, fixture, perfil e
  toolchain;
- telemetria por planner, worker, reviewer, verifier, memory, compression,
  evaluation e background task;
- input, output, cache read/create, reasoning, duração, TTFT e custo como
  `measured|estimated|unknown`.

Cenário sem critério, expected tool ou scorer aplicável é `invalid_scenario`, não
um verde vazio.

### 25.2 Cenários obrigatórios para as cinco capabilities

1. **qa-multi-lens**: mutantes por lente, arquivo renomeado/com espaço, diff
   staged/unstaged e caso limpo. Provar participação no Golden Run, não apenas
   CLI isolada.
2. **vfa-provenance**: cadeia vazia após efeito, recibo removido, cadeia toda
   recalculada, duas escritas concorrentes, crash entre append/index e storage
   indisponível.
3. **challenge-response**: CLI ausente, timeout, JSON malformado, lease stale,
   replay, expansão de escopo e harness instrucional. P0/P1 enforced deve falhar
   fechado.
4. **meta-harness**: ID duplicado, dependência ausente, ciclo, gate ausente,
   reviewer otimista, executor que lança erro, cancelamento durante wave e
   cleanup.
5. **type-coverage**: módulo crítico fora do manifest, options-bag inválido,
   `@ts-ignore`, exclusão indevida e queda de coverage por domínio.

### 25.3 Multiagentes, compressão e custo real

Executar comparação pareada `single_worker` versus `team` no mesmo corpus,
budget e oracle. Multiagente só é promovido para a classe de tarefa em que
melhorar qualidade, latência ou custo total de forma reproduzível. Paralelismo
não é benefício presumido.

Compressão por modelo é experimento opt-in. Comparar com
Graphify/FTS/Context Pack/Headroom e contabilizar a própria chamada de
compressão. Falha preserva conteúdo original, mas não sustenta claim de
economia. Custo desconhecido permanece `unknown`.

### 25.4 Aprendizado controlado

O Sprint 53.7 acrescenta:

- namespaces por projeto, domínio, harness e versão;
- curator determinístico para prune/dedupe;
- memória capturada por LLM permanece candidate;
- promoção somente após reprodução no Scenario Lab;
- memória stale, conflitante, duplicada ou sem provenance não entra no Context
  Pack nem altera routing.

### 25.5 Adições ao Sprint 53.3

Entregas adicionais:

- Claim Contract runner reutilizado do PRD52, com adapters allowlisted;
- scorer fingerprints e validação de tools/args;
- suíte das cinco capabilities;
- comparação `single_worker` versus `team`;
- métricas por role e chamadas auxiliares.

DoD adicional:

- contrato preenchido sem receipt executado continua `NOT_PROVED`;
- contraprova que não quebra após sabotagem reprova o claim;
- `paused`, `cancelled` e `ungradeable` nunca contam como sucesso;
- provenance vazia após efeito ou stream concorrente bifurcado falha;
- challenge P0/P1 enforced sem CLI/policy bloqueia;
- task graph inválido é rejeitado antes do worker;
- type coverage comprova o manifest core, não apenas média global.

### 25.6 Controles negativos adicionais

1. quatro strings válidas sem ClaimReceipt não promovem;
2. negative control declarado não falha quando a capability é removida;
3. cenário sem scorer/assertion/expected tool tenta passar;
4. scorer lança erro ou timeout;
5. run pausado/cancelado aparece como sucesso;
6. compressão custa mais tokens líquidos e ainda alega economia;
7. team perde para worker único no holdout e é promovido;
8. provenance vazia após efeito ou bifurcada por concorrência;
9. challenge enforced perde CLI/policy e falha aberto;
10. grafo com dependência desconhecida/ciclo inicia execução;
11. arquivo core fica fora do typecheck sem falhar o manifest.

### 25.7 Referência Agno

Referência: <https://github.com/agno-agi/agno>, commit
`21de30f323f4ceaf07a429cb2be9bea236643a9d`, Apache-2.0.

Adaptar somente contratos de scorers, estados de run, métricas auxiliares e
curadoria de memória. Não adicionar Agno como dependência, segundo workflow
engine ou juiz final.

### 25.8 DoD adicional do PRD53

- todo claim `REAL` possui receipt fresco e reproduzível;
- as cinco capabilities possuem cenários positivos/negativos ou continuam
  publicamente `NOT_PROVED`;
- métricas não escondem custo de reviewer, memory, compression ou evaluation;
- memória aprendida não governa sem evidência e promoção;
- PRD53 não redefine ApprovalLease, Event Store ou control plane.
---

## 26. Calibração normativa — gramática de continuação e não reabertura

> Esta seção complementa 7.1.3, 10, 12, 19 e 21. O PRD53 especifica o oráculo e
> os testes; o PRD54 implementa a interação no Manager.

### 26.1 Gramática observável

Toda mensagem de continuidade é interpretada contra o estado canônico, nunca
isoladamente:

```text
ContinuationInput:
  text, actorId, missionId, taskId, promptId?, questionId?, receivedAt

ContinuationResolution:
  resume_current_scope | answer_yes | answer_no | ambiguous | no_pending_action
```

Regras:

- sem pergunta pendente e com lease fresca, `continue|continuar|siga|prossiga`
  retoma do último checkpoint verde;
- com exatamente uma pergunta binária não P0, esses termos só contam como
  `answer_yes` se o prompt declarar explicitamente os aliases aceitos;
- plano novo aguardando aprovação não é aprovado por `continue`; o sistema
  reapresenta `Aprovar este plano? [Sim/Não]`;
- efeito P0/irreversível exige a resposta ou frase de confirmação definida pelo
  contrato; alias genérico e `--yes` são inválidos;
- com mais de uma pendência, texto genérico retorna `ambiguous` e apresenta as
  decisões separadas;
- sem missão, checkpoint ou ação pendente, `continue` retorna
  `no_pending_action`; nunca inventa trabalho.

### 26.2 Não reabertura por skills

Uma skill pode descobrir conflito ou fato novo, mas não transformar preferência
secundária em novo gate. Reabrir decisão exige:

```text
decisionKey + previousDecisionReceipt + contradictoryEvidenceRef
ou
scope/risk/policy hash alterado
```

- design system ausente pode abrir uma decisão de direção visual;
- após direção aprovada, tema, densidade e defaults P2 reversíveis não pausam a
  execução, salvo requisito explícito;
- troca de agente, skill ou harness preserva decisions, lease e
  `deliveryPriority`;
- AGENTS.md suficiente não reabre bootstrap;
- pergunta repetida sem freshness/conflict novo falha o budget de decisões.

### 26.3 Fixtures obrigatórias derivadas da auditoria Verdent

Adicionar ao Scenario Lab:

1. `tudo em pt-BR` confirma somente `outputLanguage`;
2. stack, módulos, auth, tenancy e compliance permanecem `pending`;
3. `quero ver o frontend primeiro` fixa `deliveryPriority=frontend_preview`;
4. handoff sem plano local preserva missão, prioridade e último checkpoint;
5. `continue` diante de plano pendente não cria ApprovalLease;
6. `sim` após pergunta binária aprova somente seu `questionId`;
7. plano aprovado seguido por skill visual não reabre tema P2;
8. falha de runtime dentro do DoD é reparada sob a mesma lease quando não amplia
   escopo ou risco;
9. browser indisponível impede claim de validação visual;
10. rota estática com actions desconectadas recebe `demo_ready`, não
    `workflow_ready`;
11. pausa sem pergunta acionável ou blocker comprovado reprova o trace;
12. múltiplas mensagens `continue` não duplicam efeitos nem consomem a lease
    duas vezes.

### 26.4 Métricas de fluidez

Medir por missão e por harness:

- `blocking_pauses`;
- `duplicate_question_rate`;
- `ambiguous_continuation_rate`;
- `resume_from_checkpoint_success_rate`;
- `approval_to_action_latency`;
- `time_to_first_healthy_preview`;
- `skill_reopen_attempts`;
- `unactionable_pause_rate`.

Promoção exige zero aprovação P0 ambígua e zero pausa não acionável no corpus
determinístico. Ganho de fluidez nunca compensa regressão P0/P1.

### 26.5 Controles negativos adicionais

1. idioma aprova stack e compliance;
2. `continue` cria lease para plano não aprovado;
3. duas pendências são resolvidas pela mesma mensagem;
4. skill reabre decisão fresca sem nova evidência;
5. handoff esquece prioridade e pergunta novamente o objetivo;
6. build/HTTP 200 promovem UI sem interação para `workflow_ready`;
7. Playwright sem browser é registrado como visual test aprovado;
8. reparo necessário ao DoD é tratado como nova frente sem mudança de risco;
9. efeito P0 aceita alias genérico;
10. pausa termina sem `PendingRequirement`, erro ou próxima ação.

### 26.6 DoD adicional

- parser de continuação é determinístico, localizado e versionado;
- toda resolução referencia `promptId/questionId` quando aplicável;
- decisões confirmadas sobrevivem a handoff e troca de harness;
- os doze traces da seção 26.3 possuem golden output;
- PRD53 testa maturidade, mas não redefine os estados canônicos do PRD52;
- nenhuma skill recebe autoridade para criar ApprovalLease.
## 27. Addendum normativo - Logging minimo, redigido e verificavel

Este addendum reforca a fronteira entre provenance suficiente e captura excessiva
de conteudo. Logs nao sao memoria integral da sessao nem copia do payload do
provider.

### 27.1 Redaction antes da persistencia

Toda mensagem, prompt, resposta, resultado de tool, catalogo, DOM, screenshot ou
erro passa pelo redactor antes de ser gravado. Redaction no closeout ou depois da
exibicao nao satisfaz o contrato.

Por padrao, o log persiste apenas:

- IDs e hashes estaveis;
- classe do evento e timestamps;
- provider/modelo por identificador, nunca catalogo integral;
- tamanhos, contagens e status;
- resumo bounded do erro;
- referencias para evidence governada;
- versao do redactor e resultado do scan.

Prompt completo, transcript integral, request/response body, headers, cookies,
tokens, catalogo remoto completo e dumps de configuracao sao proibidos no log
padrao.

### 27.2 Bounds, deduplicacao e retencao

- tamanho maximo por evento e por run;
- truncamento estruturado com hash do conteudo omitido;
- falhas identicas recebem contador, primeira/ultima ocorrencia e nao repetem o
  payload;
- rotacao e TTL seguem policy local;
- expiracao remove payload e preserva somente receipt minimo quando necessario;
- modo debug exige consentimento, prazo, redaction e destino project-scoped.

Falhas de ambiente usam classes tipadas como `tool_not_found`,
`provider_unavailable`, `configuration_missing`, `network_error` e
`invalid_metadata`. Ausencia esperada de uma ferramenta nao e stack trace
interno.

### 27.3 Controles negativos e DoD adicional

- secret canary em prompt, DOM, tool result e erro nao chega ao log;
- provider catalog de milhares de entradas persiste apenas IDs/hashes
  necessarios;
- erro repetido cem vezes gera um grupo deduplicado;
- payload acima do limite e truncado antes da escrita;
- redactor indisponivel bloqueia persistencia sensivel;
- modo debug expirado volta automaticamente ao perfil padrao;
- evidence pack registra `redactionVersion`, bounds, retention class e scan;
- telemetria de tokens/custo nao depende de armazenar o prompt completo.
