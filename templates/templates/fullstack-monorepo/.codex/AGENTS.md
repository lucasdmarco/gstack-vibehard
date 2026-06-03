# Projeto: {{project_name}}

## Stack Base
- **Frontend**: React 19 + Vite + Tailwind 4 + shadcn/ui + TanStack Query + React Router
- **Banco Base**: Supabase PostgreSQL (produção e teste separados)
- **Deploy Frontend**: Vercel
- **Package Manager**: pnpm
- **Monorepo**: TurboRepo

## Variantes de Backend

| Variante | Framework | Banco | Deploy | Pasta |
|----------|-----------|-------|--------|-------|
| default (Express) | Express 5 | Supabase PostgreSQL | Vercel serverless | `apps/api/` |
| fastify | Fastify 5 | Neon PostgreSQL | Railway | `apps/api-fastify/` |
| hono | Hono 4 | Turso (libsql) | Render | `apps/api-hono/` |

- Para PostgreSQL: use `@my/db` (Drizzle ORM + postgres driver)
- Para Turso/SQLite: use `@my/db-turso` (Drizzle ORM + libsql driver)
- Types compartilhados: `@my/shared`

## Comandos

```bash
# Dev — Express (default)
pnpm dev              # Sobe web + api em paralelo
pnpm dev:web          # Só frontend
pnpm dev:api          # Só backend Express

# Dev — Fastify (alternativa)
pnpm dev:api-fastify  # Só backend Fastify

# Dev — Hono (alternativa)
pnpm dev:api-hono     # Só backend Hono

# Banco — PostgreSQL (Express / Fastify)
pnpm db:generate      # Gera migration do schema Drizzle
pnpm db:push          # Pusha schema para produção (usa DATABASE_URL)
pnpm db:push:test     # Pusha schema para teste (usa DATABASE_URL_TEST)
pnpm db:studio        # Abre Drizzle Studio
pnpm db:seed          # Popula banco com dados iniciais

# Banco — Turso/SQLite (Hono)
pnpm db-turso:generate # Gera migration
pnpm db-turso:push    # Pusha schema
pnpm db-turso:seed    # Popula banco

# Qualidade
pnpm lint             # TypeScript check + lint
pnpm typecheck        # Apenas type check
pnpm test             # Roda testes (usa DATABASE_URL_TEST)
pnpm test:watch       # Testes em watch mode

# Setup
pnpm setup:repo       # Cria repo GitHub + primeiro commit + push
```

## Pastas importantes

```
apps/web/                → Frontend React
apps/api/                → Backend Express 5 (default, Supabase + Vercel)
apps/api-fastify/        → Backend Fastify 5 (Neon + Railway)
apps/api-hono/           → Backend Hono 4 (Turso + Render)
packages/db/             → Schema Drizzle PostgreSQL, migrations, seed
packages/db-turso/       → Schema Drizzle SQLite/Turso, migrations, seed
packages/shared/         → Types compartilhados
.docs/                   → Documentação do projeto
.github/workflows/       → CI/CD
scripts/                 → Scripts de setup
```

## Workflow

Siga o fluxo definido no AGENTS.md global (~/.codex/AGENTS.md):
1. Plano → 2. Aprovação → 3. Código → 4. Testes → 5. Review → 6. PR
