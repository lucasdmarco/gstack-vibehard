# Graphify query-first: bounded por padrão, nunca a % alegada

O GStack já lia `graphify-out/graph.json` com uma consulta limitada (no máximo 5
resultados por busca, `src/context-docs/scout.js`). O que faltava era: subcomandos
declarados de verdade, uma política explícita de "consultar o grafo primeiro" e uma
declaração honesta do que cada harness realmente reforça hoje.

## Subcomandos reais (nada inventado)

`src/tools/graphify-adapter.js` declara só os subcomandos que este código realmente
invoca: `update` (refresh), `index` (bootstrap inicial), `hook install`, `--version`.
**Não existe subcomando `query`** — o GStack lê `graphify-out/graph.json` direto, nunca
faz shell-out para consultar.

## Policy: soft por padrão, strict só explícita

- `soft_query_first` (padrão): serve resultados do grafo mesmo se ele estiver `stale`,
  com aviso — nunca bloqueia uma consulta de contexto.
- `strict_first_read`: só ativa com `.gstack/policy.json` explícito
  (`contextRetrieval.graphifyQueryFirst: "strict_first_read"`). Com o grafo `stale`,
  **recusa servir** e recomenda regenerar — melhor não responder do que responder com
  topologia desatualizada disfarçada de atual.

Isso é ortogonal ao gate de release já existente (`proof --profile full` bloqueia com
grafo stale, PRD26) — a policy aqui é sobre a consulta EM SESSÃO, não sobre o veredito
de release.

## Conformance por harness (honesta)

Nenhum harness reivindica `enforced` para "consultar o grafo antes de ler arquivos" —
esse tipo de enforcement exigiria interceptar a ORDEM das leituras, que nenhum hook real
hoje faz (nem o hook `PostToolUse` do Claude, S49.3). Todos os três harnesses
verificáveis (`claude`, `codex`, `opencode`) são declarados `advisory` em
`GRAPHIFY_QUERY_FIRST_CONFORMANCE`, com o motivo real — mesmo invariante de
`claimsFakeHooks` em `harness/capabilities.js`.

## Legado `.graphify/deps.json`

Alguns projetos criados por `gstack_vibehard create`/`init` ainda têm o formato antigo
`.graphify/deps.json`. `legacyDepsJsonStatus()` detecta a presença e explica a migração
— **nunca apaga ou reescreve esse arquivo sozinho**. O mecanismo atual é
`graphify-out/graph.json` via `graphify update .`.

## Benchmark: comparativo, nunca uma % fixa

`tests/bench/context_retrieval_bench.test.js` compara bytes considerados por uma
consulta bounded vs. ler todos os arquivos de um fixture ingenuamente — usando a mesma
heurística honesta já existente (`estimateTokensAvoided`, scout.js). O teste afirma que a
consulta bounded considera menos bytes E que o tamanho do resultado não escala com o
corpus — nunca um percentual fixo de economia (regra explícita do PRD49: nenhuma %
automática é alegada como resultado do GStack).

## Limite honesto desta versão

Não há wiring novo de instrução em `AGENTS.md`/`.claude`/`.cursor` para "prefira
consultar o grafo" — isso ficaria acoplado à mesma superfície central revisada na S49.3
(hooks por harness) e não foi objeto desta sprint. O adapter é real e testado; a
INJEÇÃO de orientação nos arquivos de projeto fica para uma sprint futura se o usuário
confirmar que vale a pena.
