# Handoff — PRD51 Fase 1B, lote JS (sessão de 2026-08-14)

HEAD ao encerrar: `64b428b`. Árvore limpa exceto `.docs/PLANS/prd52-54.md`, que
**não são desta sessão** (ver "Achados laterais").

## Estado do censo

| | início | fim |
|---|---|---|
| total | 1906 | 1906 |
| unknown | 51 | **49** |
| convertidos | 6 | **8** |
| decisões de provenance | 50 | **66** (declaradas === aplicadas) |

Convertidos: `src/cli/create.js`, `src/cli/index.js`, `src/commands/monitor.js`,
`src/commands/qa.js`, `src/commands/secrets.js`, `src/index.js`,
`src/commands/orchestrate.js`, `src/commands/init.js`.

## Commits desta sessão

1. `bc4a62e` — capacidade **C-3** (tabelas de despacho congeladas e por referência)
2. `946d088` — **lote B**: converte `orchestrate.js` (51 → 50)
3. `64b428b` — **C-2** (`console-blank-line`) + converte `init.js` (50 → 49)

Nenhum tocou `.docs/`. Suíte completa **não** rodada (decisão do lote).

## Recalibração importante do diagnóstico de C-3

O handoff anterior descrevia C-3 como "handlers arrow que produzem `<anon>`".
**Medido, isso é falso**: `visual.js:86` sai com `functions: ["detectCmd"]` —
função nomeada de topo. O grafo partia um nível acima, em `SUBCOMMANDS[sub]`, por
duas causas estruturais na modelagem da TABELA (não do handler):
`Object.freeze({...})` como inicializador, e `chave: handlerDireto` como valor.

Consequência para quem continuar: **não confie na descrição do sintoma, meça o
ponto**. O probe usado está em
`%TEMP%\claude\...\scratchpad\probe2.mjs` (recriável em 5 linhas: `createAnalyzer`
com `CONVERTED_FILES` + candidatos, depois `analyzeFile` e filtrar `audience`).
Sem `src/cli/index.js` na lista, o DISPATCH não resolve e **todo** ponto sai com
`commands: []` — falso negativo que já me custou uma rodada.

## Os 11 arquivos JS restantes (24 pontos AST)

Medidos DEPOIS de C-3/C-2. `cmds` e `argForm` são do motor, não estimativa.

### Bloqueados por C-4 — `opaque`/passthrough (a próxima capacidade)

| ponto | forma | causa |
|---|---|---|
| `visual.js:86` | `console.log(renderFeedbackMarkdown(feedback))` | texto vem do CALLEE |
| `research.js:294` | `console.log(renderEpistemicHuman(review))` | idem, mesma forma |
| `context.js:249,260,278,280` | `process.stdout.write(r.stdout)` | `r` = resultado de `runIndexer` (subprocesso) |
| `context.js:50` | `ctxJson(...)`, `serializer`, modo humano | emissor JSON chamado fora de guarda `--json` |
| `install.js:359` | `<anon>` na cadeia, `opaque` | callback — **deve continuar inalcançável** |
| `runtime-supervisor.js:346,389` | `<anon>` na cadeia, `opaque` | idem |

**C-4 são DOIS problemas distintos, não um.** Não os fundir:

1. **Passthrough de subprocesso** (`context.js` ×4). A audiência
   `external_passthrough` **existe no vocabulário mas não tem regra alguma em
   `JS_RULES`** — é inalcançável por design hoje, e há teste negativo garantindo
   isso (`external_passthrough NÃO é alcançável sem subprocesso externo provado`).
   Construí-la exige provar que o valor flui de um subprocesso, provavelmente
   estendendo o avaliador abstrato (`avaliarExpr`/`propagarDoEntrypoint`) com um
   valor "resultado de subprocesso externo". O comentário em `i18n-js-ast.mjs:2189`
   registra o erro já cometido antes: propriedade de erro em `catch` **não** é
   passthrough — "se o GStack DECIDE imprimir `err.stack`, a exposição é dele".
