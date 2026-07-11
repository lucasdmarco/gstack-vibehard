---
name: mcp-setup
description: "Configura MCP servers e ferramentas no Codex. Playwright (browser test), Supabase (banco+auth+storage), Vercel (deploy), Stripe (pagamentos), Superpowers (16 skills). O agente pergunta quais ativar e configura automaticamente."
---

# MCP Setup — Ecossistema Completo

Configura MCP servers no `~/.codex/config.toml` e skills em `~/.agents/skills/`.

## Pré-Configurado Globalmente

Estes já estão ativos no `~/.codex/config.toml`:

```toml
# Já configurados — NÃO precisa adicionar de novo:

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp"]
# 27 ferramentas: browser_navigate, browser_click, browser_screenshot, etc.

[mcp_servers.supabase]
type = "http"
url = "https://mcp.supabase.com/mcp"
# Ferramentas: list_tables, execute_sql, apply_migration, storage, auth, functions

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp", "--api-key", "ctx7sk-..."]
```

## MCPs Opcionais (perguntar antes)

### Vercel MCP
```toml
[mcp_servers.vercel]
command = "npx"
args = ["-y", "vercel-mcp"]
# Gerencia deploys, domains, environment variables
```

### Stripe MCP
```toml
[mcp_servers.stripe]
command = "npx"
args = ["-y", "stripe-mcp"]
# Pagamentos, webhooks, produtos
```

## Superpowers (16 Skills)

Já instalado em `~/.agents/skills/superpowers` (junction para `~/.codex/superpowers/skills/`):

| Skill | Descrição |
|-------|-----------|
| `using-superpowers` | Entry-point: uso obrigatório de skills |
| `brainstorming` | Brainstorming estruturado com visual |
| `dispatching-parallel-agents` | Dispatch paralelo de agentes |
| `executing-plans` | Execução de planos |
| `finishing-a-development-branch` | Finalização de branch |
| `receiving-code-review` | Receber e agir em code review |
| `requesting-code-review` | Solicitar code review |
| `subagent-driven-development` | Dev orientado a subagentes |
| `systematic-debugging` | Debug sistemático |
| `test-driven-development` | TDD |
| `using-git-worktrees` | Git worktrees |
| `verification-before-completion` | Verificação antes de finalizar |
| `writing-plans` | Escrita de planos |
| `writing-skills` | Criação de skills |
| `update-cli-config` | Config CLI |

## Skills Portadas do Cursor

Disponíveis em `~/.agents/skills/`:

| Skill | Descrição |
|-------|-----------|
| `split-to-prs` | Divide trabalho em PRs pequenos revisáveis |
| `create-rule` | Cria regras para contexto persistente |
| `create-hook` | Cria hooks para eventos do agente |

## Canvas SDK

O Cursor tem um SDK de canvas com tipos TypeScript (chart-primitives, ui-primitives, hooks, theme, diff-view, form, todo-list, dag-layout). O Codex usa a abordagem `canvas` skill com HTML/Tailwind — mais portátil e sem dependência de SDK proprietário.

## Como Verificar se Está Funcionando

```text
# Testar Playwright MCP
# Peça ao agente: "testa a página http://localhost:5173 no navegador"

# Testar Supabase MCP
# Peça ao agente: "usa o Supabase MCP para listar os projetos"

# Listar skills disponíveis
Get-ChildItem "$env:USERPROFILE\.agents\skills" -Directory
```

## Dicas

- Playwright MCP já está configurado globalmente no `~/.codex/config.toml`
- Supabase MCP também já está configurado globalmente
- Primeiro uso do Supabase MCP exige login OAuth (abre navegador)
- Superpowers já está instalado e linkado (16 skills)
- Para testar se o Playwright funciona: peça "testa a página atual no navegador"
- Para atualizar Superpowers: `cd ~/.codex/superpowers && git pull`
- Os MCPs são carregados automaticamente pelo Codex ao iniciar
- Se um MCP não aparecer, verifique se o config.toml está correto e reinicie o Codex
- Cursor tem browser MCP similar (27 tools), mas Playwright MCP é equivalente
- Cursor também tem Vercel MCP plugin — mesmo conceito, podemos adicionar no Codex

## Hooks do Codex

Hooks são scripts determinísticos em eventos do ciclo de vida. Configurados em `~/.codex/hooks.json`:

| Evento | Matcher | Script | Função |
|--------|---------|--------|--------|
| SessionStart | startup\|resume | session_start.py | Injeta contexto + memórias |
| PreToolUse | ^Bash$ | pre_tool_use_security.py | Bloqueia comandos perigosos |
| PermissionRequest | ^Bash$ | permission_request.py | Auto-aprova comandos seguros |
| PostToolUse | apply_patch\|Edit\|Write | post_tool_use_review.py | Revisa alterações com erro |
| Stop | any | stop.py | Salva memórias da sessão |
| UserPromptSubmit | any | user_prompt_submit.py | Sugere skills pelo prompt |

Scripts em `~/.codex/hooks/`. Gerenciar: `/hooks` no CLI. Docs: https://developers.openai.com/codex/hooks
