---
name: auto-testing
description: "Testa o frontend no navegador automaticamente usando Playwright MCP. O agente abre o app, navega, tira print, analisa visualmente, e corrige problemas de UI/UX antes de entregar ao usuário."
---

# Auto-Testing — Playwright MCP

Usa o Playwright MCP para testar o frontend no navegador real. O agente abre a aplicação, interage com ela, identifica problemas visuais e funcionais, e corrige automaticamente.

## Quando Ativar

Sempre que criar ou modificar um componente/página frontend:
- "cria uma página de login"
- "refatora o dashboard"
- "adiciona um formulário"
- "muda o layout da navbar"

## Fluxo de Teste

Após gerar o código e iniciar o dev server, o agente DEVE:

### 1. Abrir o navegador

Usar a ferramenta `browser_navigate` do Playwright MCP:
```
browser_navigate({ url: "http://localhost:5173" })
```

### 2. Tirar screenshot

```
browser_screenshot({})
```

### 3. Analisar visualmente

Verificar no screenshot:
- Layout está quebrado? (elementos sobrepostos)
- Cores consistentes? (botão azul, fundo branco)
- Texto legível? (contraste, tamanho)
- Responsivo? (testar em 375px e 1280px)
- Componentes shadcn renderizando corretamente?

### 4. Interagir e testar

Navegar como um usuário:
```
browser_click({ selector: "a[href='/login']" })
browser_screenshot({})
browser_type({ selector: "input[type='email']", text: "teste@email.com" })
browser_type({ selector: "input[type='password']", text: "123456" })
browser_click({ selector: "button:has-text('Entrar')" })
browser_screenshot({})
```

### 5. Relatório de Problemas

Se encontrar problemas, o agente DEVE listar:

```markdown
## Problemas Encontrados
1. Botão "Entrar" com cor de fundo branca (invisível)
2. Input de email sem placeholder
3. Layout quebrado em mobile (375px)
4. Mensagem de erro não aparece quando senha errada
```

### 6. Corrigir e Retestar

Para cada problema:
1. Editar o arquivo fonte
2. Aguardar hot reload (Vite)
3. Recarregar a página: `browser_navigate({ url: "http://localhost:5173" })`
4. Tirar novo screenshot
5. Verificar se o problema foi resolvido

## Auto-Testing Completo

Para um teste completo de página:

```markdown
## Teste: Página de Login

1. Abrir http://localhost:5173 → screenshot
2. Clicar em "Login" → screenshot
3. Preencher email inválido → clicar "Entrar" → screenshot
   ✓ Deve mostrar erro "Email inválido"
4. Preencher dados corretos → clicar "Entrar" → screenshot
   ✓ Deve redirecionar para o dashboard
5. Verificar dashboard → screenshot
   ✓ Cards de métricas visíveis
   ✓ Tabela de dados carregada
   ✓ Navegação funcionando
```

## Checklist de Qualidade Visual

Após qualquer alteração de UI, verifique:

- [ ] Screenshot inicial não mostra layout quebrado
- [ ] Cores da marca (primary, secondary) aplicadas corretamente
- [ ] Contraste suficiente em todo texto
- [ ] Componentes responsivos (testar 375px e 1280px)
- [ ] Estados de loading aparecem (skeleton/spinner)
- [ ] Estados de erro aparecem (mensagem + retry)
- [ ] Formulários mostram validação
- [ ] Navegação funciona (links, botões, menu)
- [ ] shadcn/ui components renderizam sem erros

## Dicas

- O Playwright MCP já está configurado no Codex (mcp_servers.playwright)
- O agente TEM acesso ao browser — USE esta capacidade SEMPRE que fizer frontend
- Após cada correção, tire novo screenshot para verificar
- Se o dev server não estiver rodando, inicie com: `npm run dev` em background
- Para testar responsivo, use `set_viewport` do Playwright
- O hot reload do Vite atualiza automaticamente após editar arquivos
