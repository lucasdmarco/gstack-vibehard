---
id: gstack-aidd
name: GStack AIDD Methodology Pack
version: 1.0.0
description: Skill Pack que empacota o loop AI-Driven Dev do GStack (context→plan→execute→verify) como skills compiláveis para todos os harnesses.
---

# GStack AIDD Methodology Pack

Skill Pack GStack (PRD21 §4.3, PRD23 §6.5). **Evolui** o Agent Factory existente — não
cria fábrica paralela. As skills daqui são compiladas por
`scripts/scripts/build_agents.js` para `agents/generated/` (claude/codex/cursor/copilot/
gemini), com o **Execution Contract** anexado e passando pelo **scanner/AgentShield**
antes da geração.

## Princípios

- **Nenhuma action promete gate por LLM.** O gate é sempre determinístico (QG/Fallow/
  `verify`); a IA nunca aprova sozinha.
- Knowledge (consulta) nunca edita código; execution só age com worktree/gates.
- Referência metodológica (AIDD/lgsreal) **nunca** vira dependência runtime — ver
  `.docs/RESEARCH/repository-registry.json`.

## Conteúdo

Ver `CATALOG.md` para a lista de skills. Histórico em `CHANGELOG.md`.
