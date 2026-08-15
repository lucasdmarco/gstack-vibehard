# Handoff — PRD51 Fase 1B, sessão de 2026-08-15

HEAD ao encerrar: `c9dfa76`. Árvore limpa exceto `.docs/PLANS/prd52-54.md`, que
**não são desta sessão** (outra sessão trabalha neles em paralelo — nunca use
`git add -A` nesta árvore).

Sucede `.docs/PLANS/prd51-handoff-lote-js-20260814.md`.

## Estado

| | início | fim |
|---|---|---|
| total | 1906 | 1906 |
| unknown | 49 | **49** |
| convertidos | 8 | 8 |
| decisões | 66 | 66 |

**O censo não se moveu, e isso é honesto**: os três commits desta sessão são
capacidade e prova, não conversão. Duas conversões ficaram prontas para o próximo
passo (ver "Próximo passo imediato").

## Commits

1. `575c282` — **C-4(b)** `console-project-rendered-text`
2. `1c06c66` — prova pública de `visual --json` + consumidor declarado nas 2 camadas
3. `c9dfa76` — **estratégia `translate_at_value_origin`** + 22 controles

## O que mudou de entendimento (não repita minha hipótese errada)

### C-4(b): a hipótese de dupla contagem era falsa

O handoff anterior supunha que as frases de `visual.js:86` e `research.js:294`
viviam nos módulos chamados e **seriam contadas lá**, concluindo por
`render_primitive` (fora de escopo). **Medido: falso.**
`src/skills/design-feedback.js` e `src/epistemic/render.js` têm **zero** chamadas
de sink e **zero** pontos no inventário. Marcar como fora de escopo apagaria da
claim frases que o usuário lê.

Audiência correta: `public_diagnostic`, com campo novo `textOrigin` apontando
onde a frase mora. Há teste fixando o fato medido.

**Dívida real da MEDIÇÃO (não deste ponto)**: o inventário conta *pontos de
emissão*; texto montado em módulo que só retorna string é invisível para ele.
Fechar isso é mudar o modelo de medição da Fase 1B — não classificar melhor um
callsite. É um candidato a P1 do PRD52.

### A regra tem que ser a ÚLTIMA de `JS_RULES`

Escrita antes de `command-human-branch`, ela roubava **15 pontos de
`monitor.js`** (arquivo convertido). Audiência não mudava; o `rule` gravado sim →
15 linhas de churn no artefato commitado sem corrigir nada. Há teste de
regressão, com controle do próprio controle.

### Fixture em diretório temporário NÃO resolve lib nem node_modules

Descoberto pelo mutation control (M1 não quebrava nada). `textOrigin` sai `null`
com a porta e sem ela. Negativos desse tipo **precisam** ser ancorados no
repositório real. A porta "declaração dentro do projeto" permanece no motor como
fail-closed **não exercitada por caso real hoje** — dito por extenso no teste, em
vez de simulado.

### Âncora de mutation control precisa de ESCOPO

`&& p.underMachineGuard !== true` existe em várias regras; substituir a primeira
ocorrência muta a regra errada e o mutante não quebra nada. Sempre buscar a
partir do `id:` da regra.

## `translate_at_value_origin` — aprovada com contrato de 12 pontos

Implementada em `src/meta/i18n-js-registry-loader.js`. Exige, por valor:
`id`, `origin.{file,line,column,expectedFileHash}`, `sourceKind` fechado
(`ORIGIN_SOURCE_KINDS = ["project_module_literal"]`), `reason`/`owner`/`evidence`;
mais `translationSite: "value_origin"` na decisão. Proíbe `category`. Verifica a
origem **em disco** e confere o **hash do arquivo de origem**.

**Divisão de responsabilidade (pontos 6 e 7 do contrato):** o loader é runtime
sem TypeScript por contrato, então *não* verifica que a origem resolve para um
literal traduzível nem que há uma só origem possível. Isso é provado **na
conversão de cada arquivo**, lendo o código. Está escrito no comentário da
função.

