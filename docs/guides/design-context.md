# Design Context: uma decisão, várias projeções

O GStack tem **uma única fonte de verdade** para design: `.gstack/design-system.json`
(mais o Product Brief do projeto). Você não mantém duas estratégias de design separadas.

> A **decisão canônica** decide; as **projeções são geradas**, nunca editadas por você
> diretamente.

## O que é gerado

A partir do estado canônico, o GStack pode projetar:

- `PRODUCT.md` — objetivo do produto, a partir do Product Brief;
- `DESIGN.md` — direção de design declarada (ou o registro honesto de que você optou por
  `--design-system none`, o que **nunca** vira uma alegação de que a qualidade de design
  foi validada);
- `.impeccable/design.json` — sidecar compatível com ferramentas externas de lint de
  design, gerado a partir dos mesmos tokens canônicos.

Cada projeção carrega um `sourceHash`: o mesmo estado canônico sempre produz o mesmo
hash. Isso é o que permite detectar **drift** — se o `design-system.json` mudar depois
que uma projeção foi gerada, a projeção existente fica `stale`.

## Edição humana nunca é sobrescrita silenciosamente

Se você editar `PRODUCT.md`/`DESIGN.md` diretamente, o GStack detecta a divergência (o
conteúdo em disco não bate com o que ele geraria) e propõe um **plano de reconciliação de
3 vias** — canônico, o que está em disco, o que seria gerado agora — em vez de sobrescrever
sua edição sem avisar.

## Ver o preview sem escrever nada

```
gstack_vibehard start "<objetivo>" --dry-run --json
```

O campo `designContext` do JSON mostra o `sourceHash` e a lista de arquivos que **seriam**
gerados — nada é escrito no disco em modo dry-run.

## Limite honesto desta versão

Nesta sprint (PRD49 S49.1), o bridge gera as projeções e detecta drift/edição humana como
funções puras e testadas. O comando de escrita real das projeções e o gate de drift no
fluxo do `start` chegam em sprints seguintes — hoje, `start --dry-run` mostra o preview,
mas a geração efetiva ainda não está ligada ao pipeline principal.
