---
name: object-storage
description: "Gerencia armazenamento de arquivos (upload, download, buckets, URLs públicas/privadas) usando Supabase Storage da empresa. Use para imagens, PDFs, vídeos, ou qualquer arquivo binário."
---

# Object Storage — Supabase Storage

Usa o Supabase Storage da empresa para armazenar arquivos. Cada arquivo fica em um bucket, com políticas de acesso controladas por RLS.

## Stack

- **Storage**: Supabase Storage (S3-compatible)
- **Client**: `@supabase/supabase-js` (frontend) ou `supabase` admin client (backend)
- **Segurança**: RLS policies + bucket público/privado

## Quando Usar

- Upload/download de imagens, PDFs, vídeos
- Avatares de usuário
- Arquivos de documento (faturas, relatórios)
- Assets do site (imagens públicas)
- Importação/exportação de dados

## Configuração

```bash
# Instalar cliente Supabase
npm install @supabase/supabase-js
```

## Cliente

```typescript
// packages/db/src/supabase-client.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

## Buckets

Crie buckets pelo dashboard do Supabase ou via API:

```typescript
// Criar bucket (apenas server-side com service_role)
const { data, error } = await supabase.admin.storage.createBucket('avatars', {
  public: false, // privado por padrão
  fileSizeLimit: 5242880, // 5MB
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
});
```

### Nomenclatura de Buckets

| Bucket | Público? | Uso |
|--------|----------|-----|
| `avatars` | Público | Fotos de perfil |
| `posts` | Público | Imagens de posts |
| `documents` | Privado | PDFs, planilhas |
| `exports` | Privado | Exportações temporárias |
| `public` | Público | Assets genéricos do site |

## Upload

### Frontend (Browser)

```typescript
async function uploadAvatar(file: File, userId: string) {
  const fileExt = file.name.split('.').pop();
  const filePath = `${userId}/${crypto.randomUUID()}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;

  // Retorna URL pública
  const { data: urlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}
```

### Backend (Server)

```typescript
import { createClient } from '@supabase/supabase-js';

// Usar service_role key para admin access
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function uploadDocument(buffer: Buffer, filename: string, userId: string) {
  const filePath = `${userId}/documents/${Date.now()}_${filename}`;

  const { data, error } = await supabaseAdmin.storage
    .from('documents')
    .upload(filePath, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (error) throw error;
  return filePath;
}
```

## Download

### URL Pública

```typescript
// Bucket público — URL direta
const { data } = supabase.storage
  .from('avatars')
  .getPublicUrl('user-123/avatar.png');

// data.publicUrl -> https://<project>.supabase.co/storage/v1/object/public/avatars/user-123/avatar.png
```

### URL Assinada (arquivos privados)

```typescript
// Bucket privado — URL temporária
const { data, error } = await supabase.storage
  .from('documents')
  .createSignedUrl('user-123/doc.pdf', 3600); // expira em 1h

// data.signedUrl -> URL temporária com token
```

### Download direto

```typescript
const { data, error } = await supabase.storage
  .from('documents')
  .download('user-123/doc.pdf');

// data é um Blob
const url = URL.createObjectURL(data);
```

## Listar e Deletar

```typescript
// Listar arquivos
const { data, error } = await supabase.storage
  .from('avatars')
  .list('user-123/', {
    limit: 100,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });

// Deletar
const { error } = await supabase.storage
  .from('documents')
  .remove(['user-123/doc.pdf']);
```

## Políticas RLS

```sql
-- Bucket público: qualquer um pode ver, só autenticado pode upload
CREATE POLICY "Public bucket read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

-- Bucket privado: só o dono vê
CREATE POLICY "Users can view their own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.uid() = (storage.foldername(name))[1]::uuid
  );
```

## Dicas

- Buckets públicos para assets que qualquer um pode ver (avatares, imagens de posts)
- Buckets privados para documentos sensíveis — use **signed URLs** com expiração
- Sempre valide tipo e tamanho do arquivo no frontend e no backend
- Use `crypto.randomUUID()` para evitar colisão de nomes
- Pastas são simuladas no path — não precisa criar explicitamente
- Limpe arquivos órfãos (uploads não referenciados no banco)
- Service role key só deve ser usada no backend, nunca exposta ao frontend
