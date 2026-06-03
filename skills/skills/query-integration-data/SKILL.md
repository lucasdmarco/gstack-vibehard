---
name: query-integration-data
description: "Faz requisições a APIs externas (REST/GraphQL), consulta banco de dados, e integra dados entre sistemas. Use para buscar dados de APIs, transformar dados, ou integrar serviços."
---

# Query & Integration Data

Consulta APIs externas, faz queries no banco Supabase, e integra dados entre sistemas. Suporta REST, GraphQL, SQL, e WebSockets.

## Quando Usar

- Buscar dados de APIs públicas ou privadas
- Consultar dados no Supabase
- Integrar sistemas (webhooks, APIs)
- ETL simples
- Enriquecer dados com fontes externas

## Consultas a APIs REST

### Fetch Nativo (Node.js 18+)

```typescript
// GET
const response = await fetch('https://api.github.com/users/octocat');
const data = await response.json();

// POST com headers
const res = await fetch('https://api.exemplo.com/data', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.API_KEY}`,
  },
  body: JSON.stringify({ query: 'teste' }),
});
const result = await res.json();
```

### Axios

```bash
npm install axios
```

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://api.exemplo.com',
  headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
});

// GET
const { data } = await api.get('/users');

// POST
const { data } = await api.post('/users', { name: 'João' });
```

### Retry + Error Handling

```typescript
async function fetchWithRetry(url: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); // exponential backoff
    }
  }
}
```

## GraphQL

### Apollo Client

```bash
npm install @apollo/client graphql
```

```typescript
import { ApolloClient, InMemoryCache, gql } from '@apollo/client';

const client = new ApolloClient({
  uri: 'https://api.exemplo.com/graphql',
  cache: new InMemoryCache(),
  headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
});

const GET_USERS = gql`
  query GetUsers {
    users {
      id
      name
      email
    }
  }
`;

const { data } = await client.query({ query: GET_USERS });
```

### Fetch Simples (Alternativa)

```typescript
const query = `
  query GetUsers {
    users { id name email }
  }
`;

const res = await fetch('https://api.exemplo.com/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const { data } = await res.json();
```

## Queries ao Supabase

### SQL Direto

```typescript
// Usando postgres.js (via Drizzle)
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

// Query
const users = await sql`SELECT * FROM users WHERE email = ${email}`;

// Insert
const [user] = await sql`
  INSERT INTO users (name, email)
  VALUES (${name}, ${email})
  RETURNING *
`;
```

### Supabase Client

```typescript
import { supabase } from './supabase-client';

// Select
const { data: users, error } = await supabase
  .from('users')
  .select('*')
  .eq('email', email)
  .single();

// Insert
const { data, error } = await supabase
  .from('users')
  .insert({ name: 'João', email: 'joao@email.com' })
  .select();

// RPC (stored procedure)
const { data, error } = await supabase.rpc('get_metrics', { period: 'month' });
```

## Integração com APIs do Projeto

Quando integrar APIs que fazem parte do mesmo projeto:

1. **APIs internas** → chame diretamente via função (não HTTP)
2. **APIs externas** → use fetch/axios com tratamento de erro
3. **Webhooks** → crie endpoint POST no backend para receber eventos
4. **Polling** → use setInterval ou cron jobs para buscar dados periodicamente

## Planilhas / CSV

```typescript
// Parse de CSV
function parseCSV(text: string) {
  const [header, ...rows] = text.trim().split('\n');
  const cols = header.split(',');
  return rows.map(row => {
    const values = row.split(',');
    return cols.reduce((obj, col, i) => ({ ...obj, [col.trim()]: values[i]?.trim() }), {});
  });
}

// Export CSV
function toCSV(data: Record<string, any>[]) {
  const header = Object.keys(data[0]).join(',');
  const rows = data.map(row => Object.values(row).join(','));
  return [header, ...rows].join('\n');
}
```

## Tratamento de Erros

```typescript
type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

async function safeFetch<T>(url: string): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
```

## Rate Limiting

```typescript
// Throttle simples
async function rateLimitedFetch(urls: string[], delay = 1000) {
  const results: any[] = [];
  for (const url of urls) {
    const res = await fetch(url);
    results.push(await res.json());
    await new Promise(r => setTimeout(r, delay));
  }
  return results;
}

// Batch com Promise.allSettled
async function batchFetch(urls: string[]) {
  return Promise.allSettled(urls.map(url => fetch(url).then(r => r.json())));
}
```

## Dicas

- **Sempre trate erros** — APIs externas podem falhar
- **Use retry com backoff** para chamadas críticas
- **Cache** respostas de APIs com tempo de expiração
- **Nunca** exponha API keys no frontend — use backend como proxy
- Prefira `Promise.allSettled` quando uma falha não deve parar o batch
- Para webhooks, use ngrok ou Vercel para testes locais
- Documente integrações no README do projeto
