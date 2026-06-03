param(
  [string]$ProjectDir,
  [ValidateSet("express", "fastify", "hono")]
  [string]$Variant = "express"
)
# gstack - Infraestrutura e configuração do projeto
Write-Host "=== Instalando gstack (variante: $Variant) ===" -ForegroundColor Cyan

# Criar estrutura de configuração
New-Item -ItemType Directory -Path "$ProjectDir\.gstack" -Force | Out-Null

# Mapa de variantes
$variantMap = @{
  express = @{
    stack = @("react", "vite", "express", "postgresql", "supabase")
    infra = @{
      frontend = "vercel"
      backend = "vercel"
      database = "supabase"
      auth = "supabase"
      storage = "supabase"
    }
    api_dir = "apps/api"
    db_package = "packages/db"
    deploy = "vercel"
  }
  fastify = @{
    stack = @("react", "vite", "fastify", "postgresql", "neon")
    infra = @{
      frontend = "vercel"
      backend = "railway"
      database = "neon"
      auth = "supabase"
      storage = "supabase"
    }
    api_dir = "apps/api-fastify"
    db_package = "packages/db"
    deploy = "railway"
  }
  hono = @{
    stack = @("react", "vite", "hono", "sqlite", "turso")
    infra = @{
      frontend = "vercel"
      backend = "render"
      database = "turso"
      auth = "supabase"
      storage = "supabase"
    }
    api_dir = "apps/api-hono"
    db_package = "packages/db-turso"
    deploy = "render"
  }
}
$v = $variantMap[$Variant]
$toolsList = @("gstack", "gbrain", "context7", "superpowers", "graphify")

@{
  project = Split-Path $ProjectDir -Leaf
  node = (node --version 2>$null) || "unknown"
  npm = (npm --version 2>$null) || "unknown"
  created = (Get-Date -Format "yyyy-MM-dd")
  stack = $v.stack
  infra = $v.infra
  variant = $Variant
  api_dir = $v.api_dir
  db_package = $v.db_package
  tools = $toolsList
  quality_gate = @{
    script = "$env:USERPROFILE\.codex\hooks\qg.py"
    gstack_check = "$env:USERPROFILE\.codex\hooks\gc.py"
    levels = @(1, 2, 3)
  }
  ecosystem = @{
    gbrain = "$ProjectDir\.gbrain\context.json"
    graphify = "$ProjectDir\.graphify\deps.json"
    context7 = "$ProjectDir\.context7\stack.json"
    chronicle = "$env:USERPROFILE\.codex\chronicle"
  }
} | ConvertTo-Json -Depth 10 | Set-Content "$ProjectDir\.gstack\config.json"

Write-Host "  ✓ .gstack/config.json criado (variante: $Variant)" -ForegroundColor Green
Write-Host "  → Stack: $($v.stack -join ' + ')" -ForegroundColor Gray
Write-Host "  → Infra: frontend=$($v.infra.frontend) backend=$($v.infra.backend) db=$($v.infra.database)" -ForegroundColor Gray
