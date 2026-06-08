#!/usr/bin/env bash
# gstack - Infraestrutura e configuracao do projeto
set -euo pipefail

PROJECT_DIR="${1:-.}"
VARIANT="${2:-express}"

echo "=== Instalando gstack (variante: $VARIANT) ==="

mkdir -p "$PROJECT_DIR/.gstack"

case "$VARIANT" in
  express)
    cat > "$PROJECT_DIR/.gstack/config.json" <<- JSON
{
  "project": "$(basename "$PROJECT_DIR")",
  "node": "$(node --version 2>/dev/null || echo unknown)",
  "npm": "$(npm --version 2>/dev/null || echo unknown)",
  "created": "$(date +%Y-%m-%d)",
  "stack": ["react", "vite", "express", "postgresql", "supabase"],
  "infra": { "frontend": "vercel", "backend": "vercel", "database": "supabase", "auth": "supabase", "storage": "supabase" },
  "variant": "$VARIANT",
  "api_dir": "apps/api",
  "db_package": "packages/db",
  "tools": ["gstack", "gbrain", "context7", "superpowers", "graphify"],
  "quality_gate": { "script": "$HOME/.codex/hooks/qg.py", "gstack_check": "$HOME/.codex/hooks/gc.py", "levels": [1, 2, 3] },
  "ecosystem": { "gbrain": "$PROJECT_DIR/.gbrain/context.json", "graphify": "$PROJECT_DIR/.graphify/deps.json", "context7": "$PROJECT_DIR/.context7/stack.json", "chronicle": "$HOME/.codex/chronicle" }
}
JSON
    ;;
  fastify)
    cat > "$PROJECT_DIR/.gstack/config.json" <<- JSON
{
  "project": "$(basename "$PROJECT_DIR")",
  "node": "$(node --version 2>/dev/null || echo unknown)",
  "npm": "$(npm --version 2>/dev/null || echo unknown)",
  "created": "$(date +%Y-%m-%d)",
  "stack": ["react", "vite", "fastify", "postgresql", "neon"],
  "infra": { "frontend": "vercel", "backend": "railway", "database": "neon", "auth": "supabase", "storage": "supabase" },
  "variant": "$VARIANT",
  "api_dir": "apps/api-fastify",
  "db_package": "packages/db",
  "tools": ["gstack", "gbrain", "context7", "superpowers", "graphify"],
  "quality_gate": { "script": "$HOME/.codex/hooks/qg.py", "gstack_check": "$HOME/.codex/hooks/gc.py", "levels": [1, 2, 3] },
  "ecosystem": { "gbrain": "$PROJECT_DIR/.gbrain/context.json", "graphify": "$PROJECT_DIR/.graphify/deps.json", "context7": "$PROJECT_DIR/.context7/stack.json", "chronicle": "$HOME/.codex/chronicle" }
}
JSON
    ;;
  hono)
    cat > "$PROJECT_DIR/.gstack/config.json" <<- JSON
{
  "project": "$(basename "$PROJECT_DIR")",
  "node": "$(node --version 2>/dev/null || echo unknown)",
  "npm": "$(npm --version 2>/dev/null || echo unknown)",
  "created": "$(date +%Y-%m-%d)",
  "stack": ["react", "vite", "hono", "sqlite", "turso"],
  "infra": { "frontend": "vercel", "backend": "render", "database": "turso", "auth": "supabase", "storage": "supabase" },
  "variant": "$VARIANT",
  "api_dir": "apps/api-hono",
  "db_package": "packages/db-turso",
  "tools": ["gstack", "gbrain", "context7", "superpowers", "graphify"],
  "quality_gate": { "script": "$HOME/.codex/hooks/qg.py", "gstack_check": "$HOME/.codex/hooks/gc.py", "levels": [1, 2, 3] },
  "ecosystem": { "gbrain": "$PROJECT_DIR/.gbrain/context.json", "graphify": "$PROJECT_DIR/.graphify/deps.json", "context7": "$PROJECT_DIR/.context7/stack.json", "chronicle": "$HOME/.codex/chronicle" }
}
JSON
    ;;
esac

echo "  ✓ .gstack/config.json criado (variante: $VARIANT)"
