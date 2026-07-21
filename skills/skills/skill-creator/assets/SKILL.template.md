---
name: <skill-name>
description: <What this enables + When it triggers. Be specific about trigger phrases.>
---

# <Skill Title>

## What / When

- What this skill does: <1-2 frases>.
- When it triggers: <frases/gatilhos concretos>.

## Failure pattern

<id estável + resumo redigido do que dava errado antes deste golden path — vazio
só se este for um procedimento positivo sem falha prévia registrada.>

## Verified by

<como a promoção foi comprovada: teste real, comando E2E, run id — nunca "parece
funcionar".>

## Procedure

1. <passo bounded e redigido>
2. <passo bounded e redigido>

## Verification

<como confirmar que o procedimento funcionou — comando/gate/teste real.>

## Gotchas

<armadilhas conhecidas ao seguir este procedimento.>

## What did not work

<dead ends descartados — o que foi tentado e abandonado, com assinatura estável,
para não ser re-tentado no futuro.>

## Secret refs

<NOMES de variável (nunca valores) que este procedimento referencia, se algum.>

## Provenance

- runId: <run de origem>
- chainHash: <hash da cadeia de recibos>
- scope: project

## Freshness probes

<comandos/arquivos que, se mudarem, invalidam este conhecimento — usados pelo
drift/freshness doctor para marcar `stale` em vez de manter autoridade eterna.>
