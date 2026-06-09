# 🚀 gstack-vibehard 2.1.4
**A Máquina de Desenvolvimento Zero-Config Definitiva para Agentes de IA.**

O `gstack-vibehard` é um **Control Plane e Instalador Cross-Harness**. Ele envelopa o seu terminal com ferramentas de elite, transformando Claude Code, Cursor, OpenCode e Codex em um ecossistema corporativo seguro, unificado e autônomo, rodando 100% na sua máquina.

Chega de alucinações, vazamentos de dados ou perda de contexto. O `gstack-vibehard` implementa a mesma infraestrutura de workspaces do Replit Agent 4, mas operando no seu CLI favorito.

---

## ✨ O que há de novo na v2.1.4 (Quality Gate + Locking + GitOps)

- 🛡️ **Quality Gate no Commit:** `--no-verify` removido do `git commit`. Agora controlado por `GSTACK_ALLOW_DIRTY_COMMIT=1` (default = respeita hooks pre-commit).
- 🔒 **File Locking Robusto:** `instincts.yaml` usa lock bloqueante com retry e exponential backoff. YAML sanitizado (sem injeção via aspas ou newlines). Read+write unificado sob lock.
- 🤖 **GitOps Seguro:** Issue automática desativada por default (`GSTACK_AUTO_ISSUE=1` para ativar). Corpo da issue passa pelo Output Guard antes de publicar. Caminho local removido do corpo.
- 🛡️ **Zero-Trust Output Guard:** Um "Agente Porteiro" intercepta as saídas da IA. Usa RBAC (`GSTACK_USER_ROLE`) para escanear e bloquear vazamentos de 8 classes de dados sensíveis (Chaves Stripe, Tokens GitHub, CPFs, etc.) antes de exibi-los.
- 📦 **Replitização do Workspace:** Os projetos nascem com manifestos de app nativos (`.gstack/app.json`, `ports.json` e `services.json`), com `run_command`, `build_command`, `env` e portas dinâmicas por template.
- 🔌 **Harness Bridge Real:** Integração com Cursor (`.cursor/rules/gstack-vibehard.mdc`), OpenCode (`hooks.json` com `tool.execute.before` e `session.idle`) e Claude Code (`settings.json` com `lifecycleHooks`).
- 🪶 **Modo `--lite`:** Gere projeto sem Docker/Rust/ECC 2.0 — ideal para máquinas com recursos limitados.
- 🔒 **RCE-Safe & Hardened:** Todas as execuções externas usam `execFileSync()` com `shell: false`. Nenhuma URL ou nome de projeto malicioso pode injetar comandos no shell. Nomes de projeto validados por allowlist (`/^[a-zA-Z0-9._-]+$/`).
- 🪵 **Error Visibility:** Empty catches eliminados em todo o código — erros reais são logados com contexto, não silenciados.

### v2.1.4 (Quality Gate + Locking + GitOps)

- 🧪 **N1 — No `--no-verify` unconditional:** Agora controlado por `GSTACK_ALLOW_DIRTY_COMMIT=1`. Default = pre-commit hooks rodam.
- 🔒 **N2 — instincts.yaml Locking Rewrite:** Lock bloqueante com retry + backoff. Unificado sob fd `a+`. YAML sanitizado.
- 🤖 **N3 — GitOps Opt-in + Guard:** Issue criada apenas se `GSTACK_AUTO_ISSUE=1`. Corpo passa pelo Output Guard. Caminho local removido.

### v2.1.3 (Shared Output Guard + Viewer Default)

- 📦 **Output Guard como Módulo Compartilhado:** `output_guard()` extraído para `_output_guard.py`.
- 👁️ **Default Role `viewer`:** `GSTACK_USER_ROLE` agora defaulta para `"viewer"`.
- 🔌 **Guard no Session Start e Post-Sprint.**

---

## ⚡ Instalação Rápida

```bash
npm install -g @gstack-vibehard/installer
gstack_vibehard create meu-projeto
# Para ambientes sem Docker/Rust: gstack_vibehard create meu-projeto --lite
```

---

## 🏗️ Templates Verticais

- `fullstack-monorepo` (Express/Fastify/Hono + React)
- `saas-auth-stripe` (Next.js + Supabase + Stripe)
- `mobile-backend` (Expo + tRPC + PostgreSQL)
- `ai-agent-platform` (LangGraph + ChromaDB + FastAPI)

---

## 🧠 Arquitetura

- **Graphify:** AST caching a custo zero — IA lê topologia sem consumir API
- **Headroom:** Proxy MCP que comprime RAG/logs em até 95%
- **Fallow:** Auditoria determinística em Rust — CRAP analysis, código morto
- **Post-Sprint:** ROI da sessão, arquivos via Atomic VCS, decisões no MOM
- **TUI Monitor:** `gstack_vibehard monitor` — harnesses, QG, tokens em tempo real

---

## 🔒 Segurança

- **File Locking:** `fcntl`/`msvcrt` nativo para `instincts.yaml`
- **Output Guard:** RBAC (admin/developer/viewer) bloqueia secrets por nível — default `viewer` (menor privilégio)
- **Project Name Allowlist:** `^[a-zA-Z0-9._-]+$` — sem injeção via `$()`, backtick, `;`
- **No Shell Execution:** `execFileSync` com `shell: false` em todo o código
- **GitOps Seguro:** `git push` apenas com consentimento explícito

---

## 📝 Licença MIT
