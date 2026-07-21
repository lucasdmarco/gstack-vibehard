---
name: create-rule
description: "Cria regras para contexto persistente do agente. Use quando quiser criar regras, adicionar padrões de código, configurar convenções de projeto, ou criar arquivos AGENTS.md."
---

# Creating Rules — AGENTS.md

No Codex, regras persistentes são arquivos `AGENTS.md` no projeto ou em `~/.codex/rules/`. Esta
skill é um **adapter autorizado, project-scoped por default** — não um atalho para editar
`AGENTS.md` livremente.

## Governança (obrigatória antes de escrever)

- **Project-scoped por default.** Toda regra gerada por esta skill vai para
  `<projeto>/AGENTS.md`, a menos que o usuário peça explicitamente escrita global.
- **Escrita global exige consentimento separado.** Editar `~/.codex/rules/default.rules` afeta
  TODOS os projetos — nunca faça isso como efeito colateral de um pedido project-scoped. Peça
  confirmação explícita, faça backup do arquivo atual antes de editar, e explique como
  restaurar (`cp default.rules.bak default.rules`) caso o usuário queira reverter.
- **Não anexe conteúdo arbitrário.** Não copie trechos de conversa direto para `AGENTS.md`.
  Gere a regra a partir de uma fonte canônica já aprovada (uma skill promovida via
  `skill-creator`, ou uma decisão que o usuário confirmou explicitamente nesta conversa) —
  nunca de um rascunho não revisado.
- **Registre proveniência.** Ao gravar uma regra, anote de onde ela veio (skill promovida, id do
  run, ou confirmação direta do usuário) e um hash/data da versão gravada, para que drift seja
  detectável depois.

## Onde Colocar

| Localização | Escopo |
|-------------|--------|
| `<projeto>/AGENTS.md` | Projeto específico (lido automaticamente) — **default** |
| `~/.codex/rules/default.rules` | Global (todos os projetos) — **só com consentimento explícito, backup e caminho de restore** |

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

## Regras Globais (só com consentimento explícito)

Antes de tocar em `~/.codex/rules/default.rules`: confirme com o usuário que ele quer escrita
GLOBAL (não apenas deste projeto), faça backup do arquivo atual, e informe como restaurar. Só
então adicione em `~/.codex/rules/default.rules`: 

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
