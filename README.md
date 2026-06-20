# 🚀 gstack-vibehard 3.0.3
**A Máquina de Desenvolvimento Zero-Config Definitiva para Agentes de IA.**

[![Test](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml/badge.svg)](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml)

O `gstack-vibehard` é um **Control Plane e Instalador Cross-Harness**. Ele envelopa o seu terminal com ferramentas de elite, transformando Claude Code, Cursor, OpenCode e Codex em um ecossistema corporativo seguro, unificado e autônomo, rodando 100% na sua máquina.

Chega de alucinações, vazamentos de dados ou perda de contexto. O `gstack-vibehard` implementa a mesma infraestrutura de workspaces do Replit Agent 4, mas operando no seu CLI favorito.

---

## 🔌 Matriz de Suporte por Harness (honesta)

| Nível | Harness | O que você recebe |
|---|---|---|
| **Hooks reais** (gates automáticos) | **Claude Code** | Hooks registrados em `settings.json` (PreToolUse/Stop/SessionStart/UserPromptSubmit) + MCP em `~/.claude.json` + agentes + regras |
| **Hooks reais** | **Cursor** | Hooks registrados em `~/.cursor/hooks.json` (beforeShellExecution/preToolUse/stop/sessionStart) + agentes + rules `.mdc` |
| **Hooks reais** | **OpenCode** | Plugins JS (`tool.execute.before`, `session.created`) + skills + config com merge não-destrutivo |
| **Instrucional** (best-effort) | Codex, Gemini CLI, Windsurf, Kiro, GitHub Copilot CLI, Droid (Factory), Kilo Code CLI, Kimi CLI | Detecção + arquivo de orientação no convention do harness (`AGENTS.md`/`GEMINI.md`/`global_rules.md`/steering) — o agente é orientado a rodar QG/Test Gate/memória, sem bloqueio por API |
| **Detecção** | Zed, VS Code | Reconhecidos pelo `doctor`/instalador; integração instrucional por-repo (sem convention global seguro) |

Os hooks Python respondem no formato nativo de cada harness (`hookSpecificOutput` para Claude Code, `permission` para Cursor) — camada de saída em `hooks/hooks/_harness.py`.

## ✨ O que há de novo na v2.2.0 (Hooks Reais Cross-Harness)

- 🪝 **Registro real de hooks:** Claude Code (`settings.json` formato oficial) e Cursor (`hooks.json` v1) agora EXECUTAM os gates — antes os hooks eram apenas copiados. OpenCode com merge não-destrutivo.
- 🧪 **Test Gate (paridade Replit):** o Stop hook roda a suíte do projeto (npm/pytest/cargo/go); `GSTACK_TEST_GATE=block` devolve o controle ao agente para corrigir antes de finalizar.
- 🔌 **Mais harnesses:** detectores para GitHub Copilot CLI, Factory Droid, Kilo Code CLI, Kimi CLI e VS Code + integração instrucional real (AGENTS.md/GEMINI.md/global_rules.md) para Gemini/Windsurf/Kiro.
- 🛠️ **uninstall/list/--skip-deps** implementados; downloads Windows via `curl.exe` (sem interpolação PowerShell).
- ✅ **Suíte de testes viva:** CI roda `npm test` + `pytest` em matriz de 3 SOs; 19 testes Node + 21 Python.

### v2.1.9 (Execução Consertada)

