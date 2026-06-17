# Changelog - gstack-vibehard

## [2.11.0] - 2026-06-17

### Segurança OpenCode — não sombrear `opencode.jsonc` (config do Desktop/OAuth)
**Bug de produção corrigido:** o `installOpenCode` escrevia `~/.config/opencode/opencode.json` incondicionalmente, podendo **sombrear o `opencode.jsonc`** do usuário (Desktop com plugin OAuth, providers, etc.).

Confirmado na **documentação oficial do OpenCode** (config/plugins/skills): plugins auto-carregam de `~/.config/opencode/plugins/` e skills de `~/.config/opencode/skills/` **e `~/.agents/skills/`** (onde o gstack já instala) — **tudo sem entrada no config**. A coexistência `.json`+`.jsonc` no mesmo diretório **não é documentada**. Logo, o gstack integra por **diretórios auto-carregados, com zero escrita de config**.

- **Novo `src/harness/opencode-config.js`:** `inspectOpenCodeConfig(home)` decide a estratégia — `json_merge` (só `.json`: merge não-destrutivo), `directory_only` (só `.jsonc` **ou** nenhum config: nunca cria `.json`), `conflict_warn_only` (ambos: não escreve nada + alerta).
- **`installOpenCode`** agora só escreve `opencode.json` no caso `json_merge`; sempre copia os plugins gstack (auto-load). Nunca edita `.jsonc` nem remove plugin OAuth.
- **`detector`** reconhece `opencode.jsonc`; **`check`** considera OpenCode integrado por plugins/skills (não exige mais `opencode.json` com a string); **`doctor`** mostra `.json`/`.jsonc`/conflito + remediação segura (backup manual, nunca delete).
- README: seção de troubleshooting. +8 testes (135 Node + 33 Python verdes).

## [2.10.0] - 2026-06-17

### Camada Replit-like — wizard `start` + Loop Engineer `task` (PR4 + PR7) — MVP completo
- **`gstack_vibehard start` (PR4):** assistente guiado para usuário leigo. Pergunta objetivo → nome → modo (mostra a copy completa **leve vs completo** e recomenda por recipe), exibe o plano e **só executa após confirmação** (cancelar salva o plano para `plan run` depois). `src/project-plan/wizard.js` é puro (UI injetável) e reusa planner + executor.
- **`gstack_vibehard task "<pedido>"` (PR7):** Loop Engineer de feature/bugfix. Gera plano usando o **Document Graph** (`context search/related` quando há índice) + **workflow determinístico** + **delegação OpenCode**. O **OpenCode NUNCA é executado sem confirmação** (step `requiresConfirmation`); plano persistido em `.gstack/tasks/<id>/`. `task status/diff/accept/reject` são honestos sobre o motor de execução ainda não existir.
- Fecha o MVP da experiência guiada (PRs 1–5 e 7; PR6 já coberto por `pendingFeature`; PR8 dashboard adiado). +9 testes (127 Node + 33 Python verdes).

## [2.9.0] - 2026-06-17

### Camada Replit-like — executor de planos (PR5)
Agora o plano **executa de verdade**, com execução segura:
- **`src/project-plan/executor.js` + `journal.js` + `state.js`:** roda os passos reais em ordem, grava `.gstack/plans/<id>/journal.jsonl` (só **resumo** — nunca output bruto/secrets) e `status.json` por passo. **Para no primeiro erro** de passo obrigatório (não esconde falha); passo opcional que falha não derruba o plano; **retomável** (passos concluídos viram `journal_hit` e não re-executam); `pendingFeature` é pulado.
- **`plan run <id>` / `plan status <id>` / `plan explain <id>`:** `run` mostra o plano e **pede confirmação** antes de executar (sem TTY exige `--yes`; recusa execução silenciosa); `--with-optional` habilita passos opt-in; `explain` diz **por que** cada passo existe; `--json` puro em todos.
- Runner win32-aware (comandos `gstack_vibehard …` via `cmd.exe` no Windows). +9 testes (118 Node + 33 Python verdes).

