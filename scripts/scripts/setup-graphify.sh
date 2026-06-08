#!/usr/bin/env bash
# graphify - Visualizacao de dependencias do projeto
set -euo pipefail

PROJECT_DIR="${1:-.}"

echo "=== Instalando graphify ==="

mkdir -p "$PROJECT_DIR/.graphify"

PROJECT_NAME="$(basename "$PROJECT_DIR")"

# Gerar grafo de dependencias
cat > "$PROJECT_DIR/.graphify/deps.json" <<- JSON
{
  "nodes": [
    { "id": "apps/web", "type": "frontend", "deps": [], "devDeps": [] },
    { "id": "apps/api", "type": "backend", "deps": [], "devDeps": [] },
    { "id": "packages/db", "type": "database", "deps": [], "devDeps": [] },
    { "id": "packages/shared", "type": "shared", "deps": [], "devDeps": [] }
  ],
  "edges": [
    { "from": "apps/web", "to": "packages/db" },
    { "from": "apps/web", "to": "packages/shared" },
    { "from": "apps/api", "to": "packages/db" },
    { "from": "apps/api", "to": "packages/shared" }
  ]
}
JSON

cat > "$PROJECT_DIR/.graphify/index.html" <<- EOF
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <title>Graphify - $PROJECT_NAME</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body { font-family: system-ui; display: flex; flex-direction: column; align-items: center; padding: 2rem; background: #f5f5f0; }
    .mermaid { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 100%; }
    h1 { font-family: 'Anton', sans-serif; color: #1a1a1a; }
  </style>
</head>
<body>
  <h1>$PROJECT_NAME</h1>
  <div class="mermaid">
    graph TD
      N0[apps/web - frontend]
      N1[apps/api - backend]
      N2[packages/db - database]
      N3[packages/shared - shared]
      N0-->|HTTP| N1
      N0-->N2
      N0-->N3
      N1-->N2
      N1-->N3
  </div>
  <script>mermaid.initialize({startOnLoad:true})</script>
</body>
</html>
EOF

echo "  ✓ .graphify/deps.json criado"
echo "  ✓ .graphify/index.html criado"