- 🩹 **CI vivo:** workflow disparava só em `main` (branch é `master`) — nunca rodou. Corrigido + jobs Node/pytest.
- 🪟 **Bugs Windows:** `\r` corrompia o path do `rustup-init`; download do `create` nunca recebia argumentos. Ambos via `curl.exe`.
- 🐛 **Hooks:** `stop.py` falhava toda sessão sem `openhands` (sandbox agora opt-in); `gitignore_has_dotenv` implementada; design system mandate passou a ler `file_path`.
- 🔌 **MCP:** `claude.js` escreve em `~/.claude.json` (local que o Claude Code lê).

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
- **F4 — MCP para Claude:** `claude.js` escreve em `~/.claude.json` (local que o Claude Code lê; corrigido na v2.1.9).
- **F5 — Bridge real:** `writeRealHarnessBridge` aponta para `~/.gstack/hooks/`.
- **F6 — Claude independente:** Hooks copiados do pacote, não do Codex.
- **F7 — OpenCode com stdin:** Plugin passa payload JSON para `stop.py`.
- **F8 — Detectores:** Windsurf, Gemini CLI, Kiro, Zed.
- **C1.3 — safeDownloadAndRun seguro:** downloads via `curl.exe` com argumentos em array (corrigido na v2.1.9 — o bind `param($u,$o)` não funcionava com `-Command`).
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

## 📖 Modo de Uso — passo a passo

### Passo 0 — Instalar o CLI

**Qualquer SO (recomendado):**
```bash
npm install -g @gstack-vibehard/installer
```
**Windows:** dê duplo-clique em `launchers/windows/install.bat` (verifica o Node e roda via `npx`), ou use o comando npm acima.
**macOS:** o comando npm acima; ou `brew install --formula launchers/macos/gstack_vibehard.rb`.

Confirme: `gstack_vibehard --version`

---

### `doctor` — diagnosticar o ambiente
```bash
gstack_vibehard doctor
```
Mostra: Node/Python, harnesses detectados e nível de integração (hooks reais / instrucional / detecção), hooks instalados, skills, deps globais (bun, uv, Rust, Go, pytest, headroom), seção **Integrações** (Composio + Printing Press) e Playwright. **Rode primeiro** para ver o que falta.

### `install` — configurar o ambiente (Safe Install: preflight-first)
```bash
gstack_vibehard install --audit-only   # PREFLIGHT: lista o impacto global por categoria, SEM escrever nada
gstack_vibehard install --project-only # impacto global mínimo (sem deps/MCP global/vault)
gstack_vibehard install --harness claude   # instala só um harness
gstack_vibehard install                # instalação completa (mostra o impacto e PEDE confirmação)
gstack_vibehard install --yes          # confirma o impacto global (necessário em modo não-interativo)
gstack_vibehard install --global-mcp   # opt-in: escrever MCP global (por padrão NÃO escreve)
gstack_vibehard install --skip-deps    # pula bun/Rust/Chromium pesados
```
**Preflight-first:** antes de qualquer escrita global, o `install` mostra o impacto por categoria e pede confirmação (em modo não-interativo exige `--yes`/`--global`). **MCP global é opt-in** (`--global-mcp`). Registra os **hooks reais** (Claude `settings.json`, Cursor `hooks.json`, OpenCode plugins), copia agentes/skills e escreve orientação instrucional para os harnesses sem hooks API. Idempotente e não-destrutivo (backup `.bak` + manifest). Auditar/reverter: `gstack_vibehard doctor --impact` · `doctor --install-integrity` · `uninstall --dry-run`/`--resolve-drift`.

> **Honestidade de scripts:** `npm run syntaxcheck` (alias `typecheck`) faz checagem de **sintaxe ESM** via `node --check` — não é typecheck TypeScript. O nome `syntaxcheck` reflete o que realmente roda.

### `enable` / `disable` / `status` — ativar o gstack num projeto existente (opcional)
A infra é instalada **globalmente**, mas as regras gstack só **agem em projetos com `.gstack/`**. Por isso: **projeto novo** (`create`) já nasce **ativo**; **projeto em andamento** fica **intocado** até você ativar.
```bash
cd meu-projeto-em-andamento
gstack_vibehard enable     # ativa o gstack AQUI (QG, design-system, chronicle passam a agir)
gstack_vibehard status     # ATIVO / DESATIVADO / INATIVO neste projeto
gstack_vibehard disable    # desativa preservando dados (renomeia .gstack/ → .gstack-disabled/)
```
`disable` **não apaga nada** — `enable` depois reativa preservando contexto/planos. O que você não ativar continua intocado (só o bloqueio de comando destrutivo permanece global, como rede de segurança). Ao ativar, o gstack **detecta o arquétipo** do projeto (lib/CLI/web/service/...) e grava `.gstack/profile.json` em **modo observe** — os gates passam a **reportar, nunca bloquear**.

