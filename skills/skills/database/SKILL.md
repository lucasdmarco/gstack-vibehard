---
name: database
description: "Configura e gerencia banco de dados PostgreSQL via Supabase (empresa). Cria migrations, tabelas, políticas de segurança (RLS), seeds, e faz queries. Use sempre que precisar de banco de dados relacional."
---

# Database — Supabase (Empresa)

Gerencia banco de dados PostgreSQL usando o Supabase da empresa. Todas as queries, migrations, e schemas são feitos via Supabase CLI ou dashboard.

## Stack

- **Banco**: Supabase PostgreSQL (gerenciado pela empresa)
- **ORM**: Drizzle (recomendado) ou Prisma
- **Migrations**: Supabase CLI (`supabase migration`)
- **Tipos**: `supabase gen types` para TypeScript
- **Segurança**: Row Level Security (RLS) obrigatório

## Quando Usar

- Criar tabelas e schemas
- Rodar migrations
- Fazer queries no banco
- Configurar RLS e políticas de segurança
- Modelar dados para uma nova feature

## Setup Inicial

```bash
# 1. Instalar Supabase CLI
npm install -D supabase

# 2. Inicializar no projeto
npx supabase init

# 3. Vincular com o projeto da empresa
npx supabase link --project-ref <project-ref>

# 4. Instalar Drizzle (recomendado)
npm install drizzle-orm postgres
npm install -D drizzle-kit @types/node
```

## Schema com Drizzle

```typescript
// packages/db/src/schema.ts
import { pgTable, serial, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  userId: integer('user_id').references(() => users.id),
  published: boolean('published').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/db/src/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
});
```

### Gerar e Aplicar Migrations

```bash
# 1. Gerar migration do schema
npx drizzle-kit generate

# 2. Aplicar via Supabase
npx supabase db push

# 3. Ou salvar como migration oficial
npx supabase migration new nome_da_migration
# Copia o SQL gerado para o arquivo de migration
npx supabase db push
```

## Row Level Security (RLS)

Toda tabela DEVE ter RLS habilitado:

```sql
-- supabase/migrations/<timestamp>_rls.sql

-- Habilitar RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Política: usuário só vê seus próprios posts
CREATE POLICY "Users can view their own posts"
  ON posts FOR SELECT
  USING (auth.uid() = user_id);

-- Política: usuário só edita seus próprios posts
CREATE POLICY "Users can update their own posts"
  ON posts FOR UPDATE
  USING (auth.uid() = user_id);

-- Política: qualquer um pode ver posts publicados
CREATE POLICY "Anyone can view published posts"
  ON posts FOR SELECT
  USING (published = true);
```

## Queries no Código

```typescript
// apps/api/src/db.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../../packages/db/src/schema';

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
export const db = drizzle(client, { schema });

// apps/api/src/routes/posts.ts
import { db } from '../db';
import { posts } from '../../../packages/db/src/schema';
import { eq } from 'drizzle-orm';

export async function getPosts(req, res) {
  const allPosts = await db.select().from(posts);
  res.json(allPosts);
}

export async function createPost(req, res) {
  const { title, content } = req.body;
  const [post] = await db.insert(posts).values({ title, content }).returning();
  res.status(201).json(post);
}
```

## Seed

```typescript
// supabase/seed.sql
INSERT INTO users (name, email) VALUES
  ('Admin', 'admin@empresa.com'),
  ('Usuário', 'user@empresa.com');
```

```bash
# Aplicar seed
npx supabase db reset
```

## Typescript Types do Supabase

```bash
# Gerar types automáticos do banco
npx supabase gen types typescript --linked > packages/db/src/supabase.ts
```

## Dicas

- Sempre use **migrations**, nunca altere tabelas manualmente no dashboard
- **RLS é obrigatório** — toda tabela precisa de política de segurança
- Prefira **Drizzle** como ORM (leve, type-safe, performático)
- Use `supabase gen types` para ter types atualizados do banco
- Para consultas ad-hoc no banco, use `npx supabase db dump` ou o dashboard
- **Nunca** commite secrets ou connection strings
- Publique migrations via PR, não diretamente na main
- Supabase já está online — não precisa de deploy separado
