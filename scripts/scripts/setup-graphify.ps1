param([string]$ProjectDir)
# graphify - Visualizacao de dependencias do projeto
Write-Host "=== Instalando graphify ===" -ForegroundColor Cyan

New-Item -ItemType Directory -Path "$ProjectDir\.graphify" -Force | Out-Null

# Gerar grafo de dependencias do projeto
function Get-DependencyGraph {
  param([string]$Dir)

  $graph = @{
    nodes = @()
    edges = @()
  }

  # Detectar apps (apps/*, packages/*, lib/*)
  $dirsToScan = @()
  foreach ($sub in @("apps", "packages", "lib")) {
    $subDir = "$Dir\$sub"
    if (Test-Path $subDir) {
      Get-ChildItem $subDir -Directory | ForEach-Object {
        $dirsToScan += $_.FullName
      }
    }
  }

  foreach ($pkgDir in $dirsToScan) {
    $pkgJson = "$pkgDir\package.json"
    $relPath = $pkgDir.Substring($Dir.Length + 1) -replace '\\', '/'
    if (Test-Path $pkgJson) {
      $pkg = Get-Content $pkgJson | ConvertFrom-Json
      $nodeType = if ($relPath -match 'web|front|ui|app') { "frontend" }
                  elseif ($relPath -match 'api|server|backend') { "backend" }
                  elseif ($relPath -match 'db|database|schema') { "database" }
                  elseif ($relPath -match 'shared|types|common') { "shared" }
                  else { "library" }
      $graph.nodes += @{
        id = $relPath
        type = $nodeType
        deps = @($pkg.dependencies.PSObject.Properties.Name)
        devDeps = @($pkg.devDependencies.PSObject.Properties.Name)
      }
    }
  }

  # Detectar dependencias internas (workspaces)
  $workspaceYaml = "$Dir\pnpm-workspace.yaml"
  if (Test-Path $workspaceYaml) {
    $yaml = Get-Content $workspaceYaml
    $internalRefs = @()
    foreach ($line in $yaml) {
      if ($line -match '^\s*-\s*["'']?(.+?)["'']?\s*$') {
        $internalRefs += $Matches[1]
      }
    }
    # Para cada node, verificar se depende de outro node do workspace
    foreach ($node in $graph.nodes) {
      $nodePath = ($Dir + "/" + $node.id -replace '\\','/').ToLower()
      foreach ($dep in $node.deps) {
        $depLower = $dep.ToLower()
        foreach ($other in $graph.nodes) {
          $otherId = $other.id.ToLower()
          $lastSegment = $otherId.Split('/')[-1]
          if ($depLower -match "@?workspace[\/-]$lastSegment" -or $depLower -eq $lastSegment) {
            $graph.edges += @{ from = $node.id; to = $other.id }
          }
        }
      }
    }
  }
  else {
    # Fallback: dependencias padrao do template
    $graph.edges += @{ from = "apps/web"; to = "packages/db" }
    $graph.edges += @{ from = "apps/web"; to = "packages/shared" }
    $graph.edges += @{ from = "apps/api"; to = "packages/db" }
    $graph.edges += @{ from = "apps/api"; to = "packages/shared" }
  }

  return $graph
}

$graph = Get-DependencyGraph -Dir $ProjectDir
$graph | ConvertTo-Json -Depth 10 | Set-Content "$ProjectDir\.graphify\deps.json"

# Visualizacao HTML do grafo (dinamica baseada nos nodes/edges reais)
$projectName = Split-Path $ProjectDir -Leaf
$graphLines = @()
$graphLines += "graph TD"
$nodeIndex = 0
$nodeMap = @{}
foreach ($node in $graph.nodes) {
  $nodeId = "N$nodeIndex"
  $nodeMap[$node.id] = $nodeId
  $label = "$($node.id) - $($node.type)"
  $graphLines += "  $nodeId[$label]"
  $nodeIndex++
}
foreach ($edge in $graph.edges) {
  $fromId = $nodeMap[$edge.from]
  $toId = $nodeMap[$edge.to]
  if ($fromId -and $toId) {
    $graphLines += "  $fromId --> $toId"
  }
}
# Se tem frontend e backend, adicionar conexao HTTP
$frontends = $graph.nodes | Where-Object { $_.type -eq "frontend" }
$backends = $graph.nodes | Where-Object { $_.type -eq "backend" }
if ($frontends -and $backends) {
  foreach ($fe in $frontends) {
    foreach ($be in $backends) {
      $fromId = $nodeMap[$fe.id]
      $toId = $nodeMap[$be.id]
      if ($fromId -and $toId) {
        $graphLines += "  $fromId ---|HTTP| $toId"
      }
    }
  }
}
$mermaidContent = $graphLines -join "`n"

@"
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <title>Graphifhy - $projectName</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body { font-family: system-ui; display: flex; flex-direction: column; align-items: center; padding: 2rem; background: #f5f5f0; }
    .mermaid { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 100%; }
    h1 { font-family: 'Anton', sans-serif; color: #1a1a1a; font-size: 1.5rem; margin-bottom: 1rem; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 2rem; text-align: center; }
  </style>
</head>
<body>
  <h1>$projectName</h1>
  <div class="meta">Dependencias do projeto - gerado por graphify</div>
  <div class="mermaid">
    $mermaidContent
  </div>
  <script>mermaid.initialize({ startOnLoad: true })</script>
</body>
</html>
"@ | Set-Content "$ProjectDir\.graphify\index.html"

Write-Host "  [OK] .graphify/deps.json criado" -ForegroundColor Green
Write-Host "  [OK] .graphify/index.html criado" -ForegroundColor Green
Write-Host "  -> Abra .graphify/index.html no navegador para ver o grafo" -ForegroundColor Gray