### `publish-guard` — check determinístico pré-publish (de graça em tokens)
Automatiza o ritual de release, sem LLM e sem rede obrigatória:
```bash
gstack_vibehard publish-guard          # tree limpa? versão bumpada? CHANGELOG? tag? CI verde?
gstack_vibehard publish-guard --json   # saída-máquina
gstack_vibehard publish-guard --no-ci  # pula a checagem de CI (gh)
```
Sai com código ≠0 se houver pendência obrigatória (working tree suja, versão não bumpada, CHANGELOG sem entrada). Complementa o `verify`, que para **lib/CLI** já roda `publish-guard` e `diff-hygiene` (varredura dos arquivos mudados) como gates **advisory**.

### `create <nome>` — criar um workspace runtime
```bash
gstack_vibehard create meu-app                                   # template padrão (fullstack-monorepo)
gstack_vibehard create meu-app --lite                            # sem Casdoor/Atomic/ECC2 (máquinas leves)
gstack_vibehard create meu-app --template saas-auth-stripe       # vertical específico
```
Templates: `fullstack-monorepo` (Express/Fastify/Hono + React) · `saas-auth-stripe` (Next.js + Supabase + Stripe) · `mobile-backend` (Expo + tRPC + PostgreSQL) · `ai-agent-platform` (LangGraph + ChromaDB + FastAPI).
Gera `.gstack/` (app/services/ports/secrets + **integrations.json**), Dockerfile por stack, `scripts/dev.sh`, regras por harness e o registry de integrações.

### `init <nome>` — estrutura de projeto simples
```bash
gstack_vibehard init meu-projeto
```
Copia o template `fullstack-monorepo` para um diretório novo (mais simples que o `create`, sem o boot de 5 fases).

### `tools` — integrações híbridas (Composio + Printing Press)
```bash
gstack_vibehard tools suggested            # ferramentas sugeridas para este projeto
gstack_vibehard tools list                 # catálogo Printing Press (com rede)
gstack_vibehard tools search stripe        # buscar no catálogo
gstack_vibehard tools enable-printing-press # habilita discovery neste projeto
gstack_vibehard tools install stripe       # instala (opt-in; instala Go sob demanda se faltar)
gstack_vibehard tools installed            # lista instaladas
gstack_vibehard tools uninstall stripe     # remove e limpa o registry
gstack_vibehard tools mcp enable stripe    # registra pp-stripe no .mcp.json DO PROJETO
gstack_vibehard tools mcp disable stripe   # remove o pp-stripe
gstack_vibehard tools mcp list             # lista MCPs pp-* do projeto
gstack_vibehard tools doctor               # valida binário/auth/MCP das instaladas
```
**Roteamento:** leitura de alta frequência → Printing Press (CLI local + SQLite); escrita/OAuth → Composio (nuvem). Tudo **opt-in e project-scoped** — nada toca sua config global.

### `monitor` — TUI em tempo real
```bash
gstack_vibehard monitor
```
Painel: harnesses ativos, views do Atomic VCS, token budget, bloqueios de Quality Gate e ROI do último sprint. `Ctrl+C` para sair.

### `sprint --save` — salvar memória da sessão
```bash
gstack_vibehard sprint --save
```
Persiste decisões e atualiza memórias (graphify + gbrain + chronicle).

### `list` — ver o que está instalado
```bash
gstack_vibehard list
```
Lista componentes por harness, skills, scripts e o manifest de instalação.

### `uninstall` — remover do ambiente
```bash
gstack_vibehard uninstall          # interativo (pede confirmação)
gstack_vibehard uninstall --yes    # não-interativo (CI/scripts)
```
Remove só o que o instalador criou (restaura backups `.bak`, desregistra hooks do `settings.json`/`hooks.json`, limpa chaves gstack do `config.toml` do Codex). **Preserva** seu vault, `.mcp.json` e deps globais.

