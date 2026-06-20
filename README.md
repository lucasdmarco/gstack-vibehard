# 🚀 gstack-vibehard

[![Test](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml/badge.svg)](https://github.com/lucasdmarco/gstack-vibehard/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/@gstack-vibehard/installer)](https://www.npmjs.com/package/@gstack-vibehard/installer)

**O que é:** um **control plane e instalador cross-harness** que roda 100% na sua máquina e dá aos seus agentes de IA (Claude Code, Cursor, OpenCode, Codex) **gates de segurança/qualidade, memória entre sessões e criação de projetos** — sem escrita global escondida e com rollback.

> O comando do CLI é **`gstack_vibehard`** (com underscore). O pacote npm é `@gstack-vibehard/installer` (com hífen).

---

## 🤔 O que é isso? (em português de gente)

Você usa **Claude**, **Cursor**, **OpenCode** ou **Codex** para programar? Já aconteceu do agente:

- ❌ Tentar apagar arquivos com `rm -rf`?
- ❌ Commitar um `.env` com segredo sem você perceber?
- ❌ Esquecer o que vocês conversaram na sessão anterior?
- ❌ Dizer "pronto!" sem rodar os testes?

O **gstack-vibehard** é como um **"capacete de segurança"** para esses agentes. Ele **não substitui** o Claude/Cursor — ele **protege, organiza e dá memória** a eles, rodando no **seu computador**. Integrações de nuvem (MCP, Composio) são sempre **opt-in**: nada sai da sua máquina sem você ligar.

> Honestidade: o gstack **não elimina alucinação** — ele adiciona *gates* (bloqueios, verificação, memória) para que um erro do agente não vire um estrago.

---

## ✨ O que ele faz por você?

| Problema do dia a dia | Como o gstack-vibehard resolve |
|---|---|
| "O bot tentou `rm -rf`!" | 🔒 **Bloqueio de comandos destrutivos** (hook `pre_tool_use`) — global, como rede de segurança |
| "O bot esqueceu a sessão de ontem" | 🧠 **Memória persistente** (chronicle) — cada sessão é salva e recuperada no início da próxima |
| "Será que vazou minha chave de API?" | 🛡️ **Scanner de segredo no diff** (`diff-hygiene`) + delegação **bloqueia** `.env` rastreado antes de mandar pra outra IA |
| "O bot disse que passou, mas quebrou" | 🧪 **Test gate** — roda a suíte no fim da sessão (**opt-in**: `GSTACK_TEST_GATE=on`/`block`) |
| "Quero começar um projeto do zero" | 📦 **Templates** (fullstack, SaaS, mobile, AI) em 1 comando — **lite por padrão** (só `./app`, nada global) |
| "Não sei se meu ambiente está certo" | 🩺 **`doctor`** — diagnostica Node, Python, harnesses, deps e integrações (`doctor --json` p/ automação) |
| "Será que isso vai mexer nos meus outros projetos?" | 👀 **`install --audit-only`** — mostra o impacto global **sem escrever nada** |

---

## 🎯 Para quem é?

- ✅ **Devs solo** que querem governança de equipe (regras, testes, memória) sem ter equipe.
- ✅ **Quem usa IA pra codar** e quer dormir tranquilo sabendo que o agente não quebra tudo.
- ✅ **Times técnicos** que querem padrão sem travar a criatividade.
- ✅ **Power users** que querem JSON estável, modos estritos e gates de release para automação.

---

## ⚡ Começar sem medo (5 minutos)

```bash
# 1) Veja o que faz — NÃO instala nem escreve nada:
npx @gstack-vibehard/installer --help

# 2) Crie e rode um app (LITE por padrão: escreve só ./meu-app, nada global):
npx @gstack-vibehard/installer create meu-app
cd meu-app && npm install && npm run dev

# 3) (opcional) Diagnostique o ambiente (read-only):
npx @gstack-vibehard/installer doctor

# 4) (opcional) Veja o impacto de integrar aos seus harnesses, SEM escrever:
npx @gstack-vibehard/installer install --audit-only
```

- **Primeiro comando seguro:** `gstack_vibehard` sem argumentos (ou `--help`) **só mostra ajuda** — nunca instala nem escreve.
- **Criar é leve:** `create meu-app` é **lite** por padrão (só `./meu-app`); use `--full` para o stack completo (Casdoor/Atomic/ECC2). Veja o plano antes com `create meu-app --dry-run --json`.
- **Ativar num projeto existente (opt-in):** entre na pasta e rode `gstack_vibehard enable` (`disable` desativa preservando dados; `status` mostra o estado).
- **O que pode escrever globalmente:** só o `install` toca o ambiente — e é **preflight-first** (mostra o impacto por categoria e pede confirmação). **MCP global** (`--global-mcp`) e **downloads remotos** (`--allow-remote-downloads`) são **opt-in**. Audite com `install --audit-only` e `doctor --impact`.
- **Como desfazer:** `gstack_vibehard uninstall --dry-run` (plano) e `uninstall` (rollback via manifest; preserva o que você editou — `--resolve-drift` para forçar).

---

## 🛡️ Segurança que dá pra ver

- **100% local** — seus dados ficam no seu PC; integrações de nuvem (MCP/Composio) são **opt-in**.
- **Backups automáticos** — tudo que o gstack altera ganha `.bak` + entrada no manifest (rollback rastreável).
- **Sem `git add -A` automático** — o commit delegado usa **allowlist** (exclui `.env`/build/binários) e respeita os hooks de pre-commit.
- **Bloqueio destrutivo global** — `rm -rf /`, `chmod 777 /`, pipe para shell remoto, etc. são barrados mesmo fora de projetos gstack.
- **Output Guard com role** (`GSTACK_USER_ROLE` = viewer/developer/admin, default `viewer`): redige saída sensível **pós-resposta** conforme o papel. Honesto: é auditoria *depois* da resposta (nenhum CLI intercepta o render do harness); para redação **em trânsito**, há o `gstack_vibehard proxy` (opt-in, onde o harness aceita base-URL custom).
- **Sem execução remota por padrão** — instaladores remotos (Bun/uv/Rust/Atomic) só rodam com `--allow-remote-downloads` **e** origem na allowlist HTTPS.

---

## 🔌 Funciona com seu assistente (matriz honesta)

| Nível | Harness | O que você ganha |
|---|---|---|
| **Hooks reais** (gates automáticos) | **Claude Code** | Hooks em `settings.json` (PreToolUse/Stop/SessionStart/UserPromptSubmit) + agentes + regras |
| **Hooks reais** | **Cursor** | Hooks em `~/.cursor/hooks.json` + agentes + rules `.mdc` |
| **Hooks reais** | **OpenCode** | Plugins JS **manifest-owned** (`tool.execute.before`, `session.created`) + skills · kill switch `GSTACK_OPENCODE_DISABLE=1` |
| **Instrucional** (best-effort) | Codex, Gemini, Windsurf, Kiro, Copilot CLI, Droid, Kilo, Kimi | Arquivo de orientação no convention do harness (`AGENTS.md`/etc.) — o agente é orientado a rodar os gates, **sem bloqueio por API** |
| **Detecção** | Zed, VS Code | Reconhecidos pelo `doctor`/instalador; integração instrucional por-repo |

> Os harnesses instrucionais **não têm API de hooks** — o gstack não consegue *impor* gates neles (limite do harness, reportado honestamente).

---

## 🏗️ Templates

```bash
gstack_vibehard create meu-app                              # fullstack-monorepo (padrão), lite
gstack_vibehard create meu-app --full                      # stack completo (Casdoor/Atomic/ECC2)
gstack_vibehard create meu-app --template saas-auth-stripe # vertical específico
```

| Template | Para que serve |
|---|---|
| `fullstack-monorepo` | App web completo (Express/Fastify/Hono + React) — template físico, com README + `.env.example` |
| `saas-auth-stripe` | SaaS com login + pagamentos (Next.js + Supabase + Stripe) — scaffold |
| `mobile-backend` | App mobile (Expo + tRPC + PostgreSQL) — scaffold |
| `ai-agent-platform` | Plataforma de agentes (LangGraph + ChromaDB + FastAPI) — scaffold |

---

## 🧠 Como funciona na prática

```
Você: "Bot, refatore o sistema de login"
Bot:  (tenta rodar `rm -rf src/auth`)
gstack: ⛔ pre_tool_use — comando destrutivo bloqueado
Bot:  (termina a tarefa e tenta delegar com um .env rastreado no git)
gstack: ⛔ delegate — .env rastreado, NÃO deleguei (segredo iria pra outra IA)
Bot:  (commit delegado na worktree)
gstack: 🔎 diff-hygiene → sem segredo no diff · 💾 memória salva (chronicle)
```

---

## 📊 Comandos do dia a dia

```bash
gstack_vibehard --help            # ajuda (curta) · `help advanced` p/ comandos avançados
gstack_vibehard doctor            # diagnóstico do ambiente (--json p/ automação)
gstack_vibehard create app        # novo projeto (lite por padrão)
gstack_vibehard enable            # ativar o gstack neste projeto
gstack_vibehard verify --quick    # gates rápidos (~8s, com cache)
gstack_vibehard publish-guard     # checklist determinístico antes de publicar
gstack_vibehard install --audit-only   # ver impacto global SEM escrever
gstack_vibehard uninstall --dry-run    # plano de remoção (rollback via manifest)
```

---

## 📖 Modo de Uso — referência detalhada

### Passo 0 — Instalar o CLI

```bash
npm install -g @gstack-vibehard/installer
```
**Windows:** `launchers/windows/install.bat` · **macOS:** `brew install --formula launchers/macos/gstack_vibehard.rb`. Confirme: `gstack_vibehard --version`.

### `doctor` — diagnosticar o ambiente
```bash
gstack_vibehard doctor                      # humano
gstack_vibehard doctor --json [--strict]    # JSON puro (strict → exit≠0 se check obrigatório falha)
gstack_vibehard doctor --impact             # componentes globais ativos (o que afeta qualquer projeto)
gstack_vibehard doctor --install-integrity  # manifest/backups/hashes — uninstall seguro?
```
Mostra Node/Python, harnesses e nível de integração, hooks/skills instalados, deps globais, integrações e Playwright. Scans de filesystem são **EPERM-safe** (viram warning, nunca crash). **Rode primeiro.**

### `install` — configurar o ambiente (Safe Install: preflight-first)
```bash
gstack_vibehard install --audit-only [--save-report]   # PREFLIGHT read-only: lista o impacto, sem escrever
gstack_vibehard install --project-only                 # impacto global mínimo (sem deps/MCP global/vault)
gstack_vibehard install --harness claude               # instala só um harness
gstack_vibehard install                                # completo (mostra impacto e PEDE confirmação)
gstack_vibehard install --yes                          # confirma (necessário em modo não-interativo)
gstack_vibehard install --global-mcp [--mcp-server playwright]  # opt-in: MCP global (só os escolhidos)
gstack_vibehard install --allow-remote-downloads       # opt-in: permite instaladores remotos (Bun/Rust/uv)
gstack_vibehard install --skip-deps                    # pula bun/Rust/Chromium pesados
```
**Preflight-first:** antes de qualquer escrita global, mostra o impacto por categoria e pede confirmação (não-interativo exige `--yes`/`--global`). **MCP global e downloads remotos são opt-in.** Registra hooks reais (Claude `settings.json`, Cursor `hooks.json`, plugins OpenCode), copia agentes/skills e escreve orientação para harnesses sem hooks API. Idempotente e não-destrutivo (backup `.bak` + manifest). Auditar/reverter: `doctor --impact` · `doctor --install-integrity` · `uninstall --dry-run`/`--resolve-drift`.

> **Honestidade de scripts:** `npm run syntaxcheck` (alias `typecheck`) faz checagem de **sintaxe ESM** via `node --check` — não é typecheck TypeScript.

### `enable` / `disable` / `status` — ativar num projeto existente (opcional)
A infra é instalada **globalmente**, mas as regras gstack só **agem em projetos com `.gstack/`**. Projeto novo (`create`) já nasce ativo; projeto em andamento fica **intocado** até você ativar.
```bash
cd meu-projeto-em-andamento
gstack_vibehard enable     # ativa aqui (QG, design-system, chronicle passam a agir)
gstack_vibehard status     # ATIVO / DESATIVADO / INATIVO
gstack_vibehard disable    # desativa preservando dados (renomeia .gstack/ → .gstack-disabled/)
```
Ao ativar, o gstack **detecta o arquétipo** (lib/CLI/web/service/...) e grava `.gstack/profile.json` em **modo observe** — os gates **reportam, nunca bloqueiam** até você optar pelo `enforce`.

### `verify` — delivery gates por arquétipo
```bash
gstack_vibehard verify --quick [--json]   # rápido (~8s): deps/lint/diff-hygiene/QG L1 + cache
gstack_vibehard verify --profile full     # completo (deps/lint/typecheck/test/build/QG L1+L2)
gstack_vibehard verify --profile release  # full + publish-guard bloqueante
```
Reporta `qg.origin/path/version/hash` e **detecta drift** entre o QG instalado e o empacotado.

### `publish-guard` — check determinístico pré-publish
```bash
gstack_vibehard publish-guard [--json] [--no-ci]
```
Tree limpa? Versão bumpada? CHANGELOG? Tag? CI verde? Exit ≠0 se houver pendência obrigatória.

### `create` / `init` — criar projeto
```bash
gstack_vibehard create meu-app [--full] [--dry-run --json]   # workspace (lite por padrão)
gstack_vibehard init meu-projeto                             # cópia simples do fullstack-monorepo
```
`create` gera `.gstack/` (app/services/ports/secrets + `integrations.json` + `profile.json`), Dockerfile por stack, regras por harness. `--dry-run --json` mostra o impacto e **não escreve nada**.

### `tools` — integrações híbridas (Composio + Printing Press)
```bash
gstack_vibehard tools suggested            # sugeridas para este projeto
gstack_vibehard tools list                 # catálogo Printing Press
gstack_vibehard tools install stripe       # opt-in (instala Go sob demanda)
gstack_vibehard tools mcp enable stripe    # registra pp-stripe no .mcp.json DO PROJETO
gstack_vibehard tools doctor               # valida binário/auth/MCP das instaladas
```
**Roteamento:** leitura de alta frequência → Printing Press (local + SQLite); escrita/OAuth → Composio (nuvem). Tudo **opt-in e project-scoped** — nada toca sua config global.

### `monitor` · `sprint` · `list` · `uninstall`
```bash
gstack_vibehard monitor            # TUI: harnesses, token budget, QG, ROI do sprint
gstack_vibehard sprint --save      # persiste decisões + atualiza memórias
gstack_vibehard list               # componentes instalados (por harness/skills/scripts/manifest)
gstack_vibehard uninstall [--yes]  # remove só o que o instalador criou (restaura .bak; preserva vault/.mcp.json/deps)
```

---

## 🧪 Test Gate (opt-in)

No fim de cada sessão, o Stop hook é **leve por padrão** (só registra memória). Trabalho pesado é **opt-in** por env var (o Stop dispara a cada turno — rodar a suíte sempre tornaria cada turno lento):

| Env var | Liga |
|---|---|
| `GSTACK_TEST_GATE=on` / `=block` | Roda a suíte de testes (reporta / bloqueia até corrigir) |
| `GSTACK_STOP_AUDIT=on` | Roda `fallow audit` + QG no Stop |
| `GSTACK_AUTOSAVE_MAIN=1` | Auto-commit do repo principal (worktrees efêmeros já são salvos) |
| `GSTACK_USER_ROLE` | Papel do Output Guard (`viewer`/`developer`/`admin`, default `viewer`) |

---

## 🔄 Workflows Agênticos (Context Docs + Loop Budget + Graph Runner)

Governança determinística — **o LLM decide dentro do nó, o código decide as arestas**. O gstack **não faz model calls**: delega ao OpenCode (seu modelo/free tier) e verifica de forma determinística (testes/Fallow).

```bash
gstack_vibehard context init               # .gstack/context.json + docs/{adr,prd,plans,research}
gstack_vibehard context index              # indexa docs em SQLite/FTS5 (GraphRAG offline, sem LLM)
gstack_vibehard context search "casdoor"   # busca FTS5 offline
gstack_vibehard delegate opencode --task "refatorar auth" --yes   # delegação opt-in, com confirmação
gstack_vibehard workflow run --task "implementar X" --max-iterations 3
```

**Guardrails** (`.gstack/loop-budget.json`): `maxIterations`, `maxConsecutiveSameFailure` (circuit breaker → human handoff), `maxWallTimeSeconds`. Journal por run permite **replay** (nós concluídos são pulados). Nunca persiste secrets nem transcripts completos.

---

## 🧠 Arquitetura

- **Graphify:** AST caching a custo zero — IA lê topologia sem consumir API.
- **Headroom:** proxy MCP que comprime RAG/logs.
- **Fallow:** auditoria estática determinística (Rust) — usada pelo Quality Gate (`qg.py`), peer dep **opcional**; ausente, o QG pula sem bloquear.
- **Manifest + Safe Write:** toda escrita global é registrada e reversível.

---

## 🔒 Segurança (detalhe técnico)

- **Bloqueio destrutivo global** (`pre_tool_use_security.py`): `rm -rf /`, `chmod 777 /`, `--no-preserve-root`, pipe para shell remoto, etc.
- **Project Name Allowlist:** `^[a-zA-Z0-9._-]+$` — sem injeção via `$()`/backtick/`;`.
- **Sem shell execution no core:** `src/` usa `execFileSync`/`execFile` com args em array (sem `execSync(string)`).
- **GitOps seguro:** `git push` só com consentimento; body de issue/PR passa por redaction antes do `gh`.
- **Worktrees não copiam segredos:** `git worktree add` puro + autosave por allowlist. `.env` **rastreado** → `delegate` **BLOQUEIA** (libere com `--allow-tracked-secrets`). Commit delegado por allowlist (sem `git add -A`) + `diff-hygiene` antes de marcar revisável (`needs_review` se houver segredo).
- **Política de download remoto:** `src/installer/remote-policy.js` — allowlist HTTPS + opt-in (`--allow-remote-downloads`).

---

## 🛟 Troubleshooting — OpenCode (`opencode.json` vs `opencode.jsonc`)

O gstack integra ao OpenCode **por diretórios auto-carregados** (`~/.config/opencode/plugins/` + skills), conforme a [doc oficial](https://opencode.ai/docs/config) — sem escrever config. Se você tem **só `opencode.jsonc`**, o gstack **nunca cria** `opencode.json`. Se houver **os dois juntos**, o gstack não altera nenhum e o `doctor` alerta. Conflito? Com o OpenCode fechado, faça backup manual (nunca apague) e rode `gstack_vibehard doctor`.

---

## 📦 Verificação & qualidade

`npm test` (Node) · `npm run test:py` (Python) · `npm run lint` · `npm run syntaxcheck` · `npm run test:pack` (smoke do tarball npm) · `npm run test:templates` (smoke dos templates) · `GSTACK_E2E_SAFE_INSTALL=1 npm run test:e2e` (E2E em HOME descartável).

---

## 📝 Histórico & licença

Histórico de versões em **[CHANGELOG.md](CHANGELOG.md)**. Licença **MIT** — use, modifique, venda.

**Pronto para dar um capacete ao seu agente?** 👉 `npx @gstack-vibehard/installer --help`
