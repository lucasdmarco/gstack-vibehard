---
name: mockup-sandbox
description: "Cria sandbox de prototipação rápida com React + Vite. Use para isolar e testar componentes visuais, explorar variações de design, e validar ideias antes de integrar ao app principal."
---

# Mockup Sandbox — Prototipação Rápida

Cria um ambiente isolado para prototipar componentes e páginas sem afetar o app principal. Funciona como um "playground" de design.

## Quando Usar

- Prototipar um novo componente ou página
- Explorar diferentes variações de design
- Testar animações ou interações
- Validar layout antes de implementar
- Criar provas de conceito (POC)

## Workflow

### 1. Criar Sandbox

```bash
# Cria sandbox dentro do projeto
mkdir -p sandbox && cd sandbox
npm create vite@latest . -- --template react-ts
npm install
```

### 2. Componentes Isolados

```tsx
// sandbox/src/app.tsx
import { PricingTable } from './mockups/PricingTable';
import { PricingTableV2 } from './mockups/PricingTableV2';
import { PricingTableV3 } from './mockups/PricingTableV3';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="mb-8 text-center text-2xl font-bold">Sandbox — Tabela de Preços</h1>

      <section className="mb-16">
        <h2 className="mb-4 text-sm font-semibold uppercase text-gray-500">Variante A</h2>
        <PricingTable />
      </section>

      <section className="mb-16">
        <h2 className="mb-4 text-sm font-semibold uppercase text-gray-500">Variante B</h2>
        <PricingTableV2 />
      </section>

      <section className="mb-16">
        <h2 className="mb-4 text-sm font-semibold uppercase text-gray-500">Variante C</h2>
        <PricingTableV3 />
      </section>
    </div>
  );
}
```

### 3. Mockups Variantes

```tsx
// sandbox/src/mockups/PricingTable.tsx
export function PricingTable() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="grid grid-cols-3 gap-4">
        {plans.map(plan => (
          <div key={plan.name} className="rounded-xl border p-6">
            <h3 className="text-lg font-bold">{plan.name}</h3>
            <p className="mt-2 text-3xl font-bold">R$ {plan.price}</p>
            <ul className="mt-4 space-y-2">
              {plan.features.map(f => <li key={f}>✓ {f}</li>)}
            </ul>
            <button className="mt-6 w-full rounded-lg bg-blue-600 py-2 text-white">
              Assinar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const plans = [
  { name: 'Starter', price: 49, features: ['1 usuário', '5GB', 'Suporte email'] },
  { name: 'Pro', price: 97, features: ['10 usuários', '50GB', 'Suporte prioritário'] },
  { name: 'Enterprise', price: 299, features: ['Ilimitado', '1TB', 'Suporte 24/7'] },
];
```

### 4. Rodar Sandbox

```bash
cd sandbox
npm run dev
# -> http://localhost:5173
```

## Templates de Mockup

### Tabela de Preços

```tsx
// sandbox/src/mockups/PricingTable.tsx
// Três colunas: Starter / Pro / Enterprise
// Destaque para o plano "Pro" (borda azul, badge "Popular")
```

### Dashboard Card

```tsx
// sandbox/src/mockups/DashboardCard.tsx
// Card com: título, valor, variação %, gráfico sparkline
```

### Formulário

```tsx
// sandbox/src/mockups/FormField.tsx
// Input com label, helper text, estado de erro, disabled
```

### Navbar

```tsx
// sandbox/src/mockups/Navbar.tsx
// Variações: desktop (links horizontais), mobile (hamburger)
```

## shadcn no Sandbox

Se o projeto principal usa shadcn, instale no sandbox também para prototipar com os mesmos componentes:

```bash
cd sandbox
npx shadcn@latest init
npx shadcn@latest add button card input
```

```tsx
// sandbox usa mesmos imports do projeto principal
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
```

## Integração com Tailwind

```bash
cd sandbox
npm install -D tailwindcss @tailwindcss/vite
```

```ts
// sandbox/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

```css
/* sandbox/src/index.css */
@import "tailwindcss";
```

## Dicas

- Cada sandbox é um Vite project separado dentro da pasta `sandbox/`
- Compare variantes lado a lado no grid
- Use dados mockados (não precisa de API)
- Quando o mockup for aprovado, mova os componentes para `apps/web/src/components/`
- Não instale dependências demais — mantenho leve para iteração rápida
- O sandbox é temporário — pode ser deletado após a graduação
- Commite o sandbox no repositório? Só se tiver propósito de continuação
