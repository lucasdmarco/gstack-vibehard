# Projeto: {{project_name}}

## Stack Base
- **Frontend**: React 19 + Vite + Tailwind 4 + shadcn/ui + TanStack Query + React Router
- **Design System**: taste-skill powered (4 engines: brutalist/soft/minimalist/stitch + 3 dials)
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

## Design System (taste-skill)

O template inclui design system completo com 4 engines visuais:

| Engine | Estilo | Arquivo tema |
|--------|--------|-------------|
| **brutalist** | Swiss industrial + CRT terminal | `src/styles/themes/brutalist.css` |
| **soft** | Premium UI, spring animations | `src/styles/themes/soft.css` |
| **minimalist** | Clean editorial (Linear/Notion) | `src/styles/themes/minimalist.css` |
| **stitch** | Google Stitch semantic design | `src/styles/themes/stitch.css` |

**3 Dials**: DESIGN_VARIANCE (1-10), MOTION_INTENSITY (1-10), VISUAL_DENSITY (1-10)
**Config**: `src/lib/design-system/config.ts` — leitura/escrita em localStorage + CSS class switching
**Patterns**: `src/components/patterns/` — heroes, navigation, grids/bento, cards, media, micro-interactions

## Agentes Especialistas (20)

O projeto inclui agentes especialistas com Quality Gate obrigatório antes de cada entrega:

| Agente | Especialidade |
|--------|--------------|
| orchestrator | Coordenação multi-agente |
| frontend-specialist | UI/UX web |
| backend-specialist | API, rotas, middleware |
| database-architect | Schema, migrations, queries |
| debugger | Debug sistemático |
| devops-engineer | Docker, deploy, infra |
| security-auditor | OWASP, pentest |
| qa-automation-engineer | Testes automatizados |
| performance-optimizer | Bundle, render, queries |
| +11 mais | Ver `agents/agents/` |

**Regra**: Todo agente executa `python ~/.codex/hooks/qg.py --path . --level 1` antes de entregar output.

## Quality Gate + Security Gate

- **QG** (qg.py): 3 níveis — L1 estrutural+segurança, L2 estados, L3 conteúdo
- **Security Gate** (stop.py): dockerignore, multi-stage, non-root, CORS, secrets — bloqueante em deploy
- **Session Start** (session_start.py): identity injection + chronicle index + stack decision framework

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
apps/web/                → Frontend React + design system (4 engines)
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

1. Plano → 2. Aprovação → 3. Código → 4. QG Gate → 5. Testes → 6. Review
