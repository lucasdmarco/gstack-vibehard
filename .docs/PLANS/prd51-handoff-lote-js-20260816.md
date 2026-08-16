# Handoff — PRD51 Fase 1B, sessão de 2026-08-16

HEAD ao encerrar: `b759983`. Árvore limpa exceto `.docs/PLANS/prd52-54.md`, que
**não são desta sessão** (outra sessão trabalha neles em paralelo — nunca use
`git add -A` nesta árvore). Stash `wip-avaliador` intacto.

Sucede `.docs/PLANS/prd51-handoff-lote-js-20260815.md`.

## Estado

| | início | fim |
|---|---|---|
| total | 1905 | **1924** |
| unknown | 45 | **41** |
| convertidos | 11 | **12** |

**O total subiu 19, e isso é DESCOBERTA DE COBERTURA, não regressão.** A
fronteira do inventário Python deixou de ser o caminho literal `hooks/` e passou
a ser derivada; entraram os 19 pontos de `src/context-docs/py/context_db.py`,
que sempre existiram e nunca eram medidos. Todos saíram classificados: a fila
não cresceu.

## Commits

1. `850e0fb` — C-4(a): capacidade `external_passthrough` com provador de origem
2. `476746e` — fronteira do inventário Python DERIVADA
3. `9a474e8` — regras do Python de subprocesso de CLI (19 pontos)
4. `087e3d5` — remove duplicata de `funcaoDaDeclaracao` (correção de comentário falso)
5. `413a5b4` — guarda de máquina HERDADA por chamador universal
6. `af23844` — repasse de subprocesso do pacote com origem já contada
7. `b759983` — converte `src/commands/context.js` (lote JS 9/14)

## C-4(a) — a audiência é alcançável, e mede ZERO

`external_passthrough` deixou de ser "inalcançável por design". Há provador
estrutural (`chamadaDeSubprocesso`, `artefatoDeSubprocesso`, `origemDeRepasse`) e
a regra `stream-external-passthrough`. **Zero pontos no repositório, medido.**

**O achado que decidiu a fatia**: os quatro candidatos (`context.js:249/260/278/280`)
encaminham o stdout de `src/context-docs/py/context_db.py` — script que **viaja
no pacote** (`package.json#files` inclui `src/`) e imprime prosa escrita pelo
GStack (`"(sem resultados)"`, `"Entidade '…' não encontrada."`). Chamá-los de
externos apagaria da claim mensagens do próprio produto.

Correção do handoff anterior: aquele contava "14 pontos JS / 15 Python". Medido,
eram **18 JS / 11 Python / 16 TS**. O total de 45 estava certo; a partição, não.

## Fronteira Python — duas condições, ambas necessárias

1. **DISTRIBUÍDO** — sai no tarball (`package.json#files`);
2. **ALCANÇÁVEL** — execução real declarada em `PYTHON_RUNTIME_ROOTS`, com
   `runner` e `evidence` nomeados.

A condição 2 não é cerimônia, e o número é medido: o manifesto publica **40
arquivos `.py` / 361 pontos**, quase todos script de skill que a CLI nunca
dispara. Só a interseção é a fronteira. Há **controle de deriva** varrendo todo
`src/` com o provador de C-4(a): um `.py` novo disparado dali quebra o teste no
mesmo commit em que for escrito.

`CLI_RULES` é lista SEPARADA de `HOOK_RULES` porque em hook o stdout é protocolo
e em subprocesso de CLI é superfície de leitura — o inverso exato.

## Os 41 unknown restantes

### JS (14 pontos, 5 arquivos)

