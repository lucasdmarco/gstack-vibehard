# Changelog - gstack-vibehard

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