---

O Quality Gate roda via hooks no final de cada sessão:
- **Claude Code/Cursor/OpenCode**: hooks registrados e executados pelo harness (bloqueiam comandos perigosos; registram memória no Stop)
- **Codex/Gemini CLI/Windsurf/Kiro/Zed**: modo Best-Effort (instrucional — sem hooks API)

> **O Stop é leve por padrão** (registra memória e nada mais — não atrasa cada resposta). Trabalho pesado é **opt-in** por env var:
> | Env var | Liga |
> |---|---|
> | `GSTACK_STOP_AUDIT=on` | Roda `fallow audit` + QG no Stop |
> | `GSTACK_TEST_GATE=on` / `=block` | Roda a suíte de testes (reporta / bloqueia) |
> | `GSTACK_AUTO_PR=1` | Cria branch + commit local de docs em sessões bem-sucedidas |
> | `GSTACK_AUTO_ISSUE=1` | Abre issue automática em falhas |
> | `GSTACK_AUTOSAVE_MAIN=1` | Auto-commit do repo principal (worktrees efêmeros já são salvos) |
- **Código migrado**: `src/` sem `execSync(string)`; operações de subprocesso usam `execFileSync`/`execFile` com argumentos em array
- **Typecheck complementar**: `qg.py` roda `npx tsc --noEmit` apos Fallow nos projetos com `tsconfig.json`

### 🧪 Test Gate (entrega validada — paridade Replit Agent)

No final de cada sessão, o Stop hook pode **detectar e rodar a suíte de testes do projeto** (npm test, pytest, `cargo test`, `go test`) e registrar o resultado no chronicle. É **opt-in** (o Stop dispara a cada turno — rodar a suíte sempre tornaria cada turno lento):
- **Default (desligado)**: o gate é pulado.
- **`GSTACK_TEST_GATE=on`**: roda e reporta (não bloqueia) no `systemMessage`.
- **`GSTACK_TEST_GATE=block`**: se os testes falham, devolve o controle ao agente para corrigir antes de finalizar (respeita `stop_hook_active` para evitar loop).
- Timeout via `GSTACK_TEST_TIMEOUT` (default 300s).

## 🔌 Integrações Híbridas (Composio + Printing Press)

Arquitetura de **dupla via** para ferramentas externas — opt-in, project-scoped, não-destrutiva:

| Via | Para quê |
|---|---|
| **Composio** (nuvem, `@composio/mcp`) | Auth OAuth + **ações de escrita** (criar ticket, deploy) nos apps padrão |
| **Printing Press** (local, CLI Go + SQLite) | **Leitura** de alta frequência (SQL offline) + cauda-longa sem API. ~60–80% menos tokens |

Todo projeto criado ganha `.gstack/integrations.json` com ferramentas **sugeridas** por template (nada é instalado). Comandos:

```bash
gstack_vibehard tools suggested          # sugeridas para este projeto
gstack_vibehard tools list               # catálogo Printing Press
gstack_vibehard tools search stripe      # buscar
gstack_vibehard tools install stripe     # opt-in (requer Go; verifica o binário)
gstack_vibehard tools mcp enable stripe  # registra pp-stripe no .mcp.json do projeto
gstack_vibehard tools doctor             # valida binário/auth/MCP das instaladas
```

Roteamento padrão: **leitura → Printing Press (local, barato)**, **escrita → Composio (nuvem)**.

## 🔄 Workflows Agênticos (Context Docs + Loop Budget + Graph Runner)

Governança determinística para tarefas agênticas — **o LLM decide dentro do nó, o código decide as arestas**. O gstack **não faz model calls**: delega ao OpenCode (seu modelo/free tier) e verifica de forma determinística (testes/Fallow).

