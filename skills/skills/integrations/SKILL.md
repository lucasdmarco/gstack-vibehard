---
name: integrations
description: "Gerencia integrações com serviços externos via APIs, MCP servers, webhooks, e variáveis de ambiente. Use quando precisar conectar o projeto a um serviço externo (pagamento, email, IA, etc)."
---

# Integrations — Serviços Externos

Gerencia conexões com serviços externos. Usa MCP (Model Context Protocol) para ferramentas nativas do Codex, e APIs REST para serviços sem MCP.

## Quando Usar

- Conectar API de pagamento (Stripe, Mercado Pago)
- Configurar serviço de email (Resend, SendGrid)
- Integrar IA (OpenAI, Anthropic, Gemini)
- Adicionar serviço de terceiros (HubSpot, Slack, etc)
- Configurar variáveis de ambiente para serviços

## MCP Servers (Codex Nativo)

O Codex suporta MCP servers como ferramentas nativas. Eles aparecem automaticamente para o agente quando configurados.

### Configurar MCP

```json
// ~/.codex/mcp.json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "..."
      }
    },
    "stripe": {
      "command": "npx",
      "args": ["-y", "stripe-mcp"],
      "env": {
        "STRIPE_SECRET_KEY": "..."
      }
    }
  }
}
```

### MCP Providers Comuns

| Serviço | MCP Server | Configuração |
|---------|-----------|--------------|
| Supabase | `@supabase/mcp-server` | URL + service role |
| Stripe | `stripe-mcp` | Secret key |
| GitHub | `@modelcontextprotocol/server-github` | Token |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Connection string |
| Filesystem | `@modelcontextprotocol/server-filesystem` | Diretórios |

## Integração via API (Sem MCP)

### Configuração Segura

```bash
# .env.local (nunca commitado)
SUPABASE_URL=https://project.supabase.co
SUPABASE_ANON_KEY=eyJ...
STRIPE_SECRET_KEY=sk_live_...
RESEND_API_KEY=re_...

# .env.example (commitado, sem valores)
SUPABASE_URL=
SUPABASE_ANON_KEY=
STRIPE_SECRET_KEY=
RESEND_API_KEY=
```

### Cliente Genérico

```typescript
// packages/integrations/src/client.ts
const apiKeys = {
  stripe: process.env.STRIPE_SECRET_KEY,
  resend: process.env.RESEND_API_KEY,
  openai: process.env.OPENAI_API_KEY,
} as const;

export function getApiKey(service: keyof typeof apiKeys) {
  const key = apiKeys[service];
  if (!key) throw new Error(`API key for ${service} not configured`);
  return key;
}
```

## Integrações Comuns

### Pagamento (Stripe)

```bash
npm install stripe
```

```typescript
import Stripe from 'stripe';
const stripe = new Stripe(getApiKey('stripe'));

// Criar checkout
const session = await stripe.checkout.sessions.create({
  line_items: [{ price: 'price_123', quantity: 1 }],
  mode: 'payment',
  success_url: `${process.env.APP_URL}/sucesso`,
  cancel_url: `${process.env.APP_URL}/cancelado`,
});

// Webhook
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']!;
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  // handle event.type
});
```

### Email (Resend)

```bash
npm install resend
```

```typescript
import { Resend } from 'resend';
const resend = new Resend(getApiKey('resend'));

await resend.emails.send({
  from: 'no-reply@seudominio.com',
  to: 'user@email.com',
  subject: 'Bem-vindo!',
  html: '<h1>Olá!</h1><p>Seja bem-vindo à plataforma.</p>',
});
```

### IA (OpenAI)

```bash
npm install openai
```

```typescript
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: getApiKey('openai') });

const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Resuma este texto...' }],
});
```

## Webhooks

```typescript
// apps/api/src/webhooks.ts
import { Router } from 'express';

const webhookRouter = Router();

// Validação de webhook
function validateWebhook(req: Request, secret: string): boolean {
  const signature = req.headers['x-webhook-signature'] as string;
  // Implementar validação HMAC
  return true;
}

// Endpoint genérico de webhook
webhookRouter.post('/:service', async (req, res) => {
  const { service } = req.params;

  switch (service) {
    case 'stripe':
      // Processar evento do Stripe
      break;
    case 'supabase':
      // Processar event do Supabase (DB webhook)
      break;
    case 'github':
      // Processar push/PR event
      break;
  }

  res.status(200).json({ received: true });
});
```

## Variáveis de Ambiente

### Por Serviço

```env
# Supabase
SUPABASE_URL=https://project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@dominio.com

# IA
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# App
APP_URL=https://meuapp.vercel.app
NODE_ENV=production
```

### Gerenciamento

```bash
# Criar .env.example para referência
# Adicionar ao .gitignore

# Para Vercel:
vercel env add SUPABASE_URL

# Para desenvolvimento local:
# .env.local é carregado automaticamente pelo Vite/Node
```

## Dicas

- **Prefira MCP** quando disponível — integração nativa com o Codex
- **API keys** nunca no código fonte — use variáveis de ambiente
- **.env.example** versionado, .env nunca
- Webhooks devem validar assinatura para segurança
- Para testar webhooks localmente, use `ngrok http 3000`
- Documente cada integração no README — API keys, endpoints, webhooks
- Se o serviço tem SDK, use-o — evite chamadas HTTP raw desnecessárias
- Trate erros de API externa com retry + fallback
