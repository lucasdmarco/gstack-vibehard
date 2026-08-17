# PRD51 — Handoff: lotes TypeScript e Python, Fatias 6 e 7

**Data:** 2026-08-17 · **HEAD:** `0575e54` · **Base da sessão:** `efb1d8f`

## Estado medido (não declarado)

```
censo        1907 total · 5 unknown · 25 arquivos convertidos
registry     fresh · 207 decisões aplicadas === 207 declaradas · 2 overrides === 2
provenance   ok:true · unresolvedProvenance 0 · missingProvenance 0
audit        machineProtocolAudit ok:true, semConsumidor []
phase1Gate   ok:FALSE — "5 ponto(s) de saída sem audiência determinada"
suíte        3263 testes · 3262 pass · 0 fail · 1 skip conhecido · EXIT=0
QG L1        0 blockers · lint 791 · diff --check limpo
pack         `test:pack` OK (11 checks), tarball v5.107.0
prd51        ready:false · programComplete:false · DoD 19/24 · P0 pendente 1 · P1 aberto 1
```

Delta da sessão: **1916 → 1907 total** (−9, todos falso positivo do regex) e
**27 → 5 unknown** (−22).

## O que fechou

| Commit | O quê |
|---|---|
| `f29d64b` | Regra `generated-dev-console` — `console.*` sob raiz de template DECLARADA |
| `910ac7e` | Regra `generated-framework-logger` — `app.log.error(err)` por cadeia até pacote |
| `b08a6c0` | Conversão dos 8 arquivos do template — **unknown TS = 0** |
| `c98ea75` | Fatia dos hooks Python — 6 de 11, e o achado dos 2 hooks órfãos |
| `9e13439` | Fatia 6 — `i18n:registry:check`, CI reprova registry stale |
| `0575e54` | Fatia 7 — prova executável de `npm pack` sem devDependencies |

## BLOQUEIO ÚNICO — precisa de decisão sua

Os 5 `unknown` restantes são **um só problema**, e não cinco:

```
hooks/hooks/before_shell.py:44
hooks/hooks/gc.py:183, 189, 195, 272
```

**O achado.** `before_shell.py` e `gc.py` são **copiados pelo instalador**
(`codex.js` copia todo `.py` do diretório de hooks) e **nenhum harness os
registra em evento algum** — `claude.js` registra 5 eventos, `codex.js` 4, e nem
um nem outro os cita. Nada no repositório os spawna nem parseia a saída deles.

Os outros três hooks têm consumidor provado e por isso fecharam:

| hook | consumidor | evidência |
|---|---|---|
| `qg.py` | `verify-runner.js:294` | `json.loads(r.stdout)` em `test_qg_fail_closed.py` |
| `post_sprint.py` | `sprint.js:77` | `JSON.parse` do stdout, campo a campo |
| `post_tool_use_review.py` | `PostToolUse` (`claude.js:109`) | `json.loads(p.stdout)` no teste |

**Por que não classifiquei assim mesmo.** `machineProtocolAudit` existe para
impedir que `machine_protocol` vire depósito, e ele reprovou — corretamente.
Declarar consumidor para esses dois seria inventar contrato. Os pontos ficam
`unknown` e **bloqueiam a Fase 1B**, que é o efeito correto e o oposto de
entrarem calados na claim English-first.

**Assimetria entre os dois.** `before_shell.py` não aparece em lugar nenhum —
é candidato a código morto, mesma classe do downloader remoto duplicado que já
foi removido de `create.js`. `gc.py` é diferente: `init.js:134` e
`scripts/scripts/setup-gstack.*` escrevem `quality_gate.gstack_check` apontando
para ele em configs que o produto distribui. Nada no repositório LÊ essa chave,
mas ela é wiring publicado. **Não são o mesmo caso e não devem receber a mesma
decisão.**

### Opções

1. **Registrar** os hooks em eventos reais → ganham consumidor, os 5 pontos
   fecham como `machine_protocol`, Fase 1B encerra. Muda comportamento do
   produto.
2. **Remover** `before_shell.py` (morto) e decidir `gc.py` à parte. Reduz o censo
   por remoção real de superfície.
3. **Aceitar consumidor DOCUMENTADO** como prova (o agente segue a instrução e
   roda o hook) → exige alargar o contrato de `MACHINE_PROTOCOL_CONSUMERS`, hoje
   restrito a consumidor apontável em código ou teste.

Recomendo (2) para `before_shell.py` e (1) para `gc.py`: é a única combinação em
que nenhuma das duas afirmações fica sem lastro.

## Etapas 6–9: por que não avançaram

Nenhuma é dívida técnica; todas dependem do fechamento acima ou de decisão sua.

- **DOD.3 (a/b) e DOD.23** são caixas `runtime`: só valem no **commit final do
  RC**, e o RC não existe enquanto a Fase 1B estiver aberta.
- **DOD.8** (residuais P1) depende da sua decisão sobre os residuais — é
  exatamente o item que o §11 deixou para você.
- **DOD.12** está `partial` por **recorte explícito do S51.4.5** (2 das 5
  detecções exigiriam catálogo de subcomandos e flags que não existe). Fechá-lo
  é decidir o recorte, não implementar.
- **Reconciliação (RC matrix / ledger / receipts / status público)** só é honesta
  depois que o censo final existir.

## Regras de trabalho confirmadas nesta sessão

- **Comentário deste módulo não pode citar sintaxe de sink literal** — o scanner
  conta o próprio comentário. (Já conhecido; continua valendo.)
- **`unknown: 0` é necessário, não suficiente**: medir `unresolvedProvenance`
  antes e depois de declarar qualquer arquivo convertido.
- **Mutation control achou 5 asserções fracas** nesta sessão. Padrão novo: porta
  que o **repositório real não exercita** (unanimidade de atribuições,
  continuação multilinha, escopo de função) — só morre com fixture sintética.
  Foi por isso que `pythonContext` passou a ser exportada.
- **QG L1 reprovou duas vezes por CC 10** em função nova. Decompor em uma porta
  por função é mais barato que argumentar com o gate.
- **`--test-concurrency=2`**; suíte i18n ~280s, suíte completa passa de 600s →
  rodar em background.
- Byte-comparação de artefato gerado precisa **normalizar fins de linha**:
  `core.autocrlf` faz o mesmo commit ter bytes diferentes por SO.

## Não tocado, por instrução

`.docs/PLANS/prd52.md`, `prd53.md`, `prd54.md` (outra sessão) · nenhuma operação
de worktree · nenhum `.env*` · `P1.CLI-JSON-EXIT-CODE` segue `pending` com
`fixAuthorized:false` e seus três findings · nada publicado no npm.