### Apuração das três origens — só DUAS são elegíveis

| ponto | origem | veredito |
|---|---|---|
| `research.js:195` `p.message` | `src/tools/notebooklm.js:20`, literal único e estático | **elegível** |
| `visual.js:97` `rule.description` | `src/skills/design-rule-registry.js:20`; hoje há **uma** regra `active`, e o hash da origem trava divergência futura | **elegível** |
| `context.js:201` `d.evidence` | `out.results` do **context scout** = documentos INDEXADOS DO USUÁRIO | **BLOQUEIA** (ponto 7: origem externa/dinâmica) |

`context.js` precisa de outro tratamento. A audiência `user_content` existe no
vocabulário e **nunca foi usada** — é o candidato natural, e exige capacidade
própria com controles.

## Próximo passo imediato (tudo já preparado)

### 1. Converter `visual.js` — prova e declaração JÁ commitadas

Falta só: adicionar a `CONVERTED_FILES`, regenerar e escrever **18 decisões**
(17 `interpolated` + 1 `translate_at_value_origin` para `:97`).
Âncoras pendentes medidas: linhas 28, 30, 31, 63, 64, 79, 84, 85, 93, 95, 96,
**97**, 98, 194, 203, 211, 212, 219.
`fileHash` na regeneração: recalcular (muda a cada edição do arquivo).

Lacuna declarada e já escrita nas duas camadas: `visual.js:138`
(`emitCancelled`) é **TTY-only** — sem TTY o fluxo para em
`hooksInstallRefused`, que a prova cobre.

### 2. Converter `research.js`

Falta: prova pública de `research --json` (5 pontos: 129, 134, 168, 180, 292) +
15 decisões, uma delas `translate_at_value_origin` para `:195`.

### 3. Só então o resto dos 24 pontos JS

- **prova pública ausente**: `install.js:475`; `runtime-supervisor.js` 45/247
  (`dev`), 278/317 (`stop`) — o arquivo é alcançado por **4 comandos** e a âncora
  é UNIVERSAL: provar `dev` não cobre `logs`.
- **`<anon>` legítimos, devem continuar inalcançáveis**: `install.js:359`,
  `runtime-supervisor.js` 346/389.
- **fora do DISPATCH**: `task-run.js` 43/97 (`entrypointsPorComando` devolve
  `null` — investigar antes de assumir capacidade nova);
  `gstack-session.js` 33/51/93.
- **C-5 cauda**: `sync-qg-version.mjs` (2), `clean-pkg.mjs` (1).
- **C-4(a) passthrough de subprocesso**: `context.js` 249/260/278/280 —
  `external_passthrough` existe no vocabulário mas **não tem regra em
  `JS_RULES`**; é inalcançável por design, com teste negativo garantindo.
  Exige estender o avaliador abstrato. **Sprint próprio.**

Terminal do lote JS é **unknown 24**; sobram 16 em `templates/**.ts` e 9 em
`hooks/**.py`, que são outros dois lotes.

## Fora da Fase 1B — ainda não iniciado nesta sessão

Fatia 6 (CI determinístico do registry, stale control, regeneração byte a byte),
Fatia 7 (pacote sem devDependencies, import pela URL canônica), DOD.3a/3b/8/12,
RC matrix/checklist/ledger/receipts, e os blockers
P0.NODE-SUPPORT-GATE-INVALID / safe_support / P1.ARTIFACT-SOURCE-INFERRED.
Nada disso foi tocado — **não há status inflado a corrigir**.

## Regras de processo confirmadas

- cc ≤ 6 (QG L1 acusa HIGH acima); `||`/`?.`/`??`/ternário contam.
- `node --test --test-concurrency=2` (máquina sob carga).
- `git add` explícito por arquivo — outra sessão na mesma árvore.
- Suíte completa só nos marcos; não por arquivo.
- `evaluateJsonRun` expõe `doc`/`exitCode` e **não** asserta código de saída
  (política aberta como P1) — não decidir por baixo.
