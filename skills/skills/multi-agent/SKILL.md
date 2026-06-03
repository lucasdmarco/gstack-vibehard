# Multi-Agent Skill

Workflow plan-verify-execute com subagentes do Codex para tarefas complexas.

## Workflow

1. **Plan** (subagente planner): analisa requisitos, define arquivos, riscos
2. **Implement** (subagente executor): implementa mudanças seguindo o plano
3. **Verify** (subagente reviewer): revisa bugs, segurança, performance

## Uso

```
Use multi-agent workflow para [tarefa complexa]:
1. Subagente planner: planeje a implementação
2. Subagente executor: implemente seguindo o plano
3. Subagente reviewer: revise o resultado
```

Subagentes são nativos do Codex (`/subagent`). Use esta skill para orquestração.

Para tarefas simples (< 10 arquivos), um só agente é mais eficiente.
Multi-agente é para refatorações, migrações e features complexas.
