param([string]$ProjectDir)
# superpowers - Utilitários e helpers do projeto
Write-Host "=== Instalando superpowers ===" -ForegroundColor Cyan

New-Item -ItemType Directory -Path "$ProjectDir\scripts" -Force | Out-Null

# Dev helpers
@"
param(
  [Parameter(Position=0)]
  [ValidateSet('dev','build','db','deploy','help')]
  [string]$Command = 'help'
)

switch ($Command) {
  'dev' {
    pnpm dev
  }
  'build' {
    pnpm build
  }
  'db' {
    Write-Host "Comandos do banco:" -ForegroundColor Cyan
    Write-Host "  cd packages/db && npx drizzle-kit generate  → Criar migration"
    Write-Host "  cd packages/db && npx drizzle-kit push       → Aplicar migration"
    Write-Host "  npx supabase gen types typescript --linked   → Gerar types"
  }
  'deploy' {
    vercel --prod
  }
  'help' {
    Write-Host "=== Superpowers ===" -ForegroundColor Cyan
    Write-Host "  .\run.ps1 dev      → Iniciar dev server"
    Write-Host "  .\run.ps1 build    → Build de produção"
    Write-Host "  .\run.ps1 db       → Comandos do banco"
    Write-Host "  .\run.ps1 deploy   → Deploy Vercel"
  }
}
"@ | Set-Content "$ProjectDir\scripts\run.ps1"

# Seed helpers
@"
# Seeds locais para desenvolvimento
# Crie arquivos .seed.sql em scripts/ para popular o banco

Write-Host "Execute manualmente no Supabase dashboard ou via:" -ForegroundColor Yellow
Write-Host "  npx supabase db execute --file scripts/seed.sql" -ForegroundColor Gray
"@ | Set-Content "$ProjectDir\scripts\seed.ps1"

Write-Host "  ✓ scripts/run.ps1 criado" -ForegroundColor Green
Write-Host "  ✓ scripts/seed.ps1 criado" -ForegroundColor Green
Write-Host "  → Use .\scripts\run.ps1 dev para iniciar" -ForegroundColor Gray
