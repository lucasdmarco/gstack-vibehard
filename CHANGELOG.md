# Changelog - gstack-vibehard

## [2.3.0] - 2026-06-15

**Integrações híbridas — Composio (nuvem) + Printing Press (local).**

Nova arquitetura de **dupla via** para ferramentas, sem substituir o Composio existente (`@composio/mcp`, já detectado em `session_start.py`):
- **Composio (nuvem):** auth OAuth + ações de **escrita** nos apps padrão.
- **Printing Press (local):** **leitura** de alta frequência via CLI Go + SQLite e cauda-longa sem API. Roteamento padrão: leitura→local, escrita→nuvem.

Tudo **opt-in, project-scoped e não-destrutivo** — nada é instalado no bootstrap.

- **PR1 — Registry:** todo projeto criado ganha `.gstack/integrations.json` (schema dual-lane, `schemaVersion:1`) com ferramentas sugeridas por template (saas→stripe/linear/sentry; ai→github/slack/notion/sentry; mobile→revenuecat/firebase/supabase/sentry; fullstack→github/sentry/linear). Declarativo: `enabled:false`, não instala nada.
- **PR2 — `gstack_vibehard tools`** (alias `pp`): `list`/`search`/`suggested`/`enable-printing-press`. Wrapper seguro do `@mvanhorn/printing-press-library` (versão pinada, args em array, `shell:false`, query validada). Degrada gracioso sem rede; **nunca toca `.mcp.json`**.
- **PR3 — `tools install/uninstall/installed`:** opt-in. Detecta Go (o `install` upstream usa `go install`); sem Go → orienta, não instala. **Verifica o binário** (`~/go/bin`) antes de marcar `installed`. Não pede credencial, não escreve `.env`.
- **PR4 — `tools mcp enable/disable/list`:** registra MCP `pp-<tool>` no `.mcp.json` **do projeto** (merge não-destrutivo, usuário vence em colisão; disable remove só o `pp-*` do gstack).
- **PR5 — `tools doctor`** (probe progressivo por capacidade) + seção "Integrações" no `doctor` principal (status Composio + Go/Printing Press). `tools generate` (cauda-longa via HAR) é **stub honesto** — o pacote `cli-printing-press` ainda não existe no npm.
- **Segurança/rollback:** desenvolvido em branch isolado; `RETORNOGO.md` documenta a âncora de retorno (v2.2.4) e os procedimentos. +21 testes (49 Node + 24 Python), todos hermes (exec injetável, sem rede/sem instalar binários).

## [2.2.4] - 2026-06-15

**Revisao round-2: arestas restantes de "nao travar / nao destruir".**

- **[P1] Deploy nao trava mais no audit.** `run_security` (deploy) deixou de ativar o `fallow audit` pesado (60s) no Stop — o Security Gate (checks locais) ja roda separado e devolve o bloqueio na hora. Um deploy com Dockerfile invalido nao "congela" antes do veredito. (`stop.py`)
- **[P2] `create --lite` 100% honesto.** O resumo final nao imprime mais `IAM: http://localhost:8000 (admin/123)` em modo lite. (`create.js`)
- **[P2] Merge do Codex preserva hooks do usuario.** Em vez de trocar o array inteiro (`on_stop` etc.), agora ANEXA os comandos gstack preservando os do usuario, com dedupe; o uninstall remove so os comandos gstack. (`codex.js`)
- **[robustez] QG degrada gracioso sem Fallow.** `qg.py` tratava Fallow ausente/stdout vazio como bloqueio CRITICO (falso positivo, ja que Fallow e opcional). Agora PULA (pass, verdict `skipped`) com instrucao de instalacao. (`qg.py`)
- **DX:** `npm run test:py` cai para `python -m unittest` quando pytest nao esta instalado (testes sao unittest).

## [2.2.3] - 2026-06-15

**Correcoes de revisao orientada a bugs reais (6 P1 + instalacao do pytest).**

### Hooks deixam de ser intrusivos
- **Stop nao atrasa mais cada resposta.** `fallow audit` (60s) + QG legado (60s) rodavam em TODO Stop (dispara a cada turno) — ate ~2min de atraso por turno. Agora opt-in via `GSTACK_STOP_AUDIT=on` (ou automatico em deploy/qg_level). (`stop.py`)
- **Stop nao cria branch/commit sem consentimento.** `gitops_pr_create` (git checkout -b + add + commit) agora opt-in via `GSTACK_AUTO_PR=1`. (`stop.py`)
- **Auto-save nao commita mais o repo principal.** `git_worktree_autosave.py` commitava o repositorio principal a cada Stop; agora opt-in via `GSTACK_AUTOSAVE_MAIN=1`. Worktrees efemeros do Agent View seguem protegidos.

