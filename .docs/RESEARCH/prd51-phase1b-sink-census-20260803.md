# PRD51 · Fase 1B — censo de sinks de saída JS (medição point-in-time)

> **Isto é uma medição datada, não um invariante.** Os números abaixo mudam a
> cada commit que adiciona ou remove uma chamada de saída. Nenhum deles deve ser
> congelado em comentário de código, mensagem de teste ou asserção. O código
> descreve o problema em termos não perecíveis ("mais de cem ocorrências
> distribuídas por dezenas de arquivos"); a quantia exata vive aqui.

## Âncora

| Campo | Valor |
|---|---|
| Data | 2026-08-03 |
| Commit | `ad40cc741f25a8a287f457f045ac9a5b355a79eb` |
| Engine | `scripts/lib/i18n-js-ast.mjs` (Fatia 1.2) |
| Escopo | `src/**/*.js` |

## Resultado

| Métrica | Valor |
|---|---|
| Arquivos analisados | 332 |
| Pontos de saída extraídos | 1784 |
| Sinks de stream (`process.stdout/stderr.write`) | **129** |
| Arquivos contendo sinks de stream | **38** |

Método: `createAnalyzer` sobre os 332 arquivos, `analyzeFile` em cada um,
contagem de pontos com `sink !== null`.

## Divergência com varredura textual — e por que o AST vence

Um `grep` por `process\.(stdout|stderr)\.write\s*\(` reporta **131 em 39
arquivos**. Os dois excedentes são **citações em comentário**, não chamadas:

| Arquivo | Linha | Natureza |
|---|---|---|
| `src/meta/i18n-inventory.js` | 214 | comentário JSDoc citando o padrão |
| `src/commands/runtime-supervisor.js` | 386 | comentário citando o padrão (sem `(`, some com o regex mais estrito) |

O AST não os conta, e está correto. **Paridade com grep não é critério de
verdade** — é o método que esta fase existe para abandonar. O contrato está
codificado em dois testes de `tests/i18n_js_ast_sinks.test.js`:

- `CONTROLE: arquivos reais nao perdem nenhum process.*.write na conversao` —
  em quatro arquivos reais o AST acha exatamente o que a varredura textual acha;
- `CONTROLE INVERSO: citacao em comentario nao vira ponto de saida` — no único
  arquivo onde divergem, o AST acha 0 e o grep acha 1.

Registro de processo: na primeira tentativa apontei `runtime-supervisor.js` como
o arquivo divergente. Foi erro meu — usei um regex sem `\(` no diagnóstico e um
com `\(` no teste. O teste falhou e a medição foi refeita; o arquivo divergente
sob o regex estrito é `i18n-inventory.js`.

## Por que o censo importa

`process.stdout.write` / `process.stderr.write` não eram extraídos antes da
Fatia 1.2: `write` não está em `SINK_NAMES` e `process.stdout` não é
identificador simples. Se o registry da Fatia 2 fosse gerado sem eles, **cada
arquivo migrado do regex para o AST perderia seus sinks** — o inventário
encolheria sem que classificação alguma tivesse sido feita, e o número oficial
da Fase 1B pareceria melhorar por subtração.

Os 129 sinks são extraídos com `calleePath` e `sink`, e classificados como
`unknown`: visíveis e pendentes, nunca ausentes.

## Estado oficial da Fase 1B nesta data

**125 unknown**, inalterado. As Fatias 1, 1.1 e 1.2 não tocam
`src/meta/i18n-inventory.js`; o consumo do registry pertence à Fatia 3.
