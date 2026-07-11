---
name: new-project
description: "Escaffolda um novo projeto fullstack completo em segundos. Copia o template monorepo com React + shadcn + Vite + Express + Drizzle + Supabase + Vercel. Use quando o usuário disser 'quero criar um novo projeto' ou algo similar."
---

# New Project — Scaffold Rápido

Cria um projeto fullstack completo copiando o template em `~/.agents/templates/fullstack-monorepo/`.

## Fluxo Único

Quando o usuário pedir para criar um novo projeto, FAÇA:

```text
# 1. Perguntar nome do projeto (se não foi dito)

# 2. Criar diretório e copiar template
mkdir "nome-do-projeto"
cd "nome-do-projeto"
robocopy "$env:USERPROFILE\.agents\templates\fullstack-monorepo" "." /E

# 3. Renomear pacotes no package.json
# "my-project" → nome do projeto
# "@my/web" → "@nome/web"
# "@my/api" → "@nome/api"
# "@my/db" → "@nome/db"
# "@my/shared" → "@nome/shared"

# 4. Instalar
pnpm install

# 5. Adicionar shadcn extras (perguntar quais ou usar defaults)
npx shadcn@latest add table form dialog select dropdown-menu badge avatar

# 6. PERGUNTAR sobre cada ferramenta do ecossistema
#    (seguir a project-init skill para a ordem e perguntas)

# 7. CRIAR REPOSITÓRIO GITHUB (PERGUNTAR PRIMEIRO)
#    Se o usuário confirmar:
#    - Executar: gh repo create <nome> --private --source=. --remote=origin --push
#    - Se gh CLI não estiver autenticado, avisar e pular
#    - Primeiro commit: "feat: initial scaffold from template"

# 8. CRIAR PROJETO SUPABASE (PERGUNTAR)
#    Se o usuário quiser:
#    - Abrir https://supabase.com para criar o projeto
#    - Copiar DATABASE_URL, DATABASE_URL_TEST para .env
#    - Executar: pnpm db:push && pnpm db:seed

# 9. Iniciar dev e abrir navegador
Start-Process -WindowStyle Hidden -FilePath "powershell" -ArgumentList "-Command cd apps/web && npm run dev"
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"

# 10. Informar o usuário
```

## Carregar skills após scaffold

Após criar o projeto, INFORME ao usuário sobre as skills disponíveis:
- `project-lifecycle` — workflow obrigatório para todas as tarefas
- `chronicle` — memória persistente entre sessões
- `dev-preview` — preview automático no navegador
- `auto-testing` — testes visuais com Playwright

## O que vem no template

| Parte | Conteúdo |
|-------|----------|
| `apps/web` | React 19 + Vite + Tailwind 4 + shadcn + React Router + TanStack Query + Supabase client |
| `apps/api` | Express 5 + Drizzle ORM + postgres |
| `packages/db` | Schema Drizzle + migrations |
| `packages/shared` | Types compartilhados |
| Root | pnpm workspaces + TurboRepo + Vercel config |

## shadcn pré-instalado

- Button, Card, Input, Skeleton
- Utils (cn), hooks vazios
- CSS com tokens shadcn + dark mode

## integração com project-init

Após o scaffold, SIGA a **project-init** skill para perguntar sobre cada ferramenta:

1. gstack (infra) → `setup-gstack.ps1`
2. gbrain (contexto) → `setup-gbrain.ps1`
3. context7 (stack) → `setup-context7.ps1`
4. superpowers (utils) → `setup-superpowers.ps1`
5. graphify (grafos) → `setup-graphify.ps1`

Pergunte uma a uma, espere a resposta, só instale se o usuário confirmar.

## Exemplo de Uso

Usuário: "quero criar um novo projeto chamado meuvendas"

Agente executa:
```text
mkdir meuvendas && cd meuvendas
robocopy "$env:USERPROFILE\.agents\templates\fullstack-monorepo" "." /E
# renomeia package.json files
pnpm install
npx shadcn@latest add table form dialog
Start-Process "http://localhost:5173"
```

Pronto. Projeto rodando com shadcn em menos de 30 segundos.