### Instalacao do Codex nao-destrutiva
- **`~/.codex/config.toml` deixou de ser sobrescrito.** Antes o install substituia o arquivo inteiro (perdia MCPs/modelos/permissoes do usuario). Agora merge via `smol-toml`: hooks gstack vencem; agent/mcp_servers o usuario vence. uninstall remove apenas as chaves gstack, preservando a config do usuario (e nao remove servidor de mesmo nome se customizado). (`codex.js`, `uninstall.js`)

### Templates verticais executaveis
- **SaaS / Mobile**: `dev:web`/`dev:api`/`dev:mobile` agora resolvem (cada app com `package.json` e scripts dev reais); o scaffold criava `apps/api/src/*` sem o diretorio (crash) — corrigido.
- **AI**: declara `langchain-openai` e corrige o typo `ChatOpenAi` -> `ChatOpenAI`.
- **Dockerfile por stack**: AI = Python (uvicorn); demais = Node. `dev.sh` com comando dev correto por template.
- **fullstack-monorepo CI**: `db:push:test` sem `cross-env ... cd` (builtin de shell); `typecheck` = `turbo typecheck` (era `turbo lint`).

### Modo lite honesto + pytest
- `create --lite` nao escreve config Casdoor nem anuncia IAM `localhost:8000` (servico offline em lite).
- Instalador instala `pytest` (hooks Python, QG e Test Gate dependem dele); `doctor` reporta.

### Testes
- +10 testes (Stop nao-intrusivo, merge/strip do Codex, contrato dos verticais, lite). 28 Node + 23 Python.

## [2.2.2] - 2026-06-15

### Correcoes (revisao do projeto inteiro)
- **Test Gate agora e opt-in.** Antes rodava a suite de testes do projeto em TODO Stop hook (que dispara a cada turno) — tornaria cada turno lento (ate 300s). Agora desligado por padrao; habilite com `GSTACK_TEST_GATE=on` (reporta) ou `=block` (bloqueia). (`hooks/hooks/stop.py`)
- **uninstall limpa a fonte canonica de hooks** `~/.gstack/hooks` (antes ficava orfa). (`src/installer/uninstall.js`)
- **uninstall desregistra os hooks** do `~/.claude/settings.json` e `~/.cursor/hooks.json` — sem isso, apos desinstalar o harness apontava para `.py` deletados e falhava em todo turno. Preserva hooks do usuario; remove eventos que ficavam vazios. Novo teste de regressao.

## [2.2.1] - 2026-06-15

### Documentacao
- README sincronizado com o estado do release: novidades v2.2.0 completas (Test Gate, novos detectores), historico v2.1.9 e contagem de testes corrigida (19 Node + 21 Python). Patch docs-only para alinhar a pagina do npm com o repositorio.

## [2.2.0] - 2026-06-15

**Hooks Reais Cross-Harness — a alma do produto funcionando de verdade.**

### Sprint 6 — Registro real de hooks
- **Claude Code**: `registerClaudeHooks` escreve `settings.json` no formato OFICIAL (`hooks.<Evento>[].hooks[]`) para PreToolUse/Stop/SessionStart/UserPromptSubmit. Idempotente, preserva hooks do usuario. Antes os hooks eram so copiados e nunca executados.
- **Cursor** (`src/harness/cursor.js`): `registerCursorHooks` em `~/.cursor/hooks.json` (formato `version: 1` — beforeShellExecution/preToolUse/stop/sessionStart).
- **OpenCode**: merge nao-destrutivo do `opencode.json` (antes sobrescrevia a config do usuario).
- **Camada de saida por harness** (`_harness.py`): `emit_permission_decision` responde `hookSpecificOutput` (Claude) ou `permission` (Cursor) conforme o payload; cwd via `workspace_roots`.
- **create.js**: `writeRealHarnessBridge` usa o formato real (chave ficticia `lifecycleHooks` removida) + `.cursor/hooks.json` por projeto.
- Fonte canonica de hooks em `~/.gstack/hooks/`; mensagens honestas para harnesses instrucionais.

### Sprint 7 — Test Gate (paridade Replit Agent)
- O Stop hook detecta e roda a suite de testes do projeto (npm test/pytest/cargo/go) com timeout. Default reporta; `GSTACK_TEST_GATE=block` devolve o controle ao agente para corrigir (respeita `stop_hook_active`); `=off` desativa.

