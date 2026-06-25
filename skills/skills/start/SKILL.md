---
name: start
description: "Ponto de entrada guiado do gstack_vibehard — objetivo → plano → execução. É o PRIMEIRO comando que o usuário deve usar. Ativado por /start."
trigger: /start
---

# /start — Assistente guiado do gstack_vibehard

`/start` é a **porta de entrada** do gstack_vibehard. O usuário comum não precisa
decorar a CLI: o `/start` conduz do **objetivo** ao **plano** e à **execução**.

Mapeia para o comando real: `gstack_vibehard start`.

## O que o /start faz
1. **Pergunta o objetivo** (criar um app novo? ativar num projeto existente? só
   diagnosticar o ambiente?).
2. **Propõe um plano** determinístico (sem alucinar passos).
3. **Executa com confirmação**, oferecendo o caminho certo:
   - **Modo completo** (`create <nome> --full` / `install --yes`): instala a
     plataforma inteira (governança, memória, integrações). Use quando quiser tudo.
   - **Modo lite** (`create <nome>`): projeto leve e seguro, **sem tocar a máquina
     inteira** — é o único caminho enxuto.

## Como guiar o usuário
- Se ele **não sabe por onde começar**, rode/explique `/start`.
- Se ele quer **um projeto novo**, `/start` leva ao `create` (lite por padrão;
  `--full` para a plataforma completa) — ou use `/newproject` para o walkthrough
  de arquitetura passo a passo.
- Se ele quer **ativar num projeto existente**, `/start` orienta `enable`/`status`.
- No completo, `/start` oferece a instalação completa; no lite, explica que ele
  está escolhendo o caminho enxuto.

## Comandos relacionados
- `/newproject` — walkthrough de arquitetura (passo a passo de design).
- `gstack_vibehard doctor` — diagnóstico do ambiente.
- `gstack_vibehard verify` — delivery gates antes de declarar "pronto".