## [2.8.0] - 2026-06-17

### Camada Replit-like — fundação Project Plan + comando `plan` (PRs 1–3)
Primeira fatia da experiência guiada: o usuário descreve o objetivo e o gstack gera um **plano determinístico** (sem LLM) com **comandos reais**, modo leve/completo e integrações sugeridas.
- **`src/project-plan/` (PR1+PR2):** `schema.js` (formato/validação de plano — bloqueia passos destrutivos e passos `pendingFeature` com comando), `modes.js` (copy honesta de **leve vs completo**: includes/excludes/bestFor/deps/tradeoffs), `recipes.js` (7 recipes MVP, **todas mapeadas para os 4 templates reais** e integrações reais de `SUGGESTIONS_BY_TEMPLATE`), `classifier.js` (classificação por keywords, sem LLM) e `planner.js` (expande step-ids em comandos reais; `runtime:start` vira `pendingFeature`, **nunca um comando fictício**).
- **`gstack_vibehard plan "<objetivo>"` (PR3):** imprime o plano (passos + comandos + modo), persiste em `.gstack/plans/<id>/`, `--json` puro, `--dry-run`, `--name/--mode/--recipe`. **Não executa nada** (executor chega no próximo release; `plan run/status/explain` respondem honestamente que a execução ainda não existe).
- Princípios honrados: plano sempre mostrado antes de qualquer execução, nada destrutivo, comandos avançados intactos. +13 testes (113 Node + 33 Python verdes).

## [2.7.0] - 2026-06-16

### Hermes (NousResearch) como harness de primeira classe — fala MCP nas duas direções
- **Detecção:** o `install` agora reconhece o **Hermes CLI** (via `~/.hermes/` ou `hermes --version`).
- **Integração em 3 camadas (da mais garantida à best-effort), `src/harness/hermes.js`:**
  1. **Skills** copiadas para `~/.hermes/skills/` (filesystem — não sobrescreve skills do usuário).
  2. **Guidance instrucional** em `~/.hermes/AGENTS.md` (mesmo protocolo QG/memória/economia-de-tokens dos demais harnesses sem hooks).
  3. **Registro MCP** dos servidores do gstack (de `mcp-configs/base.mcp.json`) via `hermes mcp add <name> --command …` — **só executa se o binário `hermes` existir**, totalmente guardado (falha = skip, nunca fatal). Deixamos o **próprio Hermes** persistir o config no formato dele, em vez de adivinhar o schema YAML (não corrompe config alheio).
- **Uninstall** simétrico: remove as skills gstack de `~/.hermes/skills` e tira o bloco instrucional do `~/.hermes/AGENTS.md` (preservando o conteúdo do usuário fora dos marcadores).
- Tudo offline e idempotente; nenhuma dependência nova. +3 testes (103 Node + 33 Python verdes).

## [2.6.2] - 2026-06-16

### Correções da revisão Codex (6 bugs reais)
- **`context search|related|explain --json` agora emite JSON PURO** — o banner/`section` era impresso *antes* do JSON, poluindo a saída-máquina (MCP/automação). No modo `--json`, header e mensagens humanas são suprimidos; erros viram objeto JSON (`{"error":"no_index"}`). `explain --json` retorna um objeto combinado `{topic, search, related}`.
- **`workflow inspect` sem `<runId>`** chamava `readJournal(base, undefined)` e quebrava com *"path must be of type string"*. Agora valida o `runId` **antes** de tocar o disco (erro limpo no modo humano e `{"error":"missing runId"}` no `--json`).
- **`workflow run` instruction-only** (delegação OFF) marcava `passed` mesmo sem executar trabalho — o verde refletia o estado pré-existente, não a tarefa. Agora o resultado traz `executed:false` + `warning` (`instruction_only`), registrado no journal (`run_warning`) e exibido no CLI.
- **Replay do workflow:** se o processo morria **entre** `worker#N` (concluído) e `verifier#N` (não rodou), o resume pulava para `N+1`, deixando trabalho não verificado. Agora retoma em `N`, reaproveita o worker via `journal_hit` e roda o verifier que faltou.
- **Graphify bridge `implemented_in`:** a aresta era gravada como `document→code` e o `related` a atribuía a **toda** entidade citada no mesmo doc. Agora é `entity→code` (`from_id=entity_id`); o código é atribuído só à entidade que casa o nó do grafo.
- **`create.js` chamava `npx` direto** (ENOENT no Windows) em AgentMemory/Graphify/Headroom. Agora via `npxArgv()` (`cmd.exe /c npx` no win32).
- +7 testes de regressão (100 Node + 33 Python verdes).

