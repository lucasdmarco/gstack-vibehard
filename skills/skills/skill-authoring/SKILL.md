---
name: skill-authoring
description: Create reusable skills that extend agent capabilities. Use when the user asks to create a skill, teach you something reusable, or save instructions for future tasks.
---

# Skill Authoring (alias fino)

Este arquivo é um **alias fino** mantido apenas por compatibilidade de trigger com harnesses
que buscam `skill-authoring` pelo nome (o ID é preservado para não quebrar quem já aciona por
este nome). **A fonte canônica de autoria é `skill-creator`** — leia
`skills/skills/skill-creator/SKILL.md` e siga o processo, o template e o checklist de lá.

Não duplique aqui: template de SKILL.md, política de path, checklist de finalização, nem a
disciplina de aprendizado verificável (sinais de golden path, triagem skill|memory|skip,
dedupe, campos de evidência, staging/review, secrets por referência, freshness). Tudo isso vive
em `skill-creator` e deve ser mudado em um único lugar — manter dois manuais completos é
exatamente o problema que este alias existe para resolver.

## Quando usar

Mesmos gatilhos de `skill-creator`: o usuário pede para "criar uma skill", "ensinar algo
reutilizável" ou "salvar instruções para tarefas futuras". Ao acionar, encaminhe o processo
para `skill-creator`.
