# 🚀 gstack-vibehard 2.1.8
**A Máquina de Desenvolvimento Zero-Config Definitiva para Agentes de IA.**

O `gstack-vibehard` é um **Control Plane e Instalador Cross-Harness**. Ele envelopa o seu terminal com ferramentas de elite, transformando Claude Code, Cursor, OpenCode e Codex em um ecossistema corporativo seguro, unificado e autônomo, rodando 100% na sua máquina.

Chega de alucinações, vazamentos de dados ou perda de contexto. O `gstack-vibehard` implementa a mesma infraestrutura de workspaces do Replit Agent 4, mas operando no seu CLI favorito.

---

## ✨ O que há de novo na v2.1.8 (Segurança + Performance + Higiene)

- 🔌 **Fase 0–8 — Portabilidade Cross-Harness:** Paths unificados (`_paths.py`), input normalization (`_harness.py`), crash safety global, MCP config para Claude, bridge real, hooks independentes do Codex, detectores para Windsurf/Gemini/Kiro/Zed.
- 🛡️ **RCE Elimination:** `safeDownloadAndRun` usa `param($u,$o)` no PowerShell. O código principal em `src/` não usa mais `execSync(string)`.
- 🧠 **Python portátil:** `sys.executable` em hooks + `resolvePythonCmd()` no JS (prefere `python3`, fallback `python`).

### v2.1.8 (Segurança + Performance + Higiene)

- **L1 — Ameaças letais:** `git add -A` removido dos fluxos automáticos; staging agora é explícito. `execSync(string)` eliminado do código principal em `src/`. Vetor de injeção em `agent-distribution.js` fechado com allowlist de harness.
- **L2 — Performance/UX:** `collect_project_files()` agora usa `os.walk()` com poda real de `node_modules`, `.git`, `dist`, `.venv`. Monitor TUI cacheia leituras de chronicle/sprint. `Popen` best-effort trocado por `run(timeout=...)`.
- **L3 — Governança:** Chronicle deduplicado em `_chronicle.py`; paths globais centralizados em `_paths.py`; catches críticos agora logam contexto.
- **L4 — Documentação honesta:** claims de segurança rebaixados para refletir apenas o código principal verificado.

### v2.1.7 (Polimento + Governança + Bugs)

- 🐛 **L1 — Bugs impeditivos:** `$env:TEMP` expande no Windows installer. SIGINT handler funcional. Doctor com timeout.
- 🪟 **L2 — Cross-platform:** `execFileSync` em detector.js (8 harnesses). ENOENT handling no sprint. Paths normalizados.
- ⚡ **L3 — Performance:** `collect_project_files()` cache elimina 35 rglob redundantes. Async copy loops no instalador. Version checks paralelos.
- 📖 **L4 — Documentação:** Seção "Modo de Uso" adicionada no README.
- 🛡️ **L5 — Governança:** `git_worktree_autosave.py` previne data loss. Warnings de graceful degradation para Codex/Gemini. `tsc --noEmit` complementa Fallow no qg.py. Limpeza de tmux zumbi no stop.py e gc.py.

### v2.1.6 (Cross-Harness Portability + RCE Elimination)

- **F0 — Python portátil:** `sys.executable` em vez de `"python"`. `resolvePythonCmd()` no JS.
- **F1 — Path resolution unificada:** `_paths.py` com `read_with_fallback()`. Dados em `~/.gstack/`.
- **F2 — Input normalization:** `_harness.py` mapeia snake_case + camelCase.
- **F3 — Crash safety:** `sys.excepthook` global em `stop.py`.
- **F4 — MCP para Claude:** `claude.js` escreve em `~/.claude/settings.json`.
- **F5 — Bridge real:** `writeRealHarnessBridge` aponta para `~/.gstack/hooks/`.
- **F6 — Claude independente:** Hooks copiados do pacote, não do Codex.
- **F7 — OpenCode com stdin:** Plugin passa payload JSON para `stop.py`.
- **F8 — Detectores:** Windsurf, Gemini CLI, Kiro, Zed.
- **C1.3 — safeDownloadAndRun seguro:** `param($u,$o)` bind no PowerShell.
- **C1.2 — headroom.js RCE-free:** 6 `execSync` → `execFileSync`.
- **README honesto:** Claims corrigidas sobre escopo do `execFileSync`.

### v2.1.4 (Quality Gate + Locking + GitOps)

