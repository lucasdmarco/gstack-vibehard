# Aula 05 — GStack na prática (o loop completo)

> Trilha AI-Driven Dev · referência metodológica AIDD, **nunca** dependência runtime.
> **Ler esta trilha não instala nada.**

## Objetivo

Fechar o ciclo AI-driven de ponta a ponta no GStack: **consultar → planejar → executar
com gates → verificar → publicar**. Você conecta cada fase da metodologia AIDD a um
comando real do GStack.

## Comandos GStack reais (o loop)

```bash
gstack_vibehard start                       # 1. onboarding guiado (seguro)
gstack_vibehard context scout "<tarefa>" --json   # 2. knowledge: entender antes de agir
gstack_vibehard plan                        # 3. gerar plano (não executa sozinho)
gstack_vibehard task                        # 4. execução GATED (worktree + provenance)
gstack_vibehard verify --json               # 5. gates de qualidade
gstack_vibehard publish-guard               # 6. portão de PR/merge
```

Para pipelines multi-agente: `gstack_vibehard orchestrate` e `gstack_vibehard delegate`
(execution, com worktree + provenance + hard cap). Consulta/crítica sem editar:
`gstack_vibehard consult` e `gstack_vibehard challenge`.

## Mapa AIDD → GStack (referência, não código)

| AIDD | Equivalente GStack | Acoplamento |
|---|---|---|
| `aidd-context` | `context scout`, `context index`, Graphify, FTS | Knowledge, read-only |
| `aidd-refine` | `consult`, `challenge` | Não edita código |
| `aidd-pm` | `plan`, `start`, PRDs | Gera plano, não executa sozinho |
| `aidd-dev` | `task`, `workflow`, `verify`, QG | Execução só com gates |
| `aidd-vcs` | `worktree`, `publish-guard` | PR/merge só após `verify` |
| `aidd-orchestrator` | `orchestrate`, `delegate` | Worktree + provenance + hard cap |
| `aidd-ui` | dashboard/TUI (futuro) | Defer — não copiar alpha |

## Erros comuns

- Pular a fase knowledge e ir direto ao `task` — contexto ruim, execução pior.
- Rodar `publish-guard` sem `verify` verde.
- Tratar a metodologia como algo a **instalar** — ela é trilha/documentação.

## Checklist

- [ ] Você executou o loop `context → plan → task → verify → publish-guard`.
- [ ] Toda execução passou por worktree (nada direto no branch principal).
- [ ] QG CRÍTICO/ALTO = 0 antes do `publish-guard`.

## Exercício prático

Pegue uma tarefa pequena e rode o loop inteiro numa worktree. Registre em qual fase o
GStack te impediu de "pular etapa" e por quê.

## Como validar

```bash
gstack_vibehard verify --profile full --json && gstack_vibehard publish-guard
```

## Como desfazer / rollback

Todo o loop roda em worktree isolada. Reverta com `git` no worktree; se instalou algo via
`start`, use `gstack_vibehard uninstall --dry-run` para ver o plano antes de remover.
