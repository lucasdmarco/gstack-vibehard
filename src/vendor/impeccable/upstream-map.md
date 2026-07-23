# Upstream provenance map — pbakaus/impeccable

Fonte: https://github.com/pbakaus/impeccable
Commit auditado: `4d849eb75f216109ea7053ed21530a11fafcc786` (2026-07-21, "Sync generated provider output")
Licença: Apache-2.0 (ver `./LICENSE`, cópia verbatim)

Este documento é a fonte de verdade de **o que foi copiado e o que mudou**. Todo arquivo
vendorizado precisa de uma linha aqui. `status` é sempre `unchanged | modified | rewritten`.

## Escopo desta sprint (S49.2A, primeiro recorte real)

O motor real do Impeccable (`cli/engine/`) tem **25 arquivos, ~18.001 linhas** (medido nesta
sessão via mirror read-only real). Portar o motor inteiro com a mesma disciplina de proveniência
por arquivo, testes de paridade e revisão de licença exigida por este projeto é maior que uma
sprint — este primeiro recorte prova o padrão com um módulo real, pequeno, autocontido e sem
dependência de Node 22, e declara honestamente o que falta.

| Arquivo GStack | Caminho upstream (no commit auditado) | SHA-256 upstream | Status | Nota |
|---|---|---|---|---|
| `shared/color.mjs` | `cli/engine/shared/color.mjs` | `sha256:0cd507353b164949ed821dc22efd124deb4a4608efdb1c5d5ef0bebef9c64aaa` | `unchanged` | Byte-idêntico ao upstream. Puro/sem dependência externa; já roda em Node 18 sem alteração (regex + Math, nenhuma API específica do Node 22). Usado pelas regras de drift de cor/contraste (§4.3 pontos 1 e 4 do PRD49). |

## Explicitamente NÃO vendorizado ainda (backlog real, por tamanho medido)

| Caminho upstream | Linhas | O que é | Por que ainda não |
|---|---:|---|---|
| `cli/engine/detect-antipatterns-browser.js` | 5245 | detector de anti-padrões via browser/DOM real | maior arquivo do motor; depende de contrato de browser que precisa normalizar contra o Playwright já existente do GStack (S49.2B) antes de portar |
| `cli/engine/rules/checks.mjs` | 2703 | catálogo de regras determinísticas (tipografia/cor/spacing/radius/responsive/motion) | é o núcleo das 7 regras determinísticas do §4.3 do PRD49 — precisa de porte cuidadoso arquivo-a-arquivo, não em lote |
| `cli/engine/browser/injected/index.mjs` | 1937 | script injetado no browser pelo detector rendered | acoplado ao motor de browser upstream; normalizar contra Playwright antes de portar |
| `cli/engine/engines/static-html/css-cascade.mjs` | 1015 | resolução de cascata CSS para análise estática | dependência do detector source; entra junto com `rules/checks.mjs` |
| `cli/engine/design-system.mjs` | 921 | compilador de contexto de design system upstream | equivalente upstream do que `src/skills/design-context.js` (S49.1) já faz do lado GStack — precisa de decisão explícita de qual lógica é redundante antes de portar |
| `cli/engine/engines/regex/detect-text.mjs` | 761 | detector de texto por regex (fonte estática) | próximo candidato natural após `rules/checks.mjs` |
| `cli/engine/registry/antipatterns.mjs` | 514 | catálogo de anti-padrões de IA genérica | mapeia ao ponto 8 do §4.3 (regras mecânicas vs revisão semântica) |
| `cli/engine/cli/main.mjs` | 321 | CLI upstream | **excluído por design** — GStack nunca importa o CLI/instalador upstream (só oráculo de conformidade em dev, nunca runtime) |
| `cli/engine/engines/browser/detect-url.mjs` | 277 | detector rendered via URL | normaliza pro Playwright existente (S49.2B) |
| `cli/engine/engines/static-html/detect-html.mjs` | 234 | detector HTML estático | entra com `rules/checks.mjs` |
| `cli/engine/node/file-system.mjs` | 198 | I/O de arquivo do CLI upstream | provavelmente substituído por I/O nativo do GStack, não portado |
| `cli/engine/engines/visual/screenshot-contrast.mjs` | 189 | contraste via screenshot | candidato a normalizar pro gate visual existente, não copiar cru |
| `cli/engine/profile/profiler.mjs` | 166 | perfilamento de execução do CLI upstream | ferramenta de dev upstream, não necessariamente vendorizável |
| `cli/engine/shared/inline-ignores.mjs` | 148 | parsing de comentários de ignore inline | candidato de porte simples, próxima sprint |

**Total ainda não vendorizado nesta sprint: ~24 arquivos, ~17.877 linhas.**

## Regra de atualização

Todo novo arquivo copiado precisa de uma entrada nesta tabela ANTES do commit que o adiciona.
`modified`/`rewritten` exigem uma nota explicando a mudança (nunca só "adaptado"). Revisão de
drift/atualização/revogação é responsabilidade do PRD46 (pipeline de promoção de skill).
