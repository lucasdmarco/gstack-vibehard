---
name: migrate-to-multi-artifact
description: "Estrutura projetos existentes em monorepo com múltiplos artifacts. Use para migrar de uma base única para múltiplos projetos (frontend + backend + packages)."
---

# Migrate to Multi-Artifact

Reorganiza projetos de estrutura única para monorepo com múltiplos artifacts. Separa frontend, backend, e pacotes compartilhados em pastas distintas.

## Quando Usar

- Projeto atual tem frontend + backend misturados
- Múltiplos projetos precisam de código compartilhado
- Precisa fazer deploy separado de frontend e backend
- Escalar para múltiplos apps no mesmo repositório

## Estrutura Alvo

```
antes/                     depois/
├── src/                   ├── apps/
│   ├── components/        │   ├── web/         # Frontend
│   ├── pages/             │   │   ├── src/
│   ├── api/               │   │   └── package.json
│   └── lib/               │   ├── api/         # Backend
├── package.json           │   │   ├── src/
└── vite.config.ts         │   │   └── package.json
                           │   └── mobile/      # (opcional)
                           ├── packages/
                           │   ├── db/           # Schema + migrations
                           │   └── shared/       # Types + utils
                           ├── supabase/
                           ├── package.json      # Root workspace
                           └── vercel.json
```

## Workflow de Migração

### 1. Analisar estrutura atual

```bash
# Listar tudo que tem no projeto
Get-ChildItem -LiteralPath "src" -Recurse -Depth 2
Get-Content -LiteralPath "package.json"
```

Identificar:
- O que é frontend (React, componentes, páginas)
- O que é backend (rotas, API, banco)
- O que é compartilhado (types, utils, config)
- Dependências de cada parte

### 2. Criar estrutura-alvo

```bash
# Criar pastas
mkdir -p apps/web/src apps/api/src packages/db packages/shared supabase/migrations

# Criar root package.json
# Deletar node_modules e re-instalar
Remove-Item -LiteralPath "node_modules" -Recurse
```

### 3. Mover arquivos

```bash
# Frontend (React)
Move-Item -LiteralPath "src/components" -Destination "apps/web/src/components"
Move-Item -LiteralPath "src/pages" -Destination "apps/web/src/pages"
Move-Item -LiteralPath "index.html" -Destination "apps/web/index.html"
Move-Item -LiteralPath "vite.config.ts" -Destination "apps/web/vite.config.ts"

# Backend
Move-Item -LiteralPath "src/api" -Destination "apps/api/src/routes"
Move-Item -LiteralPath "src/db" -Destination "packages/db/src"

# Shared
Move-Item -LiteralPath "src/types" -Destination "packages/shared/src/types"
Move-Item -LiteralPath "src/lib" -Destination "packages/shared/src/lib"
```

### 4. Configurar workspaces

```json
{
  "name": "meu-projeto",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w apps/web\" \"npm run dev -w apps/api\"",
    "build": "npm run build -w packages/db && npm run build -w apps/web",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "concurrently": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 5. Ajustar imports

```typescript
// Antes
import { User } from '../types/user';
import { cn } from '../lib/utils';
import { db } from '../db/schema';

// Depois
import { User } from '@meuprojeto/shared';
import { cn } from '@meuprojeto/shared';
import { db } from '@meuprojeto/db';
```

### 6. Configurar Vite

```ts
// apps/web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@meuprojeto/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
```

### 7. Deploy separado

```json
// vercel.json (raiz)
{
  "buildCommand": "cd apps/web && npm run build",
  "outputDirectory": "apps/web/dist",
  "framework": "vite"
}
```

```json
// apps/api/vercel.json
{
  "functions": {
    "api/**/*.js": {
      "maxDuration": 30
    }
  }
}
```

## TurboRepo (Recomendado)

```yaml
# turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    }
  }
}
```

```bash
# Instalar turbo
npm install -D turbo
```

## Checklist

- [ ] Estrutura de pastas criada (apps/*, packages/*)
- [ ] package.json root com workspaces
- [ ] Dependências movidas para packages corretos
- [ ] Imports atualizados
- [ ] Build funcionando (`npm run build`)
- [ ] Dev funcionando (`npm run dev`)
- [ ] Deploy configurado na Vercel
- [ ] tsconfig paths configurados

## Dicas

- **Migre incrementalmente** — uma parte por vez, testando cada etapa
- **pnpm workspaces** são mais rápidos, mas npm workspaces também funcionam
- **TurboRepo** acelera builds com cache — configure depois da migração
- **Não quebre o git history** — mova arquivos com `git mv` se versionado
- Tipos compartilhados vão em `packages/shared`
- Schema do banco vai em `packages/db`
- Teste local antes de fazer deploy
- A migração pode ser revertida — mantenha backup
