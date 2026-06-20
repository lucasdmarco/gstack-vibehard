# Fullstack Monorepo (gstack-vibehard)

Monorepo fullstack: **React (Vite)** no front + **Express/Fastify/Hono** na API, com Supabase/PostgreSQL (ou Turso/SQLite local).

## Começar em 5 minutos

```bash
cp .env.example .env      # preencha as variáveis (ver abaixo)
npm install               # ou pnpm install
npm run dev               # sobe web + api
```

## Variáveis de ambiente (`.env.example`)

| Var | Para quê |
|-----|----------|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase no front (Vite) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase no servidor |
| `DATABASE_URL` / `DATABASE_URL_TEST` | PostgreSQL (Express/Fastify) |
| `DB_ENV` | `local` (SQLite/Turso) ou `prod` (PostgreSQL) |
| `API_PORT` / `CORS_ORIGIN` | porta da API e origem CORS |

> Sem as variáveis preenchidas, comandos que dependem de Supabase/DB falham com erro claro de **env ausente** — não com stack trace opaco. Copie `.env.example` para `.env` antes de rodar.

## Scripts

- `npm run dev` — web + api em dev
- `npm run build` — build de produção
- `npm run lint` / `npm run typecheck` / `npm test` — gates de qualidade
- `npm run db:push` / `db:seed` / `db:studio` — banco

## Modo lite vs full

Criado com `gstack_vibehard create <nome>` (LITE por padrão: só o projeto, sem provisionamento global). Use `--full` para o stack completo (Casdoor/Atomic/ECC2).
