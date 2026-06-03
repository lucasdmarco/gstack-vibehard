---
name: mockup-graduate
description: "Move componentes prototipados do sandbox para o app principal. Copia, adapta, e integra os mockups aprovados no código de produção."
---

# Mockup Graduate — Sandbox → Produção

Move componentes do sandbox de prototipação para o app principal. Este processo copia o código, adapta para usar dados reais (API/banco), adiciona testes, e integra no roteamento do app.

## Quando Usar

- Mockup foi aprovado pelo usuário
- Design está estabilizado
- Precisa conectar com dados reais
- Componente precisa ser integrado no fluxo principal

## Workflow

### Passo 1: Identificar o que graduar

```bash
# Estrutura típica do sandbox
sandbox/src/mockups/
├── PricingTable.tsx        # Componente aprovado
├── PricingTableV2.tsx      # Descartado
├── DashboardCard.tsx       # Componente aprovado
└── Navbar.tsx              # Componente aprovado
```

### Passo 2: Copiar para o app principal

```bash
# Copia os componentes aprovados
cp sandbox/src/mockups/PricingTable.tsx apps/web/src/components/PricingTable.tsx
cp sandbox/src/mockups/DashboardCard.tsx apps/web/src/components/DashboardCard.tsx
cp sandbox/src/mockups/Navbar.tsx apps/web/src/components/Navbar.tsx
```

### Passo 3: Adaptar para dados reais

```tsx
// Antes (sandbox — dados mockados)
export function PricingTable() {
  const plans = [
    { name: 'Starter', price: 49, features: ['1 usuário', '5GB'] },
    { name: 'Pro', price: 97, features: ['10 usuários', '50GB'] },
  ];
  return (
    <div className="grid grid-cols-3 gap-4">
      {plans.map(plan => ( ... ))}
    </div>
  );
}

// Depois (produção — API/Supabase)
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function PricingTable() {
  const { data: plans, isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => {
      const { data } = await supabase.from('plans').select('*');
      return data;
    },
  });

  if (isLoading) return <div>Carregando...</div>;
  if (!plans) return <div>Nenhum plano encontrado</div>;

  return (
    <div className="grid grid-cols-3 gap-4">
      {plans.map(plan => ( ... ))}
    </div>
  );
}
```

### Passo 4: Conectar no roteamento

```tsx
// apps/web/src/app.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PricingPage } from './pages/PricingPage';
import { Dashboard } from './pages/Dashboard';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/precos" element={<PricingPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### Passo 5: Adicionar dependências (se necessário)

```bash
# Verificar dependências que o sandbox usava e instalar no app principal
cd apps/web
npm install @tanstack/react-query recharts
```

### Passo 6: Remover do sandbox (opcional)

```bash
# Remove componente já graduado do sandbox
rm sandbox/src/mockups/PricingTable.tsx
```

## Boas Práticas na Graduação

| Aspecto | Sandbox | Produção |
|---------|---------|----------|
| Dados | Mockado (hardcoded) | API / Supabase |
| Estado | Local state | React Query / Context |
| Erros | Ignorado | Loading + Error + Empty states |
| Roteamento | Renderizado direto | Página com rota |
| Testes | Nenhum | Testes unitários/componentes |
| Acessibilidade | Básico | ARIA labels, keyboard nav |

## Checklist de Graduação

- [ ] Componente copiado para `apps/web/src/components/`
- [ ] Dados mockados substituídos por chamada à API/Supabase
- [ ] Loading state implementado (skeleton/spinner)
- [ ] Error state implementado (mensagem amigável + retry)
- [ ] Empty state implementado (mensagem quando sem dados)
- [ ] Props tipadas com TypeScript
- [ ] Roteamento configurado
- [ ] Página criada em `apps/web/src/pages/`
- [ ] Layout responsivo testado
- [ ] Acessibilidade básica (roles, labels)
- [ ] (Opcional) Testes unitários

## Exemplo Completo

```tsx
// apps/web/src/pages/PricingPage.tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PricingTable } from '@/components/PricingTable';
import { Skeleton } from '@/components/ui/skeleton';

type Plan = {
  id: string;
  name: string;
  price: number;
  features: string[];
};

export function PricingPage() {
  const { data: plans, isLoading, error } = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: async () => {
      const { data, error } = await supabase.from('plans').select('*');
      if (error) throw error;
      return data;
    },
  });

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <p className="text-red-500">Erro ao carregar planos</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-blue-500 underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4 p-8">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-gray-500">Nenhum plano disponível no momento</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl py-12">
      <h1 className="mb-8 text-center text-3xl font-bold">Nossos Planos</h1>
      <PricingTable plans={plans} />
    </div>
  );
}
```

## Dicas

- **Copie arquivos**, não refaça — aproveite o código testado visualmente
- Identifique e remova dados mockados — substitua por chamadas reais
- Adicione tratamento de erro e loading — sandbox não precisa, produção sim
- **Props tipadas** com interfaces exportadas
- Após graduar, o componente no sandbox pode ser deletado
- Graduação não precisa ser imediata — pode manter ambos em paralelo
- Se o componente for grande, divida em subcomponentes durante a graduação
