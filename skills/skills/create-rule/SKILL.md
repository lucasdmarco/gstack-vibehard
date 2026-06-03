---
name: create-rule
description: "Cria regras para contexto persistente do agente. Use quando quiser criar regras, adicionar padrões de código, configurar convenções de projeto, ou criar arquivos AGENTS.md."
---

# Creating Rules — AGENTS.md

No Codex, regras persistentes são arquivos `AGENTS.md` no projeto ou em `~/.codex/rules/`.

## Onde Colocar

| Localização | Escopo |
|-------------|--------|
| `<projeto>/AGENTS.md` | Projeto específico (lido automaticamente) |
| `~/.codex/rules/default.rules` | Global (todos os projetos) |

## Regras de Projeto

Crie ou edite `AGENTS.md` na raiz do projeto:

```markdown
## Stack
- React 19 + Vite + shadcn
- Express 5 + Drizzle + Supabase
- Vercel deploy

## Convenções
- Componentes em src/components/
- Páginas em src/pages/
- shadcn ui em src/components/ui/
- Tipos compartilhados em packages/shared/
- Nomes de arquivo em kebab-case
- Commits semânticos (feat:, fix:, chore:)
```

## Regras Globais

Adicione em `~/.codex/rules/default.rules`:

```
Você é um engenheiro de software sênior trabalhando em projetos TypeScript fullstack.
Stack padrão: React + Vite + shadcn + Express + Drizzle + Supabase + Vercel.
Sempre use componentes shadcn quando disponíveis.
Sempre use a auto-testing skill para testar UI no navegador.
```

## Boas Práticas

- **Conciso**: menos de 50 linhas por regra
- **Uma preocupação por regra**: separe concerns grandes
- **Acionável**: escreva como documentação interna clara
- **Exemplos concretos**: mostre exemplos de código ✅/❌