- 🛡️ **Quality Gate no Commit:** `--no-verify` removido do `git commit`. Agora controlado por `GSTACK_ALLOW_DIRTY_COMMIT=1` (default = respeita hooks pre-commit).
- 🔒 **File Locking Robusto:** `instincts.yaml` usa lock bloqueante com retry e exponential backoff. YAML sanitizado (sem injeção via aspas ou newlines). Read+write unificado sob lock.
- 🤖 **GitOps Seguro:** Issue automática desativada por default (`GSTACK_AUTO_ISSUE=1` para ativar). Corpo da issue passa pelo Output Guard antes de publicar. Caminho local removido do corpo.
- 🛡️ **Output Guard Pós-Resposta:** Escaneia o transcript JSONL do agente (mensagens + tool_results) no hook `on_stop`. É pós-resposta — o output já foi exibido, mas o guard detecta vazamentos e loga/alerta. Também escaneia o `systemMessage` como camada adicional. Se o transcript_path não estiver disponível, um aviso explícito é emitido. Usa RBAC (`GSTACK_USER_ROLE`, default `viewer`).
- 📦 **Replitização do Workspace:** Os projetos nascem com manifestos de app nativos (`.gstack/app.json`, `ports.json` e `services.json`), com `run_command`, `build_command`, `env` e portas dinâmicas por template.
- 🔌 **Harness Bridge Real:** Integração com Cursor (`.cursor/rules/gstack-vibehard.mdc`), OpenCode (`hooks.json` com `tool.execute.before` e `session.idle`) e Claude Code (`settings.json` com `lifecycleHooks`).
- 🪶 **Modo `--lite`:** Gere projeto sem Docker/Rust/ECC 2.0 — ideal para máquinas com recursos limitados.
- 🔒 **RCE-Safe & Hardened:** Projetos novos usam `execFileSync()` com `shell: false`. Nomes validados por allowlist (`/^[a-zA-Z0-9._-]+$/`). Módulos auxiliares em migração contínua para o mesmo padrão.
- 🪵 **Error Visibility:** Empty catches críticos foram convertidos para logs com contexto. Catches de cleanup/best-effort ainda existem e são documentados como baixo risco.

### v2.1.3 (Shared Output Guard + Viewer Default)

- 📦 **Output Guard como Módulo Compartilhado:** `output_guard()` extraído para `_output_guard.py`.
- 👁️ **Default Role `viewer`:** `GSTACK_USER_ROLE` agora defaulta para `"viewer"`.
- 🔌 **Guard no Session Start e Post-Sprint.**

---

## 📖 Modo de Uso

```bash
# 1. Instalar globalmente
npm install -g @gstack-vibehard/installer

# 2. Diagnosticar ambiente
gstack_vibehard doctor

# 3. Instalar em harnesses detectados
gstack_vibehard install

# 4. Criar novo projeto
gstack_vibehard create meu-projeto
# Sem Docker/Rust: gstack_vibehard create meu-projeto --lite
# Com template específico: gstack_vibehard create meu-projeto --template saas-auth-stripe

# 5. Monitorar ambiente em tempo real
gstack_vibehard monitor

# 6. Salvar sprint (graphify + gbrain + chronicle)
gstack_vibehard sprint --save

# 7. Desinstalar
gstack_vibehard uninstall
```

O Quality Gate roda automaticamente via hooks no final de cada sessão:
- **Claude Code/OpenCode**: hooks restritivos (bloqueiam entrega se CRITICO/ALTO)
- **Codex/Gemini CLI**: modo Best-Effort (instrucional — sem hooks API)
- **Código migrado**: `src/` sem `execSync(string)`; operações de subprocesso usam `execFileSync`/`execFile` com argumentos em array
- **Typecheck complementar**: `qg.py` roda `npx tsc --noEmit` apos Fallow nos projetos com `tsconfig.json`

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
- **Output Guard:** Escaneia transcript do agente + systemMessage no hook on_stop (pós-resposta, best-effort). Loga aviso se transcript não disponível. RBAC admin/developer/viewer — default `viewer`
- **Project Name Allowlist:** `^[a-zA-Z0-9._-]+$` — sem injeção via `$()`, backtick, `;`
- **No Shell Execution:** código principal em `src/` migrado para `execFileSync`/`execFile` com argumentos em array; scripts auxiliares legados continuam em migração contínua
- **GitOps Seguro:** `git push` apenas com consentimento explícito

---

## 📝 Licença MIT
