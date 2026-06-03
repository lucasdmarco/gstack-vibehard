---
name: deployment
description: "Faz deploy de projetos para Vercel. Use quando o usuário pedir para publicar, fazer deploy, ou colocar o projeto no ar. Configura Vercel, faz build, e faz o deploy via Vercel CLI ou GitHub integration."
---

# Deployment - Vercel

## Visão Geral

Faz deploy de frontends (React, Vite, Next.js) e backend serverless (Express, Fastify) para a Vercel.

## Stack Padrão

- **Frontend**: Vercel (static ou serverless)
- **Backend**: Vercel Functions ou API routes
- **Banco**: Supabase (não vai para Vercel — já está online)
- **Domínio**: vercel.app ou custom domain

## Quando Usar

- Projeto está pronto e funcionando localmente
- Usuário pede para publicar o projeto
- Usuário quer um link para compartilhar
- Após finalizar uma funcionalidade e testar

## Pré-requisitos

```bash
# 1. Instalar Vercel CLI
npm install -g vercel

# 2. Login (uma vez)
vercel login

# 3. Setup no projeto
vercel init
```

## Configuração

### vercel.json (raiz do projeto)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### Para frontend React/Vite

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "apps/web/dist"
}
```

### Para backend Express (serverless)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "apps/api/dist",
  "functions": {
    "api/**/*.js": {
      "maxDuration": 30
    }
  }
}
```

### Variáveis de Ambiente

```bash
# Setar variáveis na Vercel
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add CLERK_SECRET_KEY

# Ou via dashboard: https://vercel.com/project/settings/environment-variables
```

## Workflow de Deploy

### Opção 1: Vercel CLI (rápido)

```bash
# 1. Build
npm run build

# 2. Deploy (produção)
vercel --prod

# 3. Deploy (preview)
vercel
```

### Opção 2: GitHub Integration (recomendado)

```bash
# 1. Conecte o repositório no Vercel dashboard
# 2. Configure: Import Git Repository → selecione o repo
# 3. Framework preset: Vite / Next.js / etc
# 4. Deploy automático em cada push na main

# Para preview de PRs:
# Vercel automaticamente cria preview deployments para cada PR
```

### Opção 3: CI/CD manual

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run build
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

## Verificação Pós-Deploy

```bash
# Ver status do deploy
vercel list

# Ver logs
vercel logs

# Abrir no navegador
vercel open
```

## Rollback

```bash
# Listar deploys anteriores
vercel list

# Fazer rollback para um deploy específico
vercel rollback <deploy-url>
```

## Dicas

- **Nunca faça deploy com erros** — build deve passar limpo
- **Variáveis de ambiente** — configure via `vercel env add` antes do primeiro deploy
- **Supabase** não precisa de deploy — já está online. Só configure as env vars
- **Custom domain** — configure no dashboard da Vercel: Project → Domains
- **Preview deployments** são automáticos para PRs no GitHub
- Use `vercel --prod` para produção, `vercel` sem flags para preview
- Para projetos com frontend + backend, configure como monorepo na Vercel