## [2.6.1] - 2026-06-16

### Obsidian por padrão — detecção automática + escolha obrigatória
- O Obsidian agora é **parte padrão** do produto. Se o app estiver instalado, o `gstack_vibehard install` e o `context init` **detectam os vaults** (lendo o `obsidian.json` do OS) e **exigem uma escolha**: indexar um vault detectado, digitar outra pasta, ou **"pular por enquanto"**.
- **Invariante de segurança mantida — detectar ≠ indexar:** a detecção lê só o `obsidian.json` (existência + paths), **nunca o conteúdo das notas**. A indexação (read-only) só ocorre da pasta **explicitamente escolhida**; "pular" → nada é lido. Nunca abre o app, cria cofre ou varre vault global implícito.
- Default global em `~/.gstack/context-defaults.json` (projetos herdam); `getObsidianPath` resolve **projeto > global**.
- **Não-interativo (CI) nunca trava** — pula com aviso para `context obsidian set`.
- +3 testes (95 Node + Python verdes).

## [2.6.0] - 2026-06-16

### Document Graph: Obsidian + Graphify bridge + A2A Card (PR2/PR5/PR6 do PRD)
- **Obsidian como fonte (opt-in, read-only):** `context obsidian set <pasta>` registra uma pasta; `context index` a indexa (`source=obsidian`, wikilinks → `links_to`). **NÃO abre o app, NÃO cria cofre, NÃO escreve no cofre, NUNCA varre vault global implícito** (nem o `~/gstack-vault`). Pasta ausente não quebra.
- **Graphify bridge:** se `graphify-out/graph.json` existir (auto-detect), o indexer cria edges ligando entidades de doc ao **grafo de código** — `implemented_in` e `depends_on` aparecem em `context related`/`explain`. Ausência degrada sem erro.
- **A2A Agent Card:** `gstack_vibehard a2a card` imprime um Agent Card **JSON válido** (formato A2A) descrevendo capacidades reais (context.search, workflow.run, quality.gate, delegate.opencode). **Nenhum servidor**, nenhum agente externo registrado. Banner suprimido em saída-máquina (`--json`/`a2a`).
- Tudo offline, sem dep nativa, sem rede. +9 testes (92 Node + Python verdes).

## [2.5.0] - 2026-06-16

### Document Graph local — GraphRAG offline (PR1 do PRD)
Busca documental determinística, **offline, sem LLM, sem rede, sem dependência nativa** — o agente consulta o índice em vez de reler arquivos (economia de tokens).
- **`context index`** indexa `docs/{adr,prd,plans,research}` + `README`/`CHANGELOG` num **SQLite com FTS5** em `.gstack/context/context.db`. Indexer em **Python stdlib** (`sqlite3` estável desde 2006 + FTS5 estável desde 2015) — **nada experimental**, zero dep nativa npm; fallback `LIKE` se FTS5 faltar. Invocado pelo comando JS via `resolvePythonCmd` (padrão `qg.py`).
- **`context search "<q>"`** (FTS5 → path/heading/trecho/score, `--json`), **`context related <Entidade>`** (mentions/links_to/tagged_as), **`context explain "<tópico>"`** (docs + entidades), **`context status --db`** (documents/chunks/entities/edges + estado FTS).
- **Incremental por hash** (pula inalterado), **remoção em cascata**, entidades por heurística (wikilink/tag/PascalCase/tech + stopwords). Segurança: não indexa `.env`/secrets/`.git`/`node_modules`.
- session_start mostra 1 linha de counts do índice (summary-only, query read-only).
- 4 testes Python (idempotência/incremental/remoção/segurança/FTS) + 2 JS (bridge). 88 Node + Python verdes.

