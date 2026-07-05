# Aula 04 — Modernização e refactoring com IA

> Trilha AI-Driven Dev · referência metodológica AIDD, **nunca** dependência runtime.
> **Ler esta trilha não instala nada.**

## Objetivo

Usar o contexto local (Document Graph + Graphify) para refatorar com segurança em vez de
abrir 40 arquivos no escuro. Você aprende a **entender a topologia antes de mudar** e a
manter frescor de ferramentas com o Action Close refresh.

## Comandos GStack reais

```bash
gstack_vibehard context index --reindex      # (re)indexa docs no grafo local (SQLite/FTS5)
gstack_vibehard context scout "<tema>" --json --mode decision_context
gstack_vibehard tools readiness --json       # estado das ferramentas locais (honesto)
gstack_vibehard tools refresh --changed --json   # refresca grafo/contexto/fallow do que mudou
```

- `context` é knowledge/read-only; `tools refresh` é execution (escreve relatórios em
  `.gstack/`, nunca toca config global).
- Prefira `graphify-out/GRAPH_REPORT.md` para topologia antes de abrir muitos arquivos.

## Erros comuns

- Refatorar sem reindexar: decisões antigas contaminam o scout.
- Abrir arquivos por adivinhação em vez de usar o grafo de topologia.
- Achar que `tools refresh` melhora tokens sozinho — ele só mantém dados frescos.

## Checklist

- [ ] `context index --reindex` termina com `FTS=on`.
- [ ] Você usou `context scout ... --mode decision_context` antes de editar.
- [ ] `tools readiness --json` reflete o estado real (verdict pode ser `unknown`).

## Exercício prático

Escolha um módulo, rode `context scout "<módulo>" --json --mode decision_context` e liste
as decisões históricas antes de propor a refatoração. Rode `tools refresh --changed` e
compare o readiness antes/depois.

## Como validar

```bash
gstack_vibehard verify --json   # a refatoração só "conta" quando o perfil passa
```

## Como desfazer / rollback

Refatore sempre em **worktree** (`gstack_vibehard worktree`) para isolar. Reverta com
`git restore` no worktree; `tools refresh` só escreve em `.gstack/` (gitignored).
