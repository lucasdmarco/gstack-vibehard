# Benchmark epistêmico — o que foi medido e o que falta

`npm run bench:epistemic` (ou `node scripts/bench-epistemic.mjs`) mede os gates do
PRD50 §50.6 que têm **gabarito objetivo**. Ele nunca se declara plenamente validado.

## O que está medido (e passa hoje)

| Gate | Resultado |
|---|---|
| falso-suporte em controles deterministicamente falsos | 0/3 — zero |
| precisão de citation support | 6/6 |
| citação não-sustentadora vazando como suporte | 0 |
| classificação de nível determinística | 10/10 |
| abstenção em casos `insufficient` | 2/2 |
| tool claim sem recibo | 0 |
| `proved` originado de LLM/review | 0 |

Esses números vêm de fixtures cujo gabarito é decidível por inspeção — não dependem
de julgamento de quem construiu o sistema.

## O que NÃO está medido, e por quê

Duas métricas do §50.6 exigem **avaliação humana cega**:

- `citation_support_precision_on_ambiguous` — uma fonte que diz *"X melhora Y em
  ambiente controlado"* sustenta o claim *"X melhora Y"*? A generalização remove a
  condição. É julgamento.
- `answer_relevance_to_intent` — uma resposta tecnicamente correta sobre performance
  responde de fato à pergunta *"por que meu build está lento?"*?

**Se eu mesmo rotulasse esses casos, o número seria inútil.** O PRD50 §2.3 item 1 diz
exatamente isso: *"autoconcordância entre gerador e verificador não constitui prova"*.
Quem construiu o protocolo dar a nota ao protocolo é a definição do problema.

Por isso eles saem como `pending_human_labeling`, com o corpus pronto.

## Como rotular (≈1 hora)

1. Abra `tests/fixtures/epistemic/corpus.json` e filtre `requiresHumanLabel: true`.
2. Para cada caso, **sem olhar** o que o sistema respondeu, decida:
   - a fonte sustenta o claim? `supports` / `mentions_only` / `not_found` / `contradicts`
   - a resposta atende à intenção da pergunta? `sim` / `não`
3. Grave em `tests/fixtures/epistemic/human-labels.json` no formato
   `{ "<caseId>": { "support": "...", "relevant": true|false } }`.
4. Rode `node scripts/bench-epistemic.mjs` de novo — as métricas subjetivas passam a
   aparecer, e `fullyValidated` pode virar `true`.

O ideal metodológico é mais de um avaliador, sem saber qual sistema produziu a saída.
Um avaliador só já é melhor que zero — mas o número deve dizer quantos foram.

## O que este benchmark nunca vai fazer

- Transferir score de Aletheia/Deep Think para o GStack (§17.2). Há teste que falha se
  algum percentual fixo for hardcoded como resultado.
- Declarar `fullyValidated: true` enquanto a fatia humana estiver pendente.
- Medir overhead de EV0 dentro do Claude Code — lá o contrato é texto injetado e o
  GStack nunca vê a resposta (ver `docs/guides/epistemic-protocol.md`).