2. **Texto produzido pelo callee** (`visual.js:86`, `research.js:294`). Aqui o
   risco é DUPLA CONTAGEM: as strings vivem dentro de `renderFeedbackMarkdown` /
   `renderEpistemicHuman` e serão contadas quando aqueles arquivos forem
   convertidos. É o mesmo raciocínio de `render_primitive` ("contar como público
   duplicaria a contagem"), porém invertido — lá o texto vem do CHAMADOR, aqui do
   CALLEE. Já existe `ehWrapperTransparente` no motor; verificar se serve antes de
   escrever qualquer coisa nova.

Os `<anon>` (`install.js:359`, `runtime-supervisor.js:346,389`) **não são C-4**:
são callbacks reais e devem permanecer inalcançáveis. Há controle em
`tests/i18n_js_ast_dispatch_tables.test.js` provando que aceitar `<anon>`
genericamente quebra os negativos.

### Bloqueados por prova pública ausente (não por capacidade)

| ponto | comando/modo |
|---|---|
| `install.js:475` | `install` / `--json`, `serializer` |
| `runtime-supervisor.js:45,247` | `dev` / `--json` |
| `runtime-supervisor.js:278,317` | `stop` / `--json` |

`runtime-supervisor.js` é alcançado por **quatro** comandos (`dev`, `stop`,
`logs`, `open`). A âncora fina é UNIVERSAL: provar `dev` não cobre `logs`. Precisa
de declaração por (arquivo, command, mode) para cada rota que alcança cada ponto.

### Fora do DISPATCH — `commands: []`

- `task-run.js:43,97` — `entrypointsPorComando` devolve `null` para o arquivo.
  Investigar se `task-run` está no DISPATCH sob outro nome antes de assumir
  capacidade nova.
- `plugins/opencode/gstack-session.js:33,51,93` — plugin, não comando de CLI.
  Provavelmente C-6.

### C-5/C-7 — cauda de mantenedor

- `scripts/sync-qg-version.mjs:35,37`, `scripts/clean-pkg.mjs:28`.

## Restante fora do lote JS (25 pontos, NÃO são os 11 arquivos)

`templates/**/*.ts` (16) e `hooks/**/*.py` (9). O terminal do lote JS é
**unknown 24**, não 0 global.

## Regras de processo confirmadas nesta sessão

- **`PROVENANCE_STRATEGIES` é lista FECHADA** e `STRATEGY_BY_KIND` amarra a
  estratégia ao `kind` REAL do ponto. Tentei cunhar uma terceira estratégia e o
  validador barrou — corretamente. A nuance vai no `reason`, nunca em vocabulário
  novo.
- Limite de complexidade da casa é **cc ≤ 6**; QG L1 acusa `HIGH` acima disso e
  bloqueia. Duas funções minhas passaram e precisaram de extração.
- `git add` **sempre explícito por arquivo** nesta árvore (ver achados laterais).
- Máquina sob carga: `node --test --test-concurrency=2`.
- `evaluateJsonRun` expõe `doc`/`exitCode` (não `json`/`status`) e
  **deliberadamente não asserta código de saída** — a política está aberta como
  achado P1. Não decidi por baixo.

## Achados laterais (ledger)

1. **Outra sessão está editando `.docs/PLANS/prd52.md`, `prd53.md`, `prd54.md`**
   (mtime 13/08 18:12, conteúdo autoral sobre missão autônoma/ApprovalLease).
   Não são meus e ficaram intocados. Por isso `git add -A` é perigoso aqui.
2. **`init.js:244` — `info(`  cd ${projectName}`)`**: a "moldura literal" é um
   comando de shell dentro de bloco copiável, não prosa. O vocabulário de
   estratégias assume moldura = prosa. Registrado por extenso na decisão para que
   ninguém traduza `cd` por analogia. Se o padrão reaparecer, aí sim vale discutir
   vocabulário — com evidência de vários casos, não de um.
3. `install.js` fechou 1 de 3 residuais com C-2 e **continua fora** de
   `convertedFiles`. Fechar residual não converte arquivo.

## Próximo passo sugerido

C-4, começando pelo sub-problema **2** (texto do callee), que é menor e não exige
tocar o avaliador abstrato — fecha `visual.js` e `research.js` de uma vez se os
demais residuais deles já estiverem zerados. O sub-problema 1 (subprocesso) é o
maior da fila e merece sprint próprio.
