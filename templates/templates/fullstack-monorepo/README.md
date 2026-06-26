# Fullstack Monorepo (gstack-vibehard)

Monorepo fullstack: **React (Vite)** no front + **Express/Fastify/Hono** na API, com Supabase/PostgreSQL (ou Turso/SQLite local).

## Começar em 5 minutos

```bash
gstack_vibehard secrets import .env.example   # segredos → keychain do SO (sem .env)
npm install                                   # ou pnpm install
gstack_vibehard dev                           # sobe web + api (injeta os segredos)
```

> **Segredos via broker, não `.env`.** O `gstack_vibehard secrets` guarda os valores no keychain do SO (Windows Credential/DPAPI, macOS Keychain, Linux libsecret) e injeta só os declarados em cada serviço, **em memória** — nada em claro no repo. `gstack_vibehard secrets doctor` mostra o que falta. (`.env.example` segue só como referência de quais variáveis existem.)

## Variáveis de ambiente (`.env.example`)

| Var | Para quê |
|-----|----------|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase no front (Vite) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase no servidor |
| `DATABASE_URL` / `DATABASE_URL_TEST` | PostgreSQL (Express/Fastify) |
| `DB_ENV` | `local` (SQLite/Turso) ou `prod` (PostgreSQL) |
| `API_PORT` / `CORS_ORIGIN` | porta da API e origem CORS |

> Sem as variáveis preenchidas, comandos que dependem de Supabase/DB falham com erro claro de **env ausente** — não com stack trace opaco. Guarde os valores com `gstack_vibehard secrets set <NOME>` (ou `secrets import .env.example`); o `dev` os injeta em memória.

## Scripts

- `npm run dev` — web + api em dev
- `npm run build` — build de produção
- `npm run lint` / `npm run typecheck` / `npm test` — gates de qualidade
- `npm run db:push` / `db:seed` / `db:studio` — banco

## Modo lite vs full

Criado com `gstack_vibehard create <nome>` (LITE por padrão: só o projeto, sem provisionamento global). Use `--full` para o stack completo (Casdoor/Atomic/ECC2).
