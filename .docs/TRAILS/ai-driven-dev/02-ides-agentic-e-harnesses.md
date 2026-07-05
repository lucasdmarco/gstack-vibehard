# Aula 02 — IDEs agentic e harnesses

> Trilha AI-Driven Dev · referência metodológica AIDD, **nunca** dependência runtime.
> **Ler esta trilha não instala nada.**

## Objetivo

Entender o que é um *harness* (Claude Code, Codex, OpenCode, Gemini, Cursor, Copilot) e
como o GStack aplica **enforcement real vs instrucional** por harness. Você aprende a ler
a matriz de capacidades honesta (o que é `real`, `callable`, `opt-in`, `roadmap`).

## Comandos GStack reais

```bash
gstack_vibehard doctor                 # diagnóstico geral do ambiente
gstack_vibehard doctor --opencode      # OpenCode Doctor v2 (config sagrada, read-only)
gstack_vibehard agents build --check   # confere drift dos adapters gerados por harness
```

- `doctor` é knowledge/read-only; `agents` é execution (o `build` escreve
  `agents/generated/`, mas `--check` só compara).

## Erros comuns

- Assumir que "detectou o harness" = "controla o harness". Detecção ≠ enforcement.
- Editar config global do harness — **proibido** sem pedido explícito do usuário.
- Renomear/consolidar `.jsonc` do OpenCode: config é **sagrada**, byte-for-byte.

## Checklist

- [ ] `gstack_vibehard doctor --opencode` roda e não altera nenhum arquivo.
- [ ] Você sabe distinguir enforcement `plugin_backed` de `rules_only`.
- [ ] Entendeu que Headroom é `callable_not_routed` até `headroom doctor` provar.

## Exercício prático

Rode `gstack_vibehard doctor --opencode` e leia as categorias (system/config/plugins/
skills/models/residue). Identifique uma recomendação e explique por que é `rules_only`
ou `plugin_backed`.

## Como validar

```bash
gstack_vibehard agents build --check   # deve reportar "sem drift" após um build limpo
```

## Como desfazer / rollback

O `doctor` é read-only — nada a desfazer. Se rodou `agents build`, o `--check` mostra o
diff; reverta com `git checkout -- agents/generated/` no seu worktree.
