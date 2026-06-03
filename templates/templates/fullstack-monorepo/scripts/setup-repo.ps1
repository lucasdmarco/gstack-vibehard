param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectName
)

$ErrorActionPreference = "Stop"

Write-Host "Criando repositório GitHub: $ProjectName ..." -ForegroundColor Cyan

# Verificar gh CLI
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "gh CLI nao encontrada. Instale: winget install GitHub.cli" -ForegroundColor Yellow
  Write-Host "Depois autentique: gh auth login" -ForegroundColor Yellow
  exit 1
}

# Verificar autenticação
$ghStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "gh CLI nao autenticada. Execute: gh auth login" -ForegroundColor Yellow
  exit 1
}

# Criar repo no GitHub
Write-Host "Criando repositório GitHub..." -ForegroundColor Cyan
gh repo create "$ProjectName" --private --source=. --remote=origin --push

if ($LASTEXITCODE -eq 0) {
  Write-Host "Repositório criado com sucesso!" -ForegroundColor Green
  Write-Host "URL: https://github.com/$(gh repo view --json owner,name --jq '.owner.login + \"/\" + .name')" -ForegroundColor Green

  # Primeiro push
  git add -A
  git commit -m "feat: initial scaffold from template"
  git branch -M main
  git push -u origin main

  Write-Host "Primeiro commit enviado para main!" -ForegroundColor Green

  # Sugerir criar projeto Supabase
  Write-Host ""
  Write-Host "Proximo passo sugerido:" -ForegroundColor Yellow
  Write-Host "1. Crie um projeto Supabase em https://supabase.com" -ForegroundColor Yellow
  Write-Host "2. Copie as credenciais para .env" -ForegroundColor Yellow
  Write-Host "3. Execute: pnpm db:push" -ForegroundColor Yellow
  Write-Host "4. Execute: pnpm db:seed" -ForegroundColor Yellow
  Write-Host "5. Deploy no Vercel: npx vercel --prod" -ForegroundColor Yellow
} else {
  Write-Host "Falha ao criar repositório." -ForegroundColor Red
  exit 1
}
