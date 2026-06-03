param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("express", "fastify", "hono")]
  [string]$Variant
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Write-Host "=== Setup Variant: $Variant ===" -ForegroundColor Cyan

# Remove all API variants
Remove-Item -Path "$root\apps\api" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$root\apps\api-fastify" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$root\apps\api-hono" -Recurse -Force -ErrorAction SilentlyContinue

# Keep only the chosen variant
switch ($Variant) {
  "express" {
    $src = "$root\..\fullstack-monorepo\apps\api"
    $dst = "$root\apps\api"
    Copy-Item -Path $src -Destination $dst -Recurse
    Write-Host "  ✓ API Express copiada" -ForegroundColor Green
  }
  "fastify" {
    $src = "$root\..\fullstack-monorepo\apps\api-fastify"
    $dst = "$root\apps\api-fastify"
    Copy-Item -Path $src -Destination $dst -Recurse
    Write-Host "  ✓ API Fastify copiada" -ForegroundColor Green
  }
  "hono" {
    $src = "$root\..\fullstack-monorepo\apps\api-hono"
    $dst = "$root\apps\api-hono"
    Copy-Item -Path $src -Destination $dst -Recurse
    # Turso DB package
    $dbSrc = "$root\..\fullstack-monorepo\packages\db-turso"
    $dbDst = "$root\packages\db-turso"
    Copy-Item -Path $dbSrc -Destination $dbDst -Recurse
    Remove-Item -Path "$root\packages\db" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ API Hono + db-turso copiados" -ForegroundColor Green
  }
}

# Update root package.json scripts to only reference active variant
Write-Host "  ✓ Variante $Variant configurada" -ForegroundColor Green
Write-Host ""
Write-Host "Proximo passo: pnpm install" -ForegroundColor Yellow