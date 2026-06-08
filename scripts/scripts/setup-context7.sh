#!/usr/bin/env bash
# context7 - Stack e documentacao do projeto
set -euo pipefail

PROJECT_DIR="${1:-.}"

echo "=== Instalando context7 ==="

mkdir -p "$PROJECT_DIR/.context7"

cat > "$PROJECT_DIR/.context7/stack.json" <<- JSON
{
  "project": "$(basename "$PROJECT_DIR")",
  "frontend": { "framework": "react 19", "build": "vite 6", "styling": "tailwind 4 + shadcn", "state": "@tanstack/react-query", "router": "react-router-dom" },
  "backend": { "framework": "express 5", "orm": "drizzle", "database": "postgresql (supabase)" },
  "infra": { "hosting": "vercel", "database": "supabase", "auth": "supabase" },
  "tools": { "monorepo": "pnpm workspaces", "build": "turbo", "typescript": true },
  "updatedAt": "$(date +%Y-%m-%d)"
}
JSON

cat > "$PROJECT_DIR/.context7/AGENTS.md" <<- EOF
# $(basename "$PROJECT_DIR") - Contexto para Agentes de IA

## Stack
- React 19 + Vite + shadcn/ui + Tailwind 4
- Express 5 + Drizzle ORM + PostgreSQL (Supabase)
- pnpm workspaces + TurboRepo

## Estrutura
- apps/web → Frontend
- apps/api → Backend
- packages/db → Schema do banco
- packages/shared → Tipos compartilhados

## Comandos
- dev: pnpm dev (roda web + api)
- build: pnpm build
- db generate: cd packages/db && npx drizzle-kit generate
- db push: cd packages/db && npx drizzle-kit push
EOF

echo "  ✓ .context7/stack.json criado"
echo "  ✓ .context7/AGENTS.md criado"