### Sprint 8 — Cobertura de harnesses
- Novos detectores: GitHub Copilot CLI (`~/.copilot`/`COPILOT_HOME`), Factory Droid (`~/.factory`), Kilo Code CLI (`~/.config/kilo`), Kimi CLI (`~/.kimi`), VS Code (User dir por OS) — paths confirmados na doc oficial.
- Integracao instrucional real (`instructional.js`): escreve orientacao de QG/Test Gate/memoria/economia de tokens no convention de cada harness (AGENTS.md/GEMINI.md/global_rules.md/steering). Idempotente, preserva conteudo do usuario.
- `doctor` lista todos os harnesses detectados com nivel (hooks reais / instrucional / deteccao).

### Sprint 9 — Refactor CRAP com cobertura
- `deps.js` (novo, testavel): `findWorkingBinary`/`getUvCandidates`/`getBunCandidates`. `installDeps()` cc 47→37; `install()` cc 50→42 (vault/relatorio extraidos). Comportamento preservado.

### Matriz de suporte (honesta)
- **Hooks reais**: Claude Code, Cursor, OpenCode.
- **Instrucional**: Codex, Gemini, Windsurf, Kiro, Copilot CLI, Droid, KiloCLI, Kimi.
- **Deteccao**: Zed, VS Code.

### Testes & CI
- 19 testes Node + 21 Python (era 8+13 na v2.1.9). CI em matriz 3 SOs.

## [2.1.9] - 2026-06-09

### Correcoes Criticas de Execucao

- **Windows: rustup-init quebrado** — `\r` em template literal corrompia o caminho `$env:TEMP\rustup-init.exe` (virava carriage return). Download agora via `curl.exe` com argumentos em array (`src/installer/install.js`).
- **Windows: todos os downloads do `create` falhavam** — `param($u,$o)` via `powershell -Command` nunca recebia os argumentos; `-u`/`-o` vazavam para o `Invoke-RestMethod`. Substituido por `curl.exe` (`src/cli/create.js`).
- **Stop hook falhava toda sessao sem `openhands`** — sandbox agora e opt-in (`GSTACK_SANDBOX=1` ou flag `sandbox`); ausencia do CLI so falha quando o sandbox foi habilitado (`hooks/hooks/stop.py`).
- **`stop.py`: `gitignore_has_dotenv` nao existia** — validador `gitignore_env` do Security Gate sempre caia em erro. Funcao implementada.
- **`stop.py`: crash `chronicle_dir / str`** — funcao usada como Path; corrigido para `chronicle_dir_path`.
- **Design system mandate era codigo morto** — `pre_tool_use_security.py` lia `tool_input.command`, mas Write/Edit enviam `file_path`. Corrigido; mandato agora restrito a projetos gstack (`.gstack/` presente).
- **MCP do Claude Code em local errado** — `mcpServers` era escrito em `~/.claude/settings.json` (ignorado pelo Claude Code). Agora merge em `~/.claude.json`, preservando estado e configs do usuario (`src/harness/claude.js`).

### CI e Testes