```bash
# Context docs + Document Graph local (GraphRAG offline, sem LLM, economia de tokens)
gstack_vibehard context init               # cria .gstack/context.json + docs/{adr,prd,plans,research}
gstack_vibehard context index              # indexa docs em SQLite/FTS5 (.gstack/context/context.db)
gstack_vibehard context search "casdoor"   # busca FTS5 offline → path/heading/trecho/score
gstack_vibehard context related Casdoor    # entidades e relações (mentions/links_to/tagged_as)
gstack_vibehard context explain "auth"     # docs + entidades de um tópico
gstack_vibehard context status --db        # documents/chunks/entities/edges + FTS status
gstack_vibehard context obsidian set <pasta> # indexar pasta Obsidian (read-only)
# Obsidian detectado por padrão: na instalação/`context init` você ESCOLHE um vault
# (detectado automaticamente) ou "pula". Nada é lido até você escolher.
# Graphify: se graphify-out/graph.json existir, `related` mostra implemented_in/depends_on
gstack_vibehard a2a card                   # Agent Card A2A (JSON, offline, sem servidor)

# Delegar uma tarefa ao OpenCode (opt-in, confirmação)
gstack_vibehard delegate opencode --task "refatorar auth" --yes

# Rodar um workflow determinístico (worker → verifier → retry/handoff, com caps)
gstack_vibehard workflow run --task "implementar X" --max-iterations 3
gstack_vibehard workflow runs               # listar runs
gstack_vibehard workflow inspect <runId>    # ver journal (eventos, retries, hits)
```

**Guardrails** (em `.gstack/loop-budget.json`): `maxIterations`, `maxConsecutiveSameFailure` (circuit breaker → human handoff), `maxWallTimeSeconds`. Delegação **opt-in** (`enabled:false`, `requiresUserApproval:true`). Journal por run permite **replay** (nós concluídos são pulados — não refaz trabalho). Nunca persiste secrets nem transcripts completos.

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
- **GitOps Seguro:** `git push` apenas com consentimento explícito; body de issue/PR passa por **redaction** antes do `gh` (aborta + registra evento com fingerprint se houver segredo)
- **Worktrees não copiam segredos:** o gstack usa `git worktree add` puro (um `.env` no `.gitignore` **não** vai pra worktree) e o autosave usa **staging por allowlist** (exclui `.env`/build/binários). O único risco real é ter `.env` **rastreado** no git — `delegate` (com ou sem `--worktree`) **BLOQUEIA** se detectar isso (libere explicitamente com `--allow-tracked-secrets`). O commit delegado também usa **allowlist** (sem `git add -A`) e roda `diff-hygiene` antes de marcar o branch como revisável (`needs_review` se houver segredo).
- **Interceptação real (opt-in):** o Output Guard é auditoria **pós-resposta** (honesto: nenhum harness permite interceptar o render via CLI). Para redaction **pré-output em trânsito**, use `gstack_vibehard proxy` e aponte o harness (`ANTHROPIC_BASE_URL`) para ele — funciona onde o harness aceita base-URL custom; não é universal.

---

## 🛟 Troubleshooting — OpenCode (`opencode.json` vs `opencode.jsonc`)

O gstack integra com o OpenCode **por diretórios auto-carregados** (`~/.config/opencode/plugins/` e skills em `~/.agents/skills/`), conforme a [doc oficial](https://opencode.ai/docs/config) — **sem precisar escrever config**. Por segurança:

- Se você tem **só `opencode.jsonc`** (ex.: Desktop com plugin OAuth), o gstack **nunca cria** `opencode.json` (evita sombrear seus providers/OAuth).
- Se existir **`opencode.json` e `opencode.jsonc` juntos**, o gstack **não altera nenhum** e o `doctor` alerta.

Se suspeitar de conflito, com o **OpenCode fechado**, faça backup manual (nunca apague):

```powershell
Move-Item "$env:USERPROFILE\.config\opencode\opencode.json" `
  "$env:USERPROFILE\.config\opencode\opencode.json.gstack-bak"
```

Depois reabra o OpenCode e verifique provider/OAuth. Rode `gstack_vibehard doctor` para o diagnóstico.

---

## 📝 Licença MIT
