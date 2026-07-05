---
name: guided-delivery
description: Loop AI-driven do GStack — entender contexto, planejar, executar com gates e verificar de forma determinística.
tools: Read, Grep, Glob, Bash
model: inherit
skills: context, plan, task, verify
---

# Guided Delivery (skill roteadora)

Roteador curto: escolha a action pela fase da entrega. **Nunca pule para `execute` sem
`plan`, nem para publicar sem `verify` verde.** O gate é sempre determinístico —
esta skill não aprova nada por conta própria.

- Preciso entender o que vou mudar → `actions/01-plan.md` (knowledge, read-only).
- Tenho plano e vou implementar → `actions/02-execute.md` (execution, worktree/gates).
- Terminei e preciso provar "pronto" → `actions/03-verify.md` (gate determinístico).

Referência metodológica: trilha `.docs/TRAILS/ai-driven-dev/`. Nunca vira dependência
runtime.
