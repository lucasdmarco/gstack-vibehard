# Design Detector: uma primeira regra real, não um motor completo

O GStack agora tem um detector nativo de design, mas ele é **honesto quanto ao seu
tamanho**: hoje ele só sabe checar **contraste WCAG** entre texto e fundo. Isso é o
resultado de vendorizar 124 das ~18.001 linhas do motor Impeccable (PRD49 S49.2A) — as
outras categorias de regra (tipografia, espaçamento, raio, responsividade, motion,
consistência de design system, anti-padrões mecânicos) ainda **não foram portadas**.

> `visual doctor` sempre mostra o placar real: quantas regras estão ativas vs. ainda não
> vendorizadas — nunca um número inflado.

## Comandos

```
gstack_vibehard visual doctor [--json]
gstack_vibehard visual detect <elements.json> [--json]
gstack_vibehard visual explain <rule-id> [--json]
gstack_vibehard visual check --url <url> [--run <id>] [--json]
```

`detect` **não faz scraping de DOM ou de URL ao vivo ainda** — ele lê um JSON estruturado
de elementos já extraídos:

```json
{ "elements": [
  { "selector": ".hero-subtitle", "color": "#777777", "backgroundColor": "#666666", "fontSize": 16, "fontWeight": 400 }
] }
```

Scraping de DOM real depende de `browser/injected/index.mjs` (1937 linhas do upstream),
que continua no backlog de `src/vendor/impeccable/upstream-map.md`.

## Advisory, nunca bloqueante — ainda

O achado de contraste aparece em `proof --profile full` (campo `checks.designDetector`)
e no delivery scorecard, mas como **advisory**: nunca vira `blocker`, nunca reprova um
release. Isso é deliberado — bloquear releases com base numa única regra vendorizada
seria prematuro. O gate (`design-detector-gate` em `src/skills/gate-matrix.js`) vira
`P1`/blocking quando mais regras do motor forem portadas em sprints futuras.

## Limite honesto desta versão

`visual detect` e o campo `checks.designDetector` do `proof` só avaliam contraste de cor.
Nenhuma outra categoria de finding é fabricada — `visual explain <rule-id>` para qualquer
regra ainda não vendorizada retorna `status: "not_yet_vendored"` com o motivo real
(arquivo upstream + linhas), nunca um resultado inventado.
