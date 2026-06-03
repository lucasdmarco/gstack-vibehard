---
name: artifacts
description: "Cria e gerencia projetos no monorepo. Cada artifact é um projeto independente (frontend, backend, mobile). Use ao criar um novo website, app, API, ou qualquer projeto novo no repositório."
---

# Artifacts — Sistema de Projetos

No Codex, artifacts são diretórios de projeto. Cada artifact é uma pasta independente com seu próprio `package.json`, configurações, e dependências.

**Stack padrão:** React 19 + Vite + Tailwind 4 + shadcn/ui + TypeScript

## Template Reutilizável

Existe um template completo em `~/.agents/templates/fullstack-monorepo/`. Para iniciar um novo projeto, COPIE o template:

```bash
# Copiar template para o diretório atual
robocopy "$env:USERPROFILE\.agents\templates\fullstack-monorepo" "." /E

# Renomear pacotes (editar package.json files)
# "my-project" → nome real
# "@my/web" → "@seuprojeto/web"
# "@my/api" → "@seuprojeto/api"
# "@my/db" → "@seuprojeto/db"
# "@my/shared" → "@seuprojeto/shared"

# Instalar dependências
pnpm install

# Adicionar mais componentes shadcn (conforme necessário)
npx shadcn@latest add table form dialog select dropdown-menu badge avatar toast
```

## Quando Usar

- Criar um novo website, app web, API, ou projeto mobile
- Escaffoldar qualquer novo projeto no repositório
- Organizar múltiplos sub-projetos no mesmo repositório

## Estrutura de Monorepo

```
meu-repo/
├── apps/
│   ├── web/                  # Frontend React/Vite + shadcn
│   │   ├── package.json
│   │   ├── components.json   # shadcn config
│   │   ├── src/
│   │   │   ├── components/ui/  # shadcn components
│   │   │   ├── lib/            # utils, supabase client
│   │   │   ├── hooks/
│   │   │   ├── pages/
│   │   │   └── index.css       # Tailwind + shadcn tokens
│   │   └── vite.config.ts
│   └── api/                  # Backend Express + Drizzle
│       ├── package.json
│       └── src/
├── packages/
│   ├── shared/               # Tipos e schemas compartilhados
│   └── db/                   # Schema do banco (Drizzle)
├── supabase/                 # Config do Supabase
│   └── migrations/
├── .env.example
├── vercel.json               # Deploy Vercel
└── package.json              # Root workspace (pnpm/turbo)
```

## Workflow de Criação

### 1. Copiar template (mais rápido)

```bash
robocopy "$env:USERPROFILE\.agents\templates\fullstack-monorepo" "." /E
pnpm install
```

### 2. Componentes shadcn pré-instalados no template

- `Button` — botões com variantes (default, destructive, outline, secondary, ghost, link)
- `Card` — cards com header, title, description, content, footer
- `Input` — input estilizado
- `Skeleton` — loading skeleton

Adicione mais sob demanda:
```bash
npx shadcn@latest add table form dialog select dropdown-menu badge avatar toast
```

### 3. Backend (Express + Drizzle)

O template já inclui `apps/api` pronto. Só configurar `DATABASE_URL` no `.env`.

### 4. Supabase

```bash
npx supabase init
npx supabase link --project-ref <ref>
npx supabase gen types typescript --linked > packages/db/src/supabase.ts
```

## Como Usar shadcn no Código

```tsx
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function LoginPage() {
  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>Login</CardTitle>
        <CardDescription>Entre com suas credenciais</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Email" type="email" />
        <Input placeholder="Senha" type="password" />
        <Button className="w-full">Entrar</Button>
      </CardContent>
    </Card>
  )
}
```

## Vercel Deploy

```json
{
  "buildCommand": "cd apps/web && npm run build",
  "outputDirectory": "apps/web/dist",
  "installCommand": "npm install",
  "framework": "vite"
}
```

## Dicas

- **SEMPRE** use o template em `~/.agents/templates/fullstack-monorepo/` para novos projetos
- **SEMPRE** use componentes shadcn (`@/components/ui/button`, `card`, `input`)
- shadcn já vem configurado com dark mode via classe `.dark`
- Lucide icons inclusos: `import { User, Settings, LogOut } from 'lucide-react'`
- Para adicionar mais shadcn: `npx shadcn@latest add <componente>`
- O template já resolve path alias `@/` → `apps/web/src/`
- Após criar, use `dev-preview` skill para abrir navegador automaticamente
- Não crie artifacts duplicados — pergunte se é para adicionar a um existente