## [2.4.1] - 2026-06-16

### Workflow runner replayable + delegação OpenCode segura (gaps do v2.4.0)
Review do PRD identificou gaps reais na fundação v2.4.0 — corrigidos:
- **`maxWallTimeSeconds` agora é aplicado** (deadline determinístico por iteração; antes era só anunciado). (`runner.js`)
- **Replay completo:** `worker#N`/`verifier#N` também geram `journal_hit`; `workflow run --run-id <id>` **retoma** um run pulando nós já concluídos. (`runner.js`, `workflow.js`)
- **`workflow inspect --json`** para automação. (`workflow.js`)
- **`delegate --worktree`:** roda o OpenCode numa **git worktree isolada** — nunca toca o branch principal; commita o trabalho num branch efêmero e o **preserva para revisão** (`git merge <branch>`). (`delegation/worktree.js`, `opencode.js`)
- **`delegate --max-iterations` agora tem efeito** (retenta em falha); a delegação **lê `.gstack/loop-budget.json`** (timeout = `maxWallTimeSeconds`, `maxIterations`). (`opencode.js`, `delegate.js`)
- +8 testes (86 Node + 24 Python).

## [2.4.0] - 2026-06-16

**Workflows agênticos: Context Docs + Loop Budget + Graph Runner determinístico + Delegação OpenCode.**

Grafo determinístico — **LLM decide dentro do nó, código decide as arestas**. O gstack **não faz model calls**: delega ao OpenCode (modelo/free tier do usuário) e verifica de forma determinística (testes/Fallow). Tudo opt-in, com caps e circuit breakers.

- **Context docs** (`context init/status`): `.gstack/context.json` + `docs/{adr,prd,plans,research}`; session_start injeta **resumo summary-only** (contagens + policy), sem ler conteúdo → economia de tokens.
- **Loop budget** (`.gstack/loop-budget.json`): `maxIterations`, `maxConsecutiveSameFailure` (circuit breaker → human handoff), `maxWallTimeSeconds`; validação. Delegação opt-in (`enabled:false`, `requiresUserApproval:true`).
- **Journal/replay** (`src/workflow-graph/journal.js`): eventos por run em `journal.jsonl`; replay pula nós concluídos (`journal_hit`); nunca persiste secret/transcript.
- **`delegate opencode --task ... [--yes]`**: roda `opencode run` (args em array, shell:false), retorno **estruturado** (summary + exitCode + changedFiles via git), confirmação obrigatória; não-interativo exige `--yes`.
- **`workflow run --task ...`**: orquestra worker → verifier (determinístico: suíte de testes) → retry/handoff respeitando o loop budget. **`workflow runs`/`inspect`**: observability via journal.
- **stop.py**: loop-tracking cross-harness em `~/.gstack/loop-state.json` (não Codex-only) — circuit breaker barato e gracioso.
- **`.gitignore`**: `.claude/settings.local.json` e `.docs/`.
- +21 testes (79 Node + 24 Python). Construído em branch isolado, mergeado após verde total.

## [2.3.5] - 2026-06-16

### Re-rodar `install` atualiza hooks obsoletos (raiz dos falsos positivos do QG)
- **Bug:** quando todos os harnesses já estavam "instalados", `install` fazia early-return e **pulava o refresh dos hooks** — então um `qg.py` antigo (com heurísticas React de loading/error, propensas a falso-positivo, ex.: "componente com useEffect sem loading" em arquivo sem useEffect) **nunca era substituído**; a única saída era `rm` manual. Agora `install` **sempre atualiza os hooks** para a versão do pacote (idempotente, com backup `.bak`), inclusive no caminho "já configurado". O `qg.py` atual é o wrapper determinístico do Fallow (sem heurísticas React).
- Refactor: lógica de cópia de hooks extraída para `refreshHooks()` e chamada nos dois caminhos.

