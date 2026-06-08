#!/usr/bin/env bash
# superpowers - Utilitarios e helpers do projeto
set -euo pipefail

PROJECT_DIR="${1:-.}"

echo "=== Instalando superpowers ==="

mkdir -p "$PROJECT_DIR/scripts"

cat > "$PROJECT_DIR/scripts/run.sh" <<- 'EOF'
#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-help}"

case "$COMMAND" in
  dev)
    pnpm dev
    ;;
  build)
    pnpm build
    ;;
  db)
    echo "Comandos do banco:"
    echo "  cd packages/db && npx drizzle-kit generate  → Criar migration"
    echo "  cd packages/db && npx drizzle-kit push       → Aplicar migration"
    echo "  npx supabase gen types typescript --linked   → Gerar types"
    ;;
  deploy)
    vercel --prod
    ;;
  help|*)
    echo "=== Superpowers ==="
    echo "  ./scripts/run.sh dev      → Iniciar dev server"
    echo "  ./scripts/run.sh build    → Build de producao"
    echo "  ./scripts/run.sh db       → Comandos do banco"
    echo "  ./scripts/run.sh deploy   → Deploy Vercel"
    ;;
esac
EOF
chmod +x "$PROJECT_DIR/scripts/run.sh"

cat > "$PROJECT_DIR/scripts/seed.sh" <<- 'EOF'
#!/usr/bin/env bash
# Seeds locais para desenvolvimento
# Crie arquivos .seed.sql em scripts/ para popular o banco

echo "Execute manualmente no Supabase dashboard ou via:"
echo "  npx supabase db execute --file scripts/seed.sql"
EOF
chmod +x "$PROJECT_DIR/scripts/seed.sh"

echo "  ✓ scripts/run.sh criado"
echo "  ✓ scripts/seed.sh criado"
