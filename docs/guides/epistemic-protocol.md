# Protocolo de Verificação Epistêmica (PVEP) — contratos congelados

> **Estado:** Sprints 50.0–50.1 entregues. Contratos, schema, classificador e EV0
> existem e **já estão ligados a um comando real** (`consult`). `research validate`
> e o protocolo balanceado chegam nos sprints 50.3–50.4. Nenhum claim de "resposta
> verificada" está autorizado (PRD50 §8).

## Já funcionando: `consult` (EV1)

O `consult` sempre misturou duas coisas na mesma saída. Agora elas saem rotuladas
em `consult --json`, campo `epistemic`:

| Claim | Kind | Por quê |
|---|---|---|
| `installState` | `fact` | sondagem read-only real do filesystem — tem suporte citável |
| `recommendedMode` | `inference` | heurística de palavra-chave sobre o objetivo, **não** medição |
| `recommendedPath` | `recommendation` | sugestão; execute o preview antes de aplicar |

Isso é **aditivo**: todos os campos anteriores continuam idênticos.

## O problema

Hoje o GStack não distingue três coisas muito diferentes:

- **"eu verifiquei"** — rodei um teste, li o arquivo, consultei a fonte
- **"eu deduzi"** — parece que é assim, dado o que eu vi
- **"eu não sei"** — não tenho dado suficiente

O PVEP separa isso, com custo **proporcional ao risco**:

| Nível | Quando | Orçamento (`LEVEL_BUDGET`) |
|---|---|---|
| **EV0** `sanity` | pergunta trivial, local, reversível | zero rede, zero subagente, zero model call extra |
| **EV1** `grounded` | fato, código, arquitetura | rede se autorizada, 1 model call advisory |
| **EV2** `adversarial` | segurança, release, irreversível | rede com consentimento, 2 calls, verificador independente |

## O que já está congelado (`src/epistemic/invariants.js`)

Nove invariantes, cada um com controle negativo em `tests/prd50_negative_controls.test.js`:

| # | Invariante | Função |
|---|---|---|
| 1 | Nunca alegar verificação não executada | `canClaimVerified` |
| 2 | Fonte que só menciona não sustenta | `citationSupportsClaim` |
| 3 | Fonte existe mas não sustenta → `source_discovered` | `classifySourceOutcome` |
| 4 | Citação presa ao claim errado → misattribution | `detectMisattribution` |
| 5 | Preprint/blog nunca é consenso | `canTreatAsConsensus` |
| 6 | Teste não executado nunca é prova | `testEvidenceStatus` |
| 7 | EV0 nunca chama rede/subagente/tool extra | `violatesLevelBudget` |
| 8 | Conteúdo externo é untrusted | `externalContentTrust` (reusa AgentShield) |
| 9 | **`supported` nunca vira `proved`** | `epistemicVerdictToEvidenceStatus` |

### O invariante de ouro (#9)

`supported` no protocolo epistêmico **não é** `proved` no Evidence Ledger. Isso não
depende de disciplina — é estrutural: `evidence-ledger.js:36` coage qualquer `proved`
vindo de fonte fora de `PROVING_SOURCES` (`gate`/`test`/`build`/`verify`/`command`)
para `advisory`, e `"epistemic"` nunca entrará nessa lista. O controle negativo 9
testa isso contra o ledger real, não contra um mock.

## Ownership de arquivos (§50.0 — conflito com PRD46–49)

O PVEP **estende** módulos que já têm dono. Regra: quem chegou primeiro mantém o
contrato; o PVEP só adiciona.

| Arquivo | Dono original | O que o PRD50 faz | O que **não** pode fazer |
|---|---|---|---|
| `src/commands/research.js` | PRD29 (`skills audit`), PRD49 S49.9 (`notebooklm`) | adiciona 3º branch `validate` | remover/alterar os 2 subcomandos existentes |
| `src/commands/consult.js` | PRD14 §4.9 | 1º consumidor EV1 (sprint 50.1) | deixar de ser read-only |
| `src/skills/execution-contract.js` | PRD42 | adiciona o contrato curto (§8) | afirmar enforcement que o harness não tem |
| `src/agents/scanner.js` | AgentShield | **só lê** (`scanContent`) | duplicar padrões de injection |
| `src/project-plan/evidence-ledger.js` | PRD41/42 | **só lê** | entrar em `PROVING_SOURCES` |
| `src/workflow-graph/runner.js` | Loop Engine | adapta via `workflow-adapter.js` | criar segundo motor/journal |
| Agent Factory compiler | PRD46 | compila o contrato canônico | duplicar texto nos 20 agentes à mão |

## Corpus (`tests/fixtures/epistemic/corpus.json`)

Semente do benchmark do Sprint 50.6. A divisão importante:

- **gabarito objetivo** (`true`/`false`/`insufficient`) — decidível por inspeção do
  próprio fixture. O GStack mede sozinho.
- **julgamento subjetivo** (`ambiguous`) — `requiresHumanLabel: true`, obrigatório.
  Suporte semântico ambíguo e relevância de intenção **não podem** ser auto-avaliados
  por quem construiu o sistema: seria exatamente a falha que o PRD50 §2.3 item 1
  descreve (*"autoconcordância entre gerador e verificador não constitui prova"*).

Um teste força essa separação nos dois sentidos: caso ambíguo sem `requiresHumanLabel`
reprova, e caso objetivo pedindo humano também reprova.

## Limite honesto desta versão

- Nada aqui está **ligado** — `invariants.js` não é chamado por nenhum comando ainda.
- Nenhuma das 8 fontes primárias foi **buscada na rede**. Estão registradas com
  `verifiedByThisSession: false` em `.docs/RESEARCH/prd50-source-manifest.json`.
  Registrar ≠ verificar; o snapshot real é o Sprint 50.2.
- Nenhum claim de §17.1 está autorizado. Só depois do Sprint 50.7.
