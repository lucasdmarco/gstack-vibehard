---
name: project-init
description: "Configura o ecossistema de desenvolvimento em qualquer projeto. Pergunta uma a uma as ferramentas (gstack, gbrain, context7, superpowers, graphifhy, mom) e instala apenas as que o usuário confirmar."
---

# Project Init — Setup do Ecossistema

Sempre que um novo projeto for criado ou um projeto existente for aberto sem essas ferramentas, o agente DEVE perguntar sobre cada uma.

## Ordem de Perguntas

Para cada ferramenta abaixo, o agente PERGUNTA antes de instalar:

### 1. gstack — Infraestrutura

📌 **NOVO:** Antes de instalar, pergunte qual variante de backend:
- **express** (default): Express 5 + Supabase PostgreSQL + Vercel
- **fastify**: Fastify 5 + Neon PostgreSQL + Railway
- **hono**: Hono 4 + Turso SQLite + Render

```bash
# Pergunta: "Instalar gstack? (configura estrutura de infra do projeto)"
# Se Sim, perguntar variante primeiro:
# "Qual variante de backend? (express / fastify / hono)"
# Default: express
& "$env:USERPROFILE\.agents\scripts\setup-gstack.ps1" -ProjectDir "<diretorio-do-projeto>" -Variant "<variante>"
```

**O que cria:** `.gstack/config.json` com stack, infra, versões, variant, api_dir, db_package

**Pós-instalação:** copie apenas a variante escolhida do template:
```bash
# Se express:
Copy-Item "$template\apps\api\*" -Destination "$project\apps\api\" -Recurse

# Se fastify:
Copy-Item "$template\apps\api-fastify\*" -Destination "$project\apps\api-fastify\" -Recurse

# Se hono:
Copy-Item "$template\apps\api-hono\*" -Destination "$project\apps\api-hono\" -Recurse
```

Se for PostgreSQL (express/fastify), use `@my/db`. Se for Turso (hono), use `@my/db-turso`.

---

### 2. gbrain — Contexto do Negócio

```bash
# Pergunta: "Instalar gbrain? (cria contexto do negócio e decisões)"
# Se Sim:
& "$env:USERPROFILE\.agents\scripts\setup-gbrain.ps1" -ProjectDir "<diretorio-do-projeto>"
```

**O que cria:** `.gbrain/context.json` + `.gbrain/README.md` com objetivos, stakeholders, decisões

---

### 3. context7 — Stack e Documentação

```bash
# Pergunta: "Instalar context7? (documentação da stack e contexto para IA)"
# Se Sim:
& "$env:USERPROFILE\.agents\scripts\setup-context7.ps1" -ProjectDir "<diretorio-do-projeto>"
```

**O que cria:** `.context7/stack.json` + `.context7/AGENTS.md` (lido automaticamente pelo Codex como contexto)

---

### 4. superpowers — Utilitários

```bash
# Pergunta: "Instalar superpowers? (scripts de dev, build, deploy)"
# Se Sim:
& "$env:USERPROFILE\.agents\scripts\setup-superpowers.ps1" -ProjectDir "<diretorio-do-projeto>"
```

**O que cria:** `scripts/run.ps1` + `scripts/seed.ps1`

---

### 5. graphifhy — Grafos de Dependência

```bash
# Pergunta: "Instalar graphifhy? (visualização de dependências do projeto)"
# Se Sim:
& "$env:USERPROFILE\.agents\scripts\setup-graphifhy.ps1" -ProjectDir "<diretorio-do-projeto>"
```

**O que cria:** `.graphifhy/deps.json` + `.graphifhy/index.html` (grafo visual)

---

### 6. MOM — Memória Persistente para Agentes

⚠️ **MOM é incompatível com Windows** (usa Go + CGo + syscall.Flock). Não instalar no Windows.

**Alternativa:** chronicle skill já faz busca indexada sobre memórias de sessões anteriores (SessionStart hook + gc.py).

```bash
# Se Linux/macOS:
# Pergunta: "Instalar MOM? (memória persistente para agentes AI — recall entre sessões)"
# brew install momhq/tap/mom
```

---

## Fluxo Completo (usado pela new-project skill)

```
Usuário: "quero criar um projeto de vendas"

Agente:
1. mkdir vendas && cd vendas
2. robocopy template + renomear packages
3. PERGUNTA: "Qual variante de backend? (express / fastify / hono)"
   → Default: express
   → Só copia a variante escolhida do template
4. pnpm install
5. npx shadcn@latest add ...
6. PERGUNTA: "Instalar gstack?"
   → Se sim: executa setup-gstack.ps1 -Variant <variante>
7. PERGUNTA: "Instalar gbrain?"
   → Se sim: executa setup-gbrain.ps1
8. PERGUNTA: "Instalar context7?"
   → Se sim: executa setup-context7.ps1
9. PERGUNTA: "Instalar superpowers?"
   → Se sim: executa setup-superpowers.ps1
10. PERGUNTA: "Instalar graphifhy?"
   → Se sim: executa setup-graphifhy.ps1
11. PERGUNTA: "Instalar MOM?" (⚠️ só no Linux/macOS — Windows usa chronicle)
12. Iniciar dev server + abrir navegador
13. "Projeto pronto! Use .\scripts\run.ps1 dev para comandos rápidos"
```

## Para Projetos Existentes

Se o usuário abrir um projeto existente e as pastas `.gstack`, `.gbrain`, `.context7`, `.graphifhy` ou `scripts/` não existirem, o agente PERGUNTA se quer instalar cada ferramenta faltante.

## Comportamento do Agente

- PERGUNTE antes de cada instalação
- Aguarde a resposta do usuário
- Se o usuário disser "sim para todos", instale todos sem perguntar de novo
- Se o usuário disser "não para um", pule e vá para o próximo
- Respeite a escolha — não insista
