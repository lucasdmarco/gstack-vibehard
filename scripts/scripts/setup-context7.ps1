param([string]$ProjectDir)
# context7 - Stack e documentação do projeto
Write-Host "=== Instalando context7 ===" -ForegroundColor Cyan

New-Item -ItemType Directory -Path "$ProjectDir\.context7" -Force | Out-Null

# Stack atual
@{
  project = Split-Path $ProjectDir -Leaf
  frontend = @{
    framework = "react 19"
    build = "vite 6"
    styling = "tailwind 4 + shadcn"
    state = "@tanstack/react-query"
    router = "react-router-dom"
  }
  backend = @{
    framework = "express 5"
    orm = "drizzle"
    database = "postgresql (supabase)"
  }
  infra = @{
    hosting = "vercel"
    database = "supabase"
    auth = "supabase"
  }
  tools = @{
    monorepo = "pnpm workspaces"
    build = "turbo"
    typescript = true
  }
  updatedAt = (Get-Date -Format "yyyy-MM-dd")
} | ConvertTo-Json | Set-Content "$ProjectDir\.context7\stack.json"

# AGENTS.md - Contexto pra IA
@"
# $((Split-Path $ProjectDir -Leaf)) - Contexto para Agentes de IA

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
"@ | Set-Content "$ProjectDir\.context7\AGENTS.md"

Write-Host "  ✓ .context7/stack.json criado" -ForegroundColor Green
Write-Host "  ✓ .context7/AGENTS.md criado" -ForegroundColor Green
Write-Host "  → O Codex carrega .context7/AGENTS.md automaticamente como contexto" -ForegroundColor Gray
