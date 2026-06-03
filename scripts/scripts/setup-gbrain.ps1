param([string]$ProjectDir)
# gbrain - Contexto do negócio e decisões
Write-Host "=== Instalando gbrain ===" -ForegroundColor Cyan

New-Item -ItemType Directory -Path "$ProjectDir\.gbrain" -Force | Out-Null

# Template de contexto do negócio
@{
  project = Split-Path $ProjectDir -Leaf
  description = ""
  objectives = @()
  stakeholders = @()
  decisions = @()
  glossary = @{}
  createdAt = (Get-Date -Format "yyyy-MM-dd")
} | ConvertTo-Json | Set-Content "$ProjectDir\.gbrain\context.json"

# README de contexto
@"
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
"@ | Set-Content "$ProjectDir\.gbrain\README.md"

Write-Host "  ✓ .gbrain/context.json criado" -ForegroundColor Green
Write-Host "  ✓ .gbrain/README.md criado" -ForegroundColor Green
Write-Host "  → Edite os arquivos em .gbrain/ com o contexto do projeto" -ForegroundColor Gray
