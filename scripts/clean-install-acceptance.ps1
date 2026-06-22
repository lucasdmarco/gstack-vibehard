# Teste de aceitação de instalação limpa (gstack_vibehard) — Windows PowerShell.
# Roda o veredito de "primeiro contato seguro" e imprime PASS/FAIL por item.
# Uso:   powershell -ExecutionPolicy Bypass -File scripts\clean-install-acceptance.ps1
# (assume que `gstack_vibehard` já está no PATH — instale com:
#   npm install -g @gstack-vibehard/installer )

$ErrorActionPreference = "Continue"
$fail = 0
function Pass($m) { Write-Host "  [PASS] $m" -ForegroundColor Green }
function Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:fail++ }

Write-Host "== gstack clean-install acceptance =="
Write-Host ("node: " + (node -v)); Write-Host ("python: " + (python --version 2>&1))

# [1] versao
$ver = (gstack_vibehard --version) 2>&1 | Out-String
if ($ver -match '\d+\.\d+\.\d+') { Pass "version: $($ver.Trim())" } else { Fail "version inesperada: $ver" }

# [2] --help NAO instala (sem 'Instalando'/'Comando desconhecido')
$help = (gstack_vibehard --help) 2>&1 | Out-String
if ($help -notmatch 'Comando desconhecido' -and $help -notmatch 'Instalando pacote') { Pass "--help seguro (nao instala)" } else { Fail "--help suspeito" }

# [3] doctor roda
gstack_vibehard doctor *> $null
if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) { Pass "doctor rodou" } else { Fail "doctor exit $LASTEXITCODE" }

# [4] audit-only NAO escreve (manifest nao pode ser criado por ele)
$man = Join-Path $env:USERPROFILE ".gstack_vibehard\install-manifest.json"
$manBefore = Test-Path $man
gstack_vibehard install --audit-only *> $null
$manAfter = Test-Path $man
if ($manBefore -eq $manAfter) { Pass "install --audit-only e read-only (nao mudou o manifest)" } else { Fail "audit-only ESCREVEU o manifest" }

# [5] create LITE: cria ./<nome> e NAO escreve no ~/gstack-vault global
$proj = Join-Path $env:TEMP ("gstack-smoke-" + (Get-Random))
$vaultProj = Join-Path $env:USERPROFILE ("gstack-vault\projects\" + (Split-Path $proj -Leaf))
Push-Location $env:TEMP
gstack_vibehard create (Split-Path $proj -Leaf) *> $null
Pop-Location
$appJson = Join-Path $proj ".gstack\app.json"
if (Test-Path $appJson) {
  $mode = (Get-Content $appJson -Raw | ConvertFrom-Json).mode
  if ($mode -eq "lite") { Pass "create LITE criou o app (mode=lite)" } else { Fail "create mode=$mode (esperado lite)" }
} else { Fail "create nao gerou .gstack/app.json" }
if (Test-Path $vaultProj) { Fail "create LITE escreveu no global ~/gstack-vault (nao deveria)" } else { Pass "create LITE nao tocou ~/gstack-vault (BOM)" }
if (Test-Path $proj) { Remove-Item $proj -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ""
if ($fail -gt 0) { Write-Host "RESULTADO: $fail falha(s)" -ForegroundColor Red; exit 1 }
Write-Host "RESULTADO: TUDO PASSOU" -ForegroundColor Green
