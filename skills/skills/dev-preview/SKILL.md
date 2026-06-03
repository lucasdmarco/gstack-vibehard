---
name: dev-preview
description: "Auto-preview workflow para frontend. O agente gera o código, inicia o servidor dev, abre o navegador, e faz auto-revisão visual antes de entregar."
---

# Dev Preview — Feedback Loop Automático

Elimina o loop manual de "gerar → rodar → abrir → ver → voltar". O agente faz tudo em sequência.

## Como Funciona

1. Gera o componente/arquivo
2. Inicia servidor dev (se necessário) via `nohup` / `Start-Process`
3. Abre o navegador automaticamente
4. Faz auto-revisão do código (CSS, responsivo, boas práticas)
5. Pergunta se quer ajustes

## Para HTML Puro (mais rápido, sem build)

```html
<!-- prototipo.html -->
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <title>Preview</title>
</head>
<body>
  <!-- HTML aqui -->
</body>
</html>
```

```
Após escrever este arquivo, o agente DEVE executar:
1. Start-Process -LiteralPath "prototipo.html"
   (abre no navegador padrão)

2. Auto-revisão do código:
   - Cores: tem paleta consistente? (text-gray-700, blue-600)
   - Spacing: padding/margin consistentes? (p-4, p-6, gap-4)
   - Responsivo: grid/grid-cols-{1,2,3} com responsive breakpoints?
   - Tipografia: tamanhos hierárquicos? (text-2xl → title, text-base → body)
   - Contraste: texto em fundo escuro? legível?
   - Acessibilidade: labels? roles? alt text?
```

## Para React/Vite

```bash
# Fluxo automático pelo agente:

# 1. Se não existe projeto Vite, criar:
npm create vite@latest . -- --template react-ts

# 2. Iniciar servidor (background)
Start-Process -WindowStyle Hidden -FilePath "powershell" -ArgumentList "-Command npm run dev"

# 3. Aguardar servidor ficar pronto (ate 10s)
Start-Sleep -Seconds 3

# 4. Abrir navegador
Start-Process "http://localhost:5173"

# 5. Auto-revisão do código gerado (ANTES de perguntar ao usuário):
#    □ Componentes usam props tipadas
#    □ Estados de loading/error/empty tratados
#    □ CSS responsivo (mobile-first)
#    □ Sem inline styles (usar Tailwind classes)
#    □ Cores consistentes com o tema
#    □ Acessibilidade básica (aria-labels, roles)

# 6. Testar no navegador com Playwright MCP (se disponível):
#    browser_navigate({ url: "http://localhost:5173" })
#    browser_screenshot({})
#    Analisar visualmente o resultado
#    Se problemas: corrigir e retestar
```

## shadcn/ui

Se shadcn estiver instalado no projeto, **SEMPRE use componentes shadcn**:

```tsx
// ✅ Certo
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ❌ Errado (evitar HTML puro quando shadcn disponível)
<button className="bg-blue-500 px-4 py-2 rounded">
<div className="border rounded-lg p-4">
```

Verifique se `apps/web/components.json` existe para confirmar shadcn.

## Auto-Revisão (Obrigatória)

Antes de apresentar o resultado ao usuário, o agente DEVE revisar:

```typescript
// Checklist interno que o agente verifica no código gerado
const review = {
  // Layout
  responsivo: "grid usa grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  spacing: "padding/margin consistentes (p-4, p-6, gap-4)",
  alinhamento: "text-center, items-center, justify-between",

  // Design
  cores: "paleta consistente (blue-600, gray-50, white)",
  tipografia: "hierarquia (text-2xl title, text-base body, text-sm caption)",
  contraste: "texto legível em todos os backgrounds",

  // React
  props: "tipadas com interface/type",
  estados: "loading, error, empty tratados",
  perf: "sem re-renders desnecessários",
};

// APÓS a revisão de código, TESTAR no navegador com Playwright:
// 1. browser_navigate → screenshot
// 2. Verificar layout, cores, responsivo
// 3. Interagir com elementos (cliques, inputs)
// 4. Se encontrar erro: corrigir, esperar hot reload, retestar
// 5. Só entregar ao usuário após teste visual passar
```

## Quando Ativar

Sempre que o usuário pedir:
- "cria um componente/página"
- "faz um protótipo/mockup"
- "refatora a UI/UX"
- "melhora o visual"

## Dicas para o Agente

- HTML puro com Tailwind CDN = preview instantâneo (zero build, zero install)
- Sempre abra o navegador após gerar o arquivo (Start-Process)
- Faça auto-revisão antes de perguntar se o usuário quer ajustes
- O dev server (npm run dev) roda em background — continue iterando
- Após editar o arquivo, o usuário dá F5 no browser (Vite faz hot reload)
- Se o usuário disser "está ruim", peça específico: "o que está errado? cor? layout? espaçamento?"
