#!/usr/bin/env bash
# gbrain - Contexto do negocio e decisoes
set -euo pipefail

PROJECT_DIR="${1:-.}"

echo "=== Instalando gbrain ==="

mkdir -p "$PROJECT_DIR/.gbrain"

cat > "$PROJECT_DIR/.gbrain/context.json" <<- JSON
{
  "project": "$(basename "$PROJECT_DIR")",
  "description": "",
  "objectives": [],
  "stakeholders": [],
  "decisions": [],
  "glossary": {},
  "createdAt": "$(date +%Y-%m-%d)"
}
JSON

cat > "$PROJECT_DIR/.gbrain/README.md" <<- 'EOF'
# gbrain - Contexto do Negócio

## Descrição
(preencher)

## Objetivos
1. 
2. 
3. 

## Stack
- Frontend: React + Vite + shadcn
- Backend: Express + Drizzle
- Database: Supabase PostgreSQL
- Deploy: Vercel

## Decisões de Arquitetura
| Decisão | Alternativas | Motivo |
|---------|-------------|--------|
| | | |

## Glossário
| Termo | Definição |
|-------|-----------|
| | |
EOF

echo "  ✓ .gbrain/context.json criado"
echo "  ✓ .gbrain/README.md criado"