## [2.3.4] - 2026-06-16

### Correções da revisão (Codex) — robustez do `tools`
- **[P2] MCP só habilita se a ferramenta existe.** `tools mcp enable <tool>` agora bloqueia se a ferramenta não está em `installed` (registry) ou se `<tool>-pp-mcp` não responde — evita o harness falhar ao carregar MCP com "command not found". (`mcp.js`, `tools.js`)
- **[P2] `tools install` migra registries antigos.** Projetos criados antes da feature (sem o bloco `printingPress`) não explodem mais — `readRegistry` normaliza para o schema atual com defaults. (`tools.js`)
- **[P2] Go por arquitetura no Linux.** O auto-install não baixa mais sempre `linux-amd64`; mapeia `process.arch` (x64→amd64, arm64→arm64, arm/ppc64/s390x) e **não auto-instala** em arch desconhecida (orienta). (`install.js`)
- **[P3] `tools uninstall` não "esquece" em falha.** Só remove do registry quando a desinstalação real teve sucesso; em falha, mantém a entrada marcada `uninstall_failed`. (`tools.js`)
- **[P3] Help completo.** O help de `tools` agora lista todos os subcomandos (install/uninstall/installed/mcp/doctor/generate), não só discovery. (`tools.js`)
- +5 testes (58 Node + 24 Python verdes).

## [2.3.3] - 2026-06-15

### Instaladores macOS/Windows + README passo a passo
- **Fórmula Homebrew (macOS) consertada.** Estava congelada na v0.4.0 com `sha256` placeholder ("Will be updated…") — quebrada. Atualizada para v2.3.2 com o sha256 real; `post_install` pesado removido (passa instruções via `caveats` em vez de baixar deps durante o `brew install`).
- **Mensagem do instalador no macOS** corrigida — não anuncia mais um tap Homebrew inexistente; recomenda `npm install -g` (caminho real) e aponta a fórmula no repo.
- **Launchers Windows** (`install.bat`/`gstack_vibehard.cmd`) auditados — funcionais (checam Node, rodam via `npx`).
- **README — "Modo de Uso" reescrito passo a passo** com cada função documentada: `doctor`, `install` (+`--skip-deps`), `create` (+`--lite`/`--template`), `init`, `tools` (todos os subcomandos), `monitor`, `sprint`, `list`, `uninstall` (+`--yes`).

## [2.3.2] - 2026-06-15

### Correção crítica de Windows (revisão de todo o código)
- **`npx` quebrado no Windows.** `execFileSync("npx", …, {shell:false})` dá ENOENT no Windows (`npx` é `npx.cmd`). Isso quebrava: **`tools list/search/install`** (Printing Press — 100% inoperante no Windows), **`playwright install`** no instalador, **`playwright --version`** no doctor, e **`fallow audit`** no monitor TUI. Centralizado num helper `npxArgv` (em `deps.js`) que usa `cmd.exe /c npx …` no Windows (sem `shell:true`, evitando a deprecation de args não-escapados do Node). Validado end-to-end: `tools search` agora retorna o catálogo real no Windows; `doctor` detecta o Playwright. (`src/installer/deps.js`, `cli.js`, `install.js`, `doctor.js`, `monitor.js`)

## [2.3.1] - 2026-06-15

### Zero-config consistente: Go instalado sob demanda
- `tools install <slug>` agora **instala o toolchain Go automaticamente** se ausente (como o projeto já faz com bun/uv/Rust/Chromium) — antes só orientava o usuário a instalar manualmente. Instalação **sob demanda** (não no bootstrap, para não forçar ~150MB em quem não usa Printing Press): Windows via winget/choco, macOS via brew, Linux via tarball oficial em `~/.local/go` (sem sudo). `ensureGo` adiciona o Go ao PATH da sessão e verifica antes de prosseguir; opt-out via `GSTACK_SKIP_GO=1`. Se a instalação do Go falhar, degrada para `needs_go` com instrução. (`src/printing-press/install.js`)
- `doctor`: mensagem ajustada — `tools install` instala Go sob demanda.

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