| arquivo | pontos | bloqueio |
|---|---|---|
| `gstack-session.js` | 33,51,77,93 | plugin OpenCode, fora do DISPATCH |
| `install.js` | 44,90,186,697,931 (regex) / AST: 359, 475 | `:475` precisa de prova de `install --json`; `:359` é `<anon>` legítimo |
| `runtime-supervisor.js` | 278,346,389 | alcançado por **4** comandos e a âncora é UNIVERSAL — precisa de prova por comando; `:346/:389` são `<anon>` cujo valor vem de PARÂMETRO (origem não resolvida, corretamente `unknown`) |
| `research.js` | 294 (regex) / AST: 5 em `--json` | precisa de prova de `research --json`; **`:195` (`p.message`) segue sem resolver e bloqueia a conversão** |
| `task-run.js` | 43 | **não é importado por `src/cli/index.js`** — exige alcance CROSS-MÓDULO, que o grafo não modela |

### Fora do lote JS (27 pontos)

16 em `templates/**/*.ts`, 11 em `hooks/**/*.py`. Dois lotes próprios.

## Capacidades novas desta sessão (todas com controles + mutation control)

- `underInheritedMachineGuard` — helper cujos chamadores estão TODOS sob
  `if (json)`. Universal; fecha em três portas (exportada, usada como valor,
  zero callsites). Consumida **apenas** por `modoDoPonto` — estendê-la às regras
  de frase mexeria em arquivos já reconciliados.
- `origemContadaDeSubprocesso` — repasse cru cuja origem já é contada no
  inventário. Fail-closed: sem injeção de `countedOrigins`, `unknown`.

## Achados de produto registrados (NÃO corrigidos — fora de classificação)

1. **`context <sub> --json` engole a flag como posicional.** `args[1]` é lido
   cru, então `context search --json` busca pelo termo `"--json"` e
   `context scout --json` responde como se a flag fosse a pergunta. Os ramos de
   recusa por omissão são inalcançáveis. Fixado como está em
   `tests/context_json_contract.test.js`, sem afirmar que está certo.
2. **`context search` está quebrado no repo real**: `sqlite3.OperationalError:
   no such column: d.duplicate_of` — o `context.db` em disco é de antes do
   `dedupe_pass()` do S51.5.3. Precisa de `context index --reindex`.
3. **`sofreMutacao` promete mais do que faz**: o comentário diz "reatribuído ou
   tem propriedade mutada" e ele só detecta mutação de PROPRIEDADE. Não foi
   alterado (é compartilhado com o avaliador abstrato); a cadeia nova exige
   `const` na própria porta.

## Regras de processo confirmadas / novas

- **Comentário de `i18n-inventory.js` não pode citar sintaxe de sink literal.**
  A 1ª versão de um comentário que DOCUMENTAVA a dupla contagem do scanner
  escrevia as chamadas por extenso, e o próprio scanner contou 3 pontos dentro
  dele — inflando o censo de 1924 para 1927.
- Mutation control é obrigatório e **encontrou 6 asserções fracas** nesta
  sessão. Padrão recorrente: porta que nunca pode recusar sozinha (removida) e
  asserção que compara conjuntos de sinks diferentes (o veredito vinha do canal,
  não da porta).
- Suíte i18n completa leva ~280s; sob carga da máquina passou de 10 min. Rodar
  em background e usar `--test-concurrency=2`.
- `evaluateJsonRun` devolve `doc` (já parseado) — não há `stdout` no retorno.
- cc ≤ 6 (QG L1 acusa HIGH acima); `||`/`?.`/`??`/ternário contam.

## Fora da Fase 1B — NÃO iniciado

Fatia 6 (CI determinístico do registry, stale control, regeneração byte a byte),
Fatia 7 (pacote sem devDependencies, import pela URL canônica), DOD.3a/3b/8/12,
RC matrix/checklist/ledger/receipts, e os blockers
P0.NODE-SUPPORT-GATE-INVALID / safe_support / P1.ARTIFACT-SOURCE-INFERRED.

**Nada disso foi tocado — não há status inflado a corrigir.** A suíte completa do
repositório também não foi rodada (marco ainda não atingido: o lote JS não chegou
a 0). A suíte i18n rodou 503/503 no meio da sessão.
