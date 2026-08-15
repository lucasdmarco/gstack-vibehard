# Handoff — PRD51 Fase 1B, sessão de 2026-08-15

HEAD ao encerrar: `b77dc95`. Árvore limpa exceto `.docs/PLANS/prd52-54.md`, que
**não são desta sessão** (outra sessão trabalha neles em paralelo — nunca use
`git add -A` nesta árvore). Stash `wip-avaliador` intacto.

Sucede `.docs/PLANS/prd51-handoff-lote-js-20260814.md`.

## Estado

| | início | fim |
|---|---|---|
| total | 1906 | **1905** |
| unknown | 49 | **45** |
| convertidos | 8 | **11** |
| decisões | 66 | **87** (declared === applied) |

Convertidos nesta sessão: `src/commands/visual.js`,
`scripts/sync-qg-version.mjs`, `scripts/clean-pkg.mjs`.

**O total caiu 1 e isso é correto**: `clean-pkg.mjs:28` (`console.error(...)`)
era contado DUAS vezes pelo regex — `28:cli_render` (o `error(` de dentro casa o
padrão de helper) e `28:console`. Medido em worktree limpo do commit anterior,
não deduzido. Mesmo falso positivo já documentado para `cli/index.js`. A
asserção do censo foi reescrita: a invariante é "não sumir com ponto REAL".

## Commits

1. `575c282` — C-4(b) `console-project-rendered-text`
2. `1c06c66` — prova pública de `visual --json` + consumidor nas 2 camadas
3. `c9dfa76` — estratégia `translate_at_value_origin` (capacidade + 22 controles)
4. `69c3dc8` — aplica a estratégia e **converte visual.js**
5. `b77dc95` — C-5 lifecycle do npm, **converte os 2 scripts**

## `translate_at_value_origin` — aplicada a UM ponto, não a três

O contrato exigia provar individualmente antes de aplicar. Provado com o checker
contra o repositório real (`tests/i18n_value_origin_resolution.test.js`):

| ponto | resultado |
|---|---|
| `visual.js:97` `rule.description` | UMA origem (`design-rule-registry.js:20:5`), StringLiteral de frase → **APLICADO** |
| `research.js:195` `p.message` | checker devolve **ZERO** declarações (`p` é parâmetro de arrow sem tipo) → **BLOQUEIA** |
| `context.js:201` `d.evidence` | ZERO declarações; vem do context scout = documento **indexado do usuário** → **BLOQUEIA** |

**Correção do meu próprio handoff anterior**: eu dei `research.js:195` como "o
caso mais limpo" por ter LIDO o código e visto a frase em `notebooklm.js:20`.
Ler não é provar. O ponto 7 do contrato manda bloquear origem não resolvida.

**Consequência**: `research.js` NÃO converte enquanto `p.message` não resolver.
Resolveria com anotação de tipo no parâmetro — mas isso é mudança de código
(Fase 2), não classificação.

Os três controles que faltavam do contrato têm **caso real** no repositório:
`rule.status` (visual.js:96) resolve para DUAS declarações e os literais dela são
TOKENS de enum — serve de negativo para "duas origens possíveis" e "origem não
linguística" ao mesmo tempo.

## Os 45 unknown restantes

### JS (14 pontos, 6 arquivos)

| arquivo | pontos | bloqueio |
|---|---|---|
| `context.js` | 249,260,278,280 | **C-4(a)**: `process.stdout.write(r.stdout)`, `r` de `runIndexer` (subprocesso). `external_passthrough` existe no vocabulário mas **não tem regra em `JS_RULES`** — inalcançável por design, com teste negativo garantindo. Exige estender o avaliador abstrato. Sprint próprio. |
| `gstack-session.js` | 33,51,77,93 | plugin OpenCode, fora do DISPATCH |
| `install.js` | 44,90,186,697 (regex) / AST: 359, 475 | `:475` precisa de prova de `install --json`; `:359` é `<anon>` legítimo e **deve continuar inalcançável** |
| `runtime-supervisor.js` | 278,346,389 | `:278/:317/:45/:247` precisam de prova por comando (o arquivo é alcançado por **4** comandos e a âncora é UNIVERSAL); `:346/:389` são `<anon>` legítimos |
| `research.js` | 294 (regex) / AST: 5 em `--json` | precisa de prova de `research --json`; **mas `:195` bloqueia a conversão** (ver acima) |
| `task-run.js` | 43,97 | **não é importado por `src/cli/index.js`** — `taskCommand` vem de outro módulo. Exige alcance CROSS-MÓDULO, que o grafo não modela. Capacidade maior. |

### Fora do lote JS (31 pontos)

16 em `templates/**/*.ts`, 15 em `hooks/**/*.py`. Dois lotes próprios.

## Regras de processo confirmadas

- cc ≤ 6 (QG L1 acusa HIGH acima); `||`/`?.`/`??`/ternário contam.
- `node --test --test-concurrency=2`.
- `git add` explícito por arquivo.
- **Âncora de mutation control precisa de ESCOPO**: `&& p.underMachineGuard !== true`
  existe em várias regras; substituir a 1ª ocorrência muta a regra errada e o
  mutante não quebra nada. Buscar a partir do `id:` da regra.
- **Fixture em diretório temporário não resolve lib nem `node_modules`** — negativos
  desse tipo precisam ser ancorados no repo real.
- **Regra nova entra por ÚLTIMO em `JS_RULES`** salvo motivo: colocada antes de
  `command-human-branch`, uma regra roubou 15 pontos já classificados de
  `monitor.js` (audiência igual, `rule` diferente = churn no artefato).
- `requiresDebugEnv` devolve `false` para COMPARAÇÃO (`=== "1"`); a forma
  reconhecida é a leitura direta (`if (process.env.DEBUG)`).
- O número absoluto do censo agora vive em UM lugar (`i18n_inventory.test.js`);
  os outros três testes afirmam a RELAÇÃO (total determinístico).

## Fora da Fase 1B — NÃO iniciado

Fatia 6 (CI determinístico do registry, stale control, regeneração byte a byte),
Fatia 7 (pacote sem devDependencies, import pela URL canônica), DOD.3a/3b/8/12,
RC matrix/checklist/ledger/receipts, e os blockers
P0.NODE-SUPPORT-GATE-INVALID / safe_support / P1.ARTIFACT-SOURCE-INFERRED.

**Nada disso foi tocado — não há status inflado a corrigir.** A suíte completa
também não foi rodada (marco ainda não atingido: o lote JS não chegou a 0).