- Workflow disparava apenas em `main`; o branch do repo e `master` — CI nunca rodou. Corrigido + jobs de testes Node e pytest adicionados.
- `npm test` rodava `doctor` em vez dos testes. Agora roda `node --test "tests/**/*.test.js"`.
- Testes JS restaurados: seam de injecao `exec(file, args, opts)` reintroduzido em `agent-distribution.js` (perdido no refactor execFileSync da v2.1.6) — testes nao fazem mais chamadas reais de `npx`.
- Testes Python renomeados `*.test.py` → `test_*.py` (pytest nunca os coletava).
- Fonte de agentes do OpenCode corrigida para `cursor` (formato AGENTS.md + rules/*.mdc) — eliminava warning de fonte ausente em toda instalacao.

### Novas Funcionalidades

- `gstack_vibehard uninstall` implementado — remove somente o que o instalador criou, restaura backups `.gstack_vibehard.bak`, exige `--yes` em modo nao-interativo. Preserva vault e deps globais.
- `gstack_vibehard list` implementado — componentes, skills, scripts e manifest.
- `gstack_vibehard install --skip-deps` (ou `GSTACK_SKIP_DEPS=1`) — pula instalacao de deps globais pesadas (bun, Rust, Chromium).
- `qg.py` agora reporta findings bloqueantes (nao-auto-fixaveis) com titulos sintetizados para metricas CRAP — antes o agente recebia `pass: false` com `issues: []` sem explicacao.

### Consistencia e Qualidade

- Hooks Python instalados apenas nos harnesses selecionados (antes: sempre em `~/.codex/hooks`).
- `check.js`: deteccao "ja instalado" do Claude usa o marcador definitivo (`ultracode.md`) em vez de `~/.claude/mcp.json` (nunca escrito).
- `deepMerge` nao muta mais o array do objeto de entrada.
- `doctor`: secao duplicada de ferramentas globais removida.
- `runCLI` com try/catch — erros viram mensagem amigavel (stack com `GSTACK_DEBUG=1`).
- `bundledDependencies` orfao removido do package.json; peers marcados como opcionais.
- Escape bash-style em comando PowerShell eliminado (download via argumentos em array).

### Debito Tecnico Conhecido (documentado, nao bloqueante)

- Fallow aponta complexidade CRAP alta em funcoes pre-existentes (`install()` cc 49, `installDeps()` cc 47, `doctor()` cc 30, `createProject()` cc 25). Refatoracao planejada para quando houver cobertura de testes dessas rotas.
- **Parcialmente pago na v2.2.0** (Sprint 9): helpers de resolucao de binario extraidos para `deps.js` (testavel, exec injetavel) — `installDeps()` 47→37; vault/relatorio extraidos de `install()` 50→42. `createProject()` e o restante permanecem como debito, a reduzir com cobertura end-to-end das rotas de scaffold.

## [2.0.1] - 2026-06-08

### Novas Funcionalidades

- Adicionado `gstack_vibehard create <nome-do-app>` para gerar um GStack Workspace Runtime omniharness em uma etapa.
- O novo scaffold gera `.gstack/app.json`, `.gstack/services.json`, `.gstack/secrets.schema.json`, `.mcp.json`, `Dockerfile`, `.dockerignore`, `scripts/dev.sh`, `AGENTS.md` e regras locais para Cursor, Windsurf e Cline.
- Scripts locais `workspace_manager.py`, `deep_research.py` e `team_builder.py` agora sao copiados para o app criado.
- Pos-instalacao de AgentMemory e Graphify roda em modo best-effort: falhas viram warnings e nao quebram o scaffold principal.

### Qualidade

- Adicionado teste de contrato para o comando `create`, cobrindo estrutura runtime, MCP e falhas nao bloqueantes de pos-instalacao.

## [2.0.0] - 2026-06-08

**A Era da Orquestracao e Memoria de Custo Zero**

A versao 2.0.0 e um salto arquitetural. O `gstack-vibehard` foi refatorado de um instalador de templates para uma **Plataforma de LLMOps Local**, integrando motores de codigo aberto sem quebrar a compatibilidade com a `v0.7.5`.

### Novas Funcionalidades (Arquitetura)

- **Instalador Cross-Harness Universal:** espalha agentes e ganchos nativamente para `Claude Code`, `Codex CLI`, `Cursor` e `OpenCode`.
- **Fabrica de Agentes:** adicionadas as pastas `core/` e `knowledge/`. O comando `npm run build:agents` funde esses arquivos e gera 21 especialistas para Claude, Codex e Cursor/OpenCode.
- **Orquestracao de Worktrees:** adicionado `workspace_manager.py` e suporte a `.worktreeinclude`. Agentes agora atuam em pastas isoladas, reduzindo race conditions entre multiplas LLMs.
- **Deep Research Nativo:** adicionado `deep_research.py`, que gera dossies de missao para pesquisa via Playwright MCP, Context7 e Headroom.
- **Fabrica de Times:** adicionado `team_builder.py` para invocar esquadroes como `pipeline`, `fan-out` e `producer-reviewer`.

### Qualidade e Governanca

- **Fallow no Quality Gate:** `qg.py` agora roda `npx fallow audit --format json`, fornecendo analise estatica deterministica.
- **Sandboxing Docker:** `stop.py` inclui isolamento de testes em Docker efemero quando `GSTACK_SANDBOX_TEST=1`.
- **Identidade e Delegacao RAG:** `session_start.py` injeta contexto para Permit.io, Composio e LiteLLM.
- **Cost Routing Local:** suporte a LiteLLM para roteamento de modelos e fallback.

### Memoria e Performance

- **Auto-Wiring Graphify + AgentMemory:** o instalador configura AgentMemory e instala Git Hooks do Graphify para manter o grafo atualizado.
- **Compressao de Contexto (Headroom):** `headroom` e adicionado ao `.mcp.json` para compressao de contexto.

### UX e Qualidade de Vida

- **Audio Cues:** hooks emitem `audio-cue:success` e `audio-cue:error` para feedback assincrono.
- **Agente Deployer:** 21o agente, especializado em GitHub CLI e Vercel CLI com Quality Gate antes de publicar.

### Correcoes de Bugs (v0.7.5 -> v2.0.0)

- `session_start.py` nao quebra mais stdout JSON caso um provedor MCP local esteja inativo.
- Compatibilidade Windows melhorada com `shutil.which` para resolver binarios `.cmd`.
- `stop.py` preserva stdout JSON mesmo com audio cues, sandbox e post-sprint.
- Instalador evita falhas bloqueantes em AgentMemory, Graphify hooks e distribuicao cross-harness.
