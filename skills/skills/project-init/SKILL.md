---
name: project-init
description: "Configura o ecossistema de desenvolvimento em qualquer projeto. Pergunta uma a uma as ferramentas (gstack, gbrain, context7, superpowers, graphify, mom) e instala apenas as que o usuário confirmar."
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

```text
# Pergunta: "Instalar gstack? (configura estrutura de infra do projeto)"
# Se Sim, perguntar variante primeiro:
# "Qual variante de backend? (express / fastify / hono)"
# Default: express
# DETECTAR SO:
# - Windows: & "$env:USERPROFILE\.agents\scripts\setup-gstack.ps1" -ProjectDir "<diretorio-do-projeto>" -Variant "<variante>"
# - Linux/macOS: bash ~/.agents/scripts/setup-gstack.sh "<diretorio-do-projeto>" "<variante>"
```

**O que cria:** `.gstack/config.json` com stack, infra, versões, variant, api_dir, db_package

**Pós-instalação:** copie apenas a variante escolhida do template:
```text
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

```text
# Pergunta: "Instalar gbrain? (cria contexto do negócio e decisões)"
# Se Sim:
# - Windows: & "$env:USERPROFILE\.agents\scripts\setup-gbrain.ps1" -ProjectDir "<diretorio-do-projeto>"
# - Linux/macOS: bash ~/.agents/scripts/setup-gbrain.sh "<diretorio-do-projeto>"
```

**O que cria:** `.gbrain/context.json` + `.gbrain/README.md` com objetivos, stakeholders, decisões

---

### 3. context7 — Stack e Documentação

```text
# Pergunta: "Instalar context7? (documentação da stack e contexto para IA)"
# Se Sim:
# - Windows: & "$env:USERPROFILE\.agents\scripts\setup-context7.ps1" -ProjectDir "<diretorio-do-projeto>"
# - Linux/macOS: bash ~/.agents/scripts/setup-context7.sh "<diretorio-do-projeto>"
```

**O que cria:** `.context7/stack.json` + `.context7/AGENTS.md` (lido automaticamente pelo Codex como contexto)

---

### 4. superpowers — Utilitários

```text
# Pergunta: "Instalar superpowers? (scripts de dev, build, deploy)"
# Se Sim:
# - Windows: & "$env:USERPROFILE\.agents\scripts\setup-superpowers.ps1" -ProjectDir "<diretorio-do-projeto>"
# - Linux/macOS: bash ~/.agents/scripts/setup-superpowers.sh "<diretorio-do-projeto>"
```

**O que cria:** `scripts/run.ps1` + `scripts/seed.ps1`

---

### 5. graphify — Grafos de Dependência

```text
# Pergunta: "Instalar graphify? (visualização de dependências do projeto)"
# Se Sim:
# - Windows: & "$env:USERPROFILE\.agents\scripts\setup-graphify.ps1" -ProjectDir "<diretorio-do-projeto>"
# - Linux/macOS: bash ~/.agents/scripts/setup-graphify.sh "<diretorio-do-projeto>"
```

**O que cria:** `.graphify/deps.json` + `.graphify/index.html` (grafo visual)

---

### 6. frontend-design — Design System

```bash
# Pergunta: "Instalar design system? (configura tema, cores, tipografia para o projeto)"
# Se Sim:
#   - Carregar skill frontend-design
#   - Perguntar engine (brutalist/soft/minimalist/stitch) OU se ja tem DS proprio
#   - Gerar design-system/MASTER.md no projeto
#   - Salvar em .gstack/session_state.json
# Se Nao: anotar e seguir
```

**O que cria:** `design-system/` com MASTER.md (cores, tipografia, spacing, componentes)

**Pós-instalação:** os hooks `pre_tool_use_security.py` vão verificar session_state antes de permitir escrita de UI.

---

### 7. MOM — Memória Persistente para Agentes

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
Usuario: "quero criar um projeto de vendas"

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
10. PERGUNTA: "Instalar graphify?"
   → Se sim: executa setup-graphify.ps1
11. PERGUNTA: "Instalar design system? (frontend-design)"
   → Se sim: carregar skill frontend-design, gerar design-system/MASTER.md
12. PERGUNTA: "Instalar MOM?" (⚠️ só no Linux/macOS — Windows usa chronicle)
13. Iniciar dev server + abrir navegador
14. "Projeto pronto! Use scripts/run.ps1 (Windows) ou scripts/run.sh (Linux/macOS) dev para comandos rápidos"
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
10. PERGUNTA: "Instalar graphify?"
   → Se sim: executa setup-graphify.ps1
11. PERGUNTA: "Instalar MOM?" (⚠️ só no Linux/macOS — Windows usa chronicle)
12. Iniciar dev server + abrir navegador
13. "Projeto pronto! Use scripts/run.ps1 (Windows) ou scripts/run.sh (Linux/macOS) dev para comandos rápidos"
```

## Para Projetos Existentes

Se o usuário abrir um projeto existente e as pastas `.gstack`, `.gbrain`, `.context7`, `.graphify` ou `scripts/` não existirem, o agente PERGUNTA se quer instalar cada ferramenta faltante.

## Comportamento do Agente

- PERGUNTE antes de cada instalação
- Aguarde a resposta do usuário
- Se o usuário disser "sim para todos", instale todos sem perguntar de novo
- Se o usuário disser "não para um", pule e vá para o próximo
- Respeite a escolha — não insista

## Executor determinístico (recomendado)

Em vez de rodar os `setup-*.ps1` à mão e improvisar quando um falha, use o **executor**
que já roda os scripts e **VERIFICA os artefatos**, retornando o status honesto por ferramenta:

```bash
gstack_vibehard onboarding run --dir <projeto> --tools all --variant express --json
```

Ele devolve `installed` (artefato verificado) / `degraded` (script falhou ou config incompleta)
/ `failed` (artefato ausente) / `skipped`, e **exit 1** se não estiver pronto. O relatório fica
em `.gstack/onboarding/report.json`. Prefira isto a declarar sucesso na base da confiança.

## Honestidade da instalação (obrigatório)

- **Se um script `setup-*.ps1`/`setup-*.sh` FALHAR, o passo é `degraded` — NUNCA "instalado
  com sucesso".** Mostre o erro ao usuário. Se você improvisar a configuração manualmente,
  o status continua `degraded` e o usuário precisa ser informado do que foi feito à mão.
- **Ferramenta só é "instalada" com o ARTEFATO verificado** (verifique com `Test-Path`/`ls`
  após cada setup, nunca assuma):
  - gstack → `.gstack/config.json` (com `variant`, `api_dir`, `db_package` preenchidos)
  - gbrain → `.gbrain/context.json`
  - context7 → `.context7/stack.json` e `.context7/AGENTS.md`
  - superpowers → `scripts/run.ps1` (Windows) ou `scripts/run.sh` (Linux/macOS)
  - graphify → `.graphify/deps.json`
- Ao final, o resumo deve separar: **instalado (artefato verificado) / degraded (fallback
  manual) / pulado (escolha do usuário) / falhou**. Nunca declare "Projeto pronto!" se
  algum passo obrigatório falhou.
