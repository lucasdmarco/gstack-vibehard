<!-- gstack-comparison-doc: v1 -->
# Comparação GStack x métodos externos para os PRDs 52–54

> **Gate.** Este documento cita
> `.docs/RESEARCH/repository-registry.json` (schemaVersion 1) e inclui o
> **batch-6-aidd-methodology**, obrigatório para metodologia, skills,
> onboarding e cross-harness. Referência metodológica nunca vira dependência
> runtime do GStack.

## 1. Contexto

- **Objetivo:** delimitar achados úteis de Matt Pocock Skills, corpus público
  AI Hero e LiveKit Agents sem ampliar o PRD51.
- **Data / versão observada:** 2026-08-05; GStack no ciclo PRD51–54.
- **Registry consultado:** `.docs/RESEARCH/repository-registry.json`.
- **Regra:** toda adoção entra no dono arquitetural existente e permanece
  candidate/shadow até prova do próprio GStack.

## 2. Batches obrigatórios do registry

| Repo | status | role | por que entra |
|---|---|---|---|
| lgsreal/ai-driven-dev | active_reference | learning_track | âncora metodológica obrigatória |
| ai-driven-dev/framework | active_reference | plugin_marketplace_and_sdlc | lifecycle e integração de práticas |
| ai-driven-dev/manifest | active_reference | product_manifesto | limites e intenção do método |
| ai-driven-dev/prompts | archived_reference | prompt_template_history | contexto histórico, não decisão atual |
| ai-driven-dev/rules | archived_reference | short_rules_history | contexto histórico, não decisão atual |
| ai-driven-dev/ai-driven-dev-community | archived_reference | community_catalog_history | contexto histórico, não decisão atual |

## 3. Fontes auditadas

| Fonte | pin/snapshot | licença | classe e limite |
|---|---|---|---|
| mattpocock/skills | `07999e06b58541362f2f3d6de9e2b108ac28dc52` | MIT | fonte primária de referência; não instalar/copiar |
| aihero.dev | snapshot público 2026-08-05 | conteúdo sem licença presumida | corpus público; parafrasear, sem vendoring |
| happyrobot-ai/livekit-agents | `70b4e87f592d34785ebc7b4cc6badefce5291197`, v0.11.3 | Apache-2.0 | snapshot histórico idêntico ao upstream |
| livekit/agents | `62d527d4603c9b0eaafdce272a80d42de4efae9e` | Apache-2.0 | referência viva de lifecycle/testes |

O commit do fork HappyRobot foi comparado ao upstream e não traz alteração
exclusiva no HEAD auditado. Decisões atuais citam `livekit/agents`; o fork
permanece apenas como contexto histórico.

## 4. Adotar / adaptar / rejeitar

| Ideia observada | origem | decisão | destino e justificativa |
|---|---|---|---|
| taxonomia automated check/review/human review | AI Hero + práticas convergentes | adaptar | PRD52 Claim Contract; LLM review nunca vira gate determinístico |
| source fidelity e referências primárias | Matt Pocock + AI Hero | adotar | PRD52 Context Delta e PRD54 Handoff |
| autoridade user-only/model/system-gate | Matt Pocock Skills | adaptar | PRD53 SkillBinding, sem ampliar ApprovalLease |
| review em padrões + especificação | Matt Pocock Skills | candidate | PRD53 Scenario Lab e A/B |
| debugging que preserva o sinal vermelho | Matt Pocock Skills | candidate | trap adversarial no PRD53 |
| tracer bullet e wayfinder | Matt Pocock Skills | adaptar | PRD54 Task Graph, usando `dependsOn` canônico |
| protótipo como evidência executável | Matt Pocock Skills + AI Hero | adaptar | PRD54 worktree isolada; sem auto-merge |
| AX por métricas separadas | AI Hero | adaptar | PRD53 cross-harness, sem score subjetivo único |
| discovery legível por agentes | AI Hero | adaptar condicionalmente | projeção gerada do registry, nunca fonte de verdade |
| admission -> drain -> kill | LiveKit Agents | adaptar | PRD54 lifecycle explícito |
| fallback consciente de efeito parcial | LiveKit Agents | adotar | PRD53 traps + PRD54 `effectState` |
| failure scope e recovery action | LiveKit Agents | adaptar | PRD54 Event Store/orquestração |
| resultado tipado de task | LiveKit Agents | adaptar | PRD54 Task Graph |
| sequência determinística de eventos | LiveKit Agents | corroborar | já coberto; judge semântico permanece advisory |
| instalar skills/repositórios externos | fontes externas | rejeitar | viola ownership, auditabilidade e independência runtime |
| runtime LiveKit/Python/WebRTC/STT/TTS | LiveKit Agents | rejeitar | fora do produto |
| threshold fixo de contexto ou CPU | AI Hero/LiveKit, se tratado como universal | rejeitar | telemetria `measured|estimated|unknown` |
| pool/prewarm e novo loop autônomo | LiveKit/Matt Pocock | rejeitar agora | sem necessidade medida; duplicaria motores existentes |

## 5. Mapeamento por PRD

### PRD52 — prova e certificação

- tipar natureza e autoridade da evidência;
- comprovar descoberta, invocação, multiplicidade, ownership, uninstall e restore
  de hooks em máquina limpa;
- provar stdout JSON/MCP puro e separação de canais;
- carregar `sourceClass`, referências primárias e hashes no Context Delta;
- versionar runbook externo como projeção operacional, não proof.

### PRD53 — governança e avaliação

- registrar fontes externas como `reference_pack` candidate/consult-only;
- impor autoridade de invocação de skills;
- medir AX por dimensão;
- exercitar review em dois eixos, red-signal debugging e fallback após efeito;
- auditar `AGENTS.md`, pointers e projeções agent-readable.

### PRD54 — orquestração e UX

- tipar nós e resultados no Task Graph;
- fechar admissão antes do bounded drain;
- derivar recuperação de `failureScope` e `effectState`;
- usar protótipo isolado como evidência opcional;
- preservar fontes primárias e pressão de contexto no handoff;
- representar operação humana externa pelo PendingRequirement existente.

## 6. Invariantes respeitadas

- [x] Nenhuma referência externa virou dependência runtime do GStack.
- [x] Nenhuma config global foi alterada.
- [x] Metodologia permanece candidate/shadow até prova interna.
- [x] Repos `archived_reference` são somente contexto histórico.
- [x] Nenhum segundo motor de proof, prompts, event store ou autorização foi criado.
- [x] Os achados não ampliam o PRD51 nem bloqueiam a sequência atual.

## 7. Conclusão

O GStack absorve contratos pequenos e verificáveis: procedência, autoridade de
invocação, métricas AX, resultados tipados, admissão explícita e retry consciente
de efeitos. Ficam fora dependências, runtimes paralelos, instalação automática,
thresholds universais e novos loops. A sequência permanece PRD51/B2 -> PRD52
certificação -> PRD53 avaliação -> PRD54 experiência operacional.

