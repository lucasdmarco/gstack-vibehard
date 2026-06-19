# Changelog - gstack-vibehard

## [2.31.0] - 2026-06-19

### Safe Install — preflight de impacto e instalação de impacto mínimo (Fase 3, bloqueador de produção do Codex)
Responde ao P1 do `FINALPRODUCAO.MD`: o `install` deixa de ser global-first cego.
- **`install --audit-only`** (AC2): preflight que **lista, por categoria, os caminhos globais** que seriam criados/modificados (`[create]`/`[modify]`) — **sem escrever nada** — e salva `~/.gstack_vibehard/install-report-<ts>.md`. Provado: o manifest real fica intacto.
- **`install --project-only`**: impacto global mínimo — pula deps globais, **MCP global**, e o vault Obsidian (mantém hooks + config dos harnesses).
- **`install --harness <claude|opencode|cursor|codex>`**: instala só um harness (ativação incremental).
- **`buildInstallImpact()` / `renderImpactMarkdown()`** (`src/installer/impact.js`): função pura (home injetável) que enumera o impacto por categoria — base testável do preflight e do relatório.
- **Mensagem final precisa** (Codex §6 P2): admite que componentes globais foram registrados e aponta `doctor --install-integrity` + `uninstall --dry-run`.
- +5 testes Node (impacto por categoria, project-only, filtro de harness, modify vs create). 236 Node + 56 Python verdes; lint/typecheck limpos.

## [2.30.0] - 2026-06-18

### QG honesto por severidade + dial de token nas duas camadas (Fases 1–2 do master plan)
- **[Fallow ciente de severidade] `qg.py`** (`hooks/hooks/qg.py`): o Quality Gate deixa de reprovar a entrega por achado **MÉDIO/auto-fixable** (ex.: "remove unused export"). Agora **só CRÍTICO/ALTO bloqueiam** (`BLOCKING_SEVERITIES`), alinhado ao `stop.py` (`blocked = critical>0 or high>0`). Aceita `--profile <arquétipo>` (contrato de ruleset por arquétipo). Resolve o falso-positivo que reprovava o próprio repo (lib/CLI) por questão de baixo risco. Fallow ausente continua **pulando sem bloquear** (peer dep opcional).
- **[Dial de token — Camada A] `.gstack/profile.json` → `tokenBudget`** (`hooks/hooks/_paths.py` `read_project_profile`/`token_budget`; aplicado em `session_start.py` e `stop.py`): `minimal` = loop barato (sem injeção de identidade/chronicle/frameworks pesados); `standard` (default) = enxuto (sem MOM basal); `full` = comportamento atual. **A camada de contexto/identidade/memória continua disponível** — só deixa de ser sempre "full". Fail-open → `standard`.
- +8 testes (2 Python qg severidade, 6 Python dial de token). 231 Node + 56 Python verdes; lint/typecheck limpos.
- Nota: a cópia **instalada** do `qg.py` (`~/.codex/hooks`) atualiza ao reinstalar (`gstack_vibehard install` atualiza hooks obsoletos) — o fonte versionado é o que entra na release.

## [2.29.0] - 2026-06-18

### Núcleo de arquétipo — checks determinísticos que cabem em QUALQUER projeto (Fase 1 do master plan `entregafinal.md`)
O gstack passa a **detectar o tipo do projeto** e a entregar valor determinístico (de graça em tokens) a repos que não são site/SaaS — começando pelo próprio repo dele (uma lib/CLI npm).
- **`detectProfile()`** (`src/project-plan/detect-profile.js`): classificação determinística (sem LLM, sem rede) em `library | cli | web-app | service | mobile-backend | data-ml | monorepo | unknown`, a partir de `package.json` + presença de arquivos. Base que adapta gates e regras ao arquétipo.
- **`publish-guard`** (`src/project-plan/publish-guard.js` + comando `gstack_vibehard publish-guard`): o ritual de release automatizado e determinístico — working tree limpa, versão bumpada vs última tag, CHANGELOG com entrada, tag, CI verde (via `gh`, opcional). Exit ≠0 em pendência HARD. `--json`, `--no-ci`.
- **`diff-hygiene`** (`src/project-plan/diff-hygiene.js`): varredura só dos arquivos mudados (git) — `debugger`, segredo hardcoded (AWS/GitHub/Slack/chave privada), `.only`/`.skip` em teste, catch vazio, TODO/FIXME. **Não** flagra `console.log` (numa CLI o stdout é o produto).
- **`verify` ciente de arquétipo** (`src/project-plan/verify-runner.js`): para lib/CLI roda publish-guard + diff-hygiene como gates **advisory** (reportam, nunca bloqueiam) e marca runtime/preview como `not_applicable` (não se aplica a lib/CLI). Mostra o arquétipo no relatório.
- **Adoção observe-only** (`src/commands/activate.js`): `enable` detecta o arquétipo e grava `.gstack/profile.json` `{profile, mode:"observe", tokenBudget:"standard"}` — em modo observe os gates reportam e nunca bloqueiam.
- +26 testes Node (detecção por arquétipo, publish-guard, diff-hygiene, comando, profile.json). 231 Node + 48 Python verdes; lint/typecheck limpos.
- Nota honesta: o gate QG (Fallow) ainda bloqueia em achados MÉDIO/auto-fixable; torná-lo ciente de arquétipo (bloquear só CRÍTICO/ALTO) está na próxima etapa da Fase 1.

## [2.28.1] - 2026-06-18

### Patch de segurança (code review da v2.28.0)
- **[crítico] Delegação SEM `--worktree` não bloqueava `.env` rastreado.** O bloqueio de segredo da v2.28.0 ficava dentro de `if (flags.worktree)`, mas a delegação **padrão** (sem `--worktree`) roda `opencode run` no **diretório real** — a outra IA lia o `.env` direto do disco, sem nenhum bloqueio. Era o caminho mais exposto e o default. Agora o bloqueio guarda **toda** delegação (`src/commands/delegate.js`): `.env` rastreado → BLOQUEADO em ambos os modos (libere com `--allow-tracked-secrets`).
- **[robustez] `enable` avisa sobre `.gstack-disabled/` residual** quando o projeto já está ativo (antes ignorava o resíduo silenciosamente).
- +2 testes Node (bloqueio no modo sem worktree; aviso de resíduo). 205 Node + 48 Python verdes; lint/typecheck limpos.

## [2.28.0] - 2026-06-18

### Ligar/desligar o gstack POR PROJETO (claro) + delegação não vaza segredos
Fecha a dúvida do dono: "como ativo/desativo o gstack num projeto que já está rodando?". Antes, "ativar" era efeito colateral de `context init` — nada óbvio. Agora há comandos diretos, e projetos em andamento ficam **intocados** até você decidir.
- **`gstack_vibehard enable` / `disable` / `status`** (`src/commands/activate.js`): controle explícito por projeto. O marcador é a pasta `.gstack/` (o que os hooks já checam via `is_gstack_project`). `disable` **preserva os dados** renomeando `.gstack/` → `.gstack-disabled/` (hooks ficam passivos); `enable` recria ou **reativa** preservando contexto/planos; `status` mostra ATIVO / DESATIVADO / INATIVO. Não sobrescreve em conflito.
- **Modelo de ativação na mensagem do `install`:** o gstack vem **ATIVO por padrão em projetos NOVOS** (`create`) e **DESATIVADO em projetos em andamento** — ativar com `enable`. Projeto que você não ativar fica intocado (só o bloqueio de comando destrutivo continua global, como rede de segurança).
- **[P1] Delegação BLOQUEIA `.env` rastreado** (`src/commands/delegate.js`): com `--worktree`, se houver `.env` versionado no git, o gstack **não delega** (a outra IA veria seus segredos no checkout da worktree) — instrui a corrigir (`git rm --cached .env`) ou liberar explicitamente com `--allow-tracked-secrets`. Antes só avisava.
- **[P1] Commit delegado não vaza segredos** (`src/delegation/worktree.js` `commitWorktree`): removido `--no-verify` (respeita os hooks de pre-commit do usuário) e o staging agora **exclui `.env`/`.env.*`** — o branch revisável nunca contém o `.env`.
- +9 testes Node (toggle enable/disable/status com preservação de dados; bloqueio/override de delegação; higiene do commit). 203 Node + 48 Python verdes; lint/typecheck limpos.

## [2.27.0] - 2026-06-18

### Infra global, ATIVAÇÃO por projeto — seguro para máquina com vários projetos
Responde "instalar o gstack põe meus projetos em andamento em risco?": agora **não**. A infra é instalada globalmente, mas as **regras gstack só ativam em projetos com `.gstack/`**.
- **Helper único `find_gstack_root()`/`is_gstack_project()`** (`hooks/hooks/_paths.py`): sobe a árvore procurando `.gstack/`. **Ignora o home** — `~/.gstack` é o dir GLOBAL, não marcador de projeto (senão todo projeto sob a home pareceria gstack-ativo).
- **Ativação por projeto:** `stop.py` (chronicle/gates/sandbox), `session_start.py` (identidade/quality-bar) e `user_prompt_submit.py` (hints) **só agem em projeto gstack**. Projeto alheio sem `.gstack/` → o gstack não interfere. (Só o bloqueio de comando destrutivo continua global, como rede de segurança.)
- **Hooks fail-OPEN:** `pre_tool_use_security.py` (e demais hooks globais) nunca crasham/travam o turno — input malformado → `exit 0` (libera). Corrige `json.loads(stdin)` sem try/except que podia bloquear Write/Edit/Bash em qualquer projeto.
- **`~/CLAUDE.md` auto-escopado:** o bloco global instrui o agente a aplicar as regras gstack **só** em projetos `.gstack/`; fora deles, comportar-se normalmente.
- **Mensagem do `install`** explica a ativação por projeto (`context init` p/ ativar projeto existente; `create` p/ novo) + rollback.
- +10 testes Python (gate por projeto + fail-open + destrutivo global). 194 Node + 48 Python verdes; lint/typecheck limpos.

## [2.26.0] - 2026-06-18

### Hardening de produto (correções da revisão)
- **[crítico] Isolamento de teste do manifest:** o guard `underHome` usava só `startsWith(home)`, mas no Windows `tmpdir()` fica **sob** `homedir()` — então rodar `npm test` gravava/corrompia o `~/.gstack_vibehard/install-manifest.json` **real** do desenvolvedor. Novo `shouldRecordManifest` só registra quando o `home` é explícito (intenção do caller) **ou** o caminho **não** está sob `tmpdir()`. Prova: o md5 do manifest real fica idêntico antes/depois da suíte.
- **`safeCopyDir` restaurável:** cada arquivo interno do usuário sobrescrito agora é registrado no manifest como item **restaurável** (`restoreOnUninstall:true` + backup) — antes só o dir pai era registrado e o uninstall não restaurava arquivos internos.
- **Auto Dream honesto:** o bloco escrito no `CLAUDE.md` deixou de afirmar "Auto-dream ON" → agora "**Dream audit ON** — auto-improve (worktree/verify/accept-reject) no roadmap". `dream status` idem.
- **uninstall — fallback legado seguro:** sem manifest, remover skill por **nome** (risco de colisão com a do usuário) agora exige `--legacy-name-cleanup`; por padrão avisa e **não remove**.
- +2 testes (`shouldRecordManifest`, `safeCopyDir` restaurável); 194 Node + 38 Python verdes; lint/typecheck limpos.

## [2.25.0] - 2026-06-18

### Contrato de confiança (3/3) — proxy de interceptação real (opt-in) + higiene de worktree
- **`gstack_vibehard proxy`** (`src/security/redact-proxy.js`): proxy reverso **opt-in** que redige a **resposta do modelo antes de chegar ao harness/tela** — a única forma honesta de "interceptação em trânsito" a partir de uma CLI. Aponte `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` para ele. **Honesto:** só funciona onde o harness aceita base-URL custom (não é universal); SSE é best-effort por linha. Reusa a lib única de redaction.
- **Higiene de worktree** (`checkTrackedSecrets`): o gstack **não copia `.env`** para worktrees (usa `git worktree add` puro; autosave exclui `.env`; não existe `.worktreeinclude`). O risco real é ter `.env` **rastreado** no git — `delegate --worktree` agora **avisa** se detectar. README atualizado desmentindo o mito do `.worktreeinclude`.
- README §Segurança: documenta redaction do GitOps, higiene de worktree e o caminho honesto de interceptação (proxy opt-in vs Output Guard pós-resposta).
- +6 testes (192 Node + 38 Python verdes; lint/typecheck limpos). Fecha o contrato de confiança (Fase 3 honesta completa).

## [2.24.0] - 2026-06-18

### Contrato de confiança (2/3) — create project-scoped + status honestos
- **`create` agora é PROJECT-SCOPED:** parou de escrever config GLOBAL (`~/.config/opencode/hooks.json`, `~/.claude/settings.json`) — era a causa do EPERM e tocava o ambiente global sem manifest/backup. A config global de harness é responsabilidade do `install`. (Bônus: o `hooks.json` do OpenCode estava errado — OpenCode usa plugins.)
- **`verify` honesto p/ automação:** `ready` agora é **estrito** (só `true` quando tudo aplicável passou, sem `tool_missing`); novo campo **`usable`** = sem blockers (mas pode faltar Fallow/QG). Consumidor que olha só `ready` não libera fluxo sem ferramenta de confiança.
- **`workflow run` instruction-only ≠ `passed`:** quando nenhum trabalho real é executado (delegação OFF), o status vira **`instructed`** (não `passed`) — não engana o usuário leigo. Resume (journal_hit) e worker custom contam como executado.
- **`build_agents.js`** usa `execFileSync` com array (sem shell/string); **`typecheck`** roda check de parse REAL (`node --check`), rotulado honestamente (ESM puro, sem TS) — fim do placebo que sempre passava.
- Testes atualizados ao novo contrato (186 Node + 38 Python verdes; lint/typecheck limpos).

## [2.23.0] - 2026-06-17

### Contrato de confiança unificado (1/3) — toda escrita global via safe-write + uninstall restaurativo
Fecha a dívida apontada na revisão: "a camada de confiança estava dividida (parte manifest/safe-write, parte escrevia por fora)".
- **`merge.js` agora delega ao safe-write:** `writeWithBackup`/`copyWithBackup`/`copyDirSync` passam por `safeWriteFile`/`safeCopyFile`/`safeCopyDir` (backup versionado + **registro no manifest** com componente inferido). Isso migra **claude, codex, headroom** de uma vez, sem reescrever cada caller.
- **`install.js` (vault + `~/.codex/.env`) e `hermes.js` (config.yaml/snippet)** passam por safe-write. O `.env` usa **bloco marcado** (`safeAppendBlock`); o vault é registrado mas **preservado** (`removeOnUninstall:false`).
- **Guard `underHome`:** o manifest só registra escrita GLOBAL (sob o home) — escrita em projeto/temp faz backup+atômica sem poluir o manifest (e sem poluir o `~` real em testes).
- **uninstall NORMAL agora restaura via manifest** (originais `.gstack_vibehard.bak`) **ANTES** de remover qualquer coisa; o manifest é apagado por último. Antes o restore real só rodava em `--restore-only`.
- **`doctor --fix` não-destrutivo:** escreve o merge via safe-write (manifest) e **preserva o `.jsonc`** renomeando para `.jsonc.gstack-disabled` (não apaga mais).
- +2 testes; suíte intacta (186 Node + 38 Python verdes; lint limpo).

## [2.22.0] - 2026-06-17

### Fase 3 (3/3) — Trust fixes + OpenCode JSONC doctor
- **OpenCode `doctor --fix [--dry-run]`** (`src/installer/opencode-jsonc.js`): resolve o conflito `opencode.json` + `opencode.jsonc` com **parser JSONC tolerante** (comentários, trailing commas, respeitando strings). Faz **merge preservando OAuth/plugin/provider do usuário**, consolida em `opencode.json` e faz **backup de ambos**; só aplica com confirmação (`--yes` no não-interativo). `--dry-run` mostra o plano sem tocar em nada. JSONC realmente malformado cai em `manual` (não arrisca merge).
- **Trust fixes:** `safeCopyDir` agora faz **backup por arquivo interno** antes de sobrescrever; **Headroom não usa mais `uv pip install --system` por padrão** — usa ambiente isolado (`uv tool install`) ou `pip --user`; `--system` só com `GSTACK_HEADROOM_SYSTEM=1` (opt-in explícito).
- +13 testes (185 Node + 38 Python verdes; lint limpo). Fecha a fatia honesta da Fase 3 (audit→verify→segurança→trust/JSONC); `dream improve` (adapter local) fica para a próxima.

## [2.21.0] - 2026-06-17

### Fase 3 (2/3) — Redaction lib + GitOps sanitizado
- **Lib de redaction reutilizável** (`hooks/hooks/_redact.py` + `src/security/redact.js`, padrões em sincronia com `_output_guard`): `redact_secrets`/`redactSecrets` **mascaram** segredos/PII (o Output Guard só detectava). Eventos registrados têm **fingerprint (hash)**, nunca o segredo bruto.
- **GitOps sanitizado** (`stop.py`): antes de `gh issue create`, o body e o título passam por redaction; se a origem tinha segredo, a issue **NÃO é criada** e um evento sanitizado é gravado em `~/.gstack/security/events.jsonl` (fingerprint, sem segredo). O commit local do `gitops_pr_create` também redige o summary.
- **Reframe honesto:** isto é uma lib de redaction **pré-publicação**, não um interceptor do stream de render do harness (uma CLI não controla esse render — refletido na capability matrix, `supportsPreOutputInterception: false`).
- +8 testes (3 JS + 5 Python) (176 Node + 38 Python verdes; lint limpo).

## [2.20.0] - 2026-06-17

### Fase 3 (1/3) — Verify honesto + Dream Audit anti-placebo + Capability Matrix
- **Verify honesto** (`verify-runner.js`): status agora é `ready` / `ready_with_warnings` / `blocked` / `pending_product` — **nunca declara "PRONTO" com runtime/preview pendente** quando o projeto roda (`start`/`dev`). Fallow/QG ausente vira **`tool_missing`** (não sucesso silencioso); roda **QG L1 e L2**; qualquer gate que falha bloqueia; `reducedTrust` quando o harness ativo é best-effort.
- **Dream Audit** (`src/dream/auditor.js` + `gstack_vibehard dream audit`): **determinístico, sem LLM, somente-leitura** — compara promessas (CLAUDE.md/README/docs) contra evidência real no código e classifica cada claim **REAL / PARTIAL / PLACEBO / ROADMAP / RISK**. `dream status` mostra a matriz de confiança por harness.
- **Harness Capability Matrix** (`src/dream/capabilities.js`): capacidades reais por harness; **honesta** — `supportsPreOutputInterception: false` em todos (uma CLI não intercepta o render do harness; o Output Guard é auditoria posterior, marcado como RISK no audit).
- +5 testes + verify reescrito (173 Node + 33 Python verdes; lint limpo).

## [2.19.0] - 2026-06-17

### Camada de confiança (3/3) — `verify` (delivery gates honestos, Replit-like)
- **`gstack_vibehard verify [--profile scaffold|full] [--json]`:** orquestra os gates de entrega do projeto — `deps` → `lint` → `typecheck` → `test` → `build` → `qg-l1`. **Só roda o que existe**; gates ausentes viram `not_applicable` (nunca finge passar). `runtime:start`/`preview:open` são `pending_feature` (roadmap). Salva `.gstack/runs/<runId>/verify.json`. `ready` só é `true` quando nenhum gate falhou.
- `src/project-plan/verify-runner.js` (puro, `exec` injetável, win32-aware) + `src/commands/verify.js`.
- Fecha a camada transversal de confiança (safe-write/manifest → uninstall restaurativo/integrity → verify). +3 testes (165 Node + 33 Python verdes; lint limpo).

## [2.18.0] - 2026-06-17

### Camada de confiança (2/3) — Uninstall restaurativo + Integrity Doctor
- **Uninstall manifest-driven + flags:** `--dry-run` (mostra o plano de rollback do manifest sem tocar em nada), `--restore-only` (só restaura backups), `--remove-vault` (remove `~/gstack-vault`), `--remove-deps`/`--include-projects` (honestos: não automatizam remoção de deps globais nem apagam projetos). `removeSkills` agora é **manifest-driven** — remove só skills que o manifest prova serem nossas (nunca uma skill do usuário com nome colidente); fallback ao padrão para instalações legadas.
- **`doctor --install-integrity` (`src/installer/integrity.js`):** valida manifest presente, backups existentes, **drift de hash** (arquivo alterado desde a instalação), itens registrados presentes e configs JSON parseáveis; diz se o **uninstall seria seguro**.
- +4 testes (162 Node + 33 Python verdes; lint limpo).

## [2.17.0] - 2026-06-17

### Camada de confiança (1/3) — Safe Write + Manifest como fonte de verdade
Primeira fatia do "fechar em produção com rollback" (PRDs faseprebuilt). Decisão: **ownership por manifest** em vez de renomear 109 skills para `g_` (mesma garantia de segurança, sem rename arriscado).
- **`src/installer/safe-write.js`:** camada única de escrita global — `safeWriteFile`/`safeCopyFile`/`safeCopyDir`/`safeAppendBlock`. **Backup obrigatório versionado** (`.gstack_vibehard.bak`, depois `.bak.1`/`.bak.2`, nunca sobrescreve), **escrita atômica**, **hashes** (original + instalado) e registro no manifest. Falha no backup **bloqueia** a escrita.
- **`src/installer/manifest.js`:** manifest em `~/.gstack_vibehard/install-manifest.json` com `items[]` (`path/kind/action/owner/component/backup/hashes/removeOnUninstall/restoreOnUninstall`). Backward-compatible (preserva `agentDirectories`/`agentmemory`).
- **Ownership real:** `install` registra skills/scripts criados (e não os pré-existentes do usuário); `agent-distribution` preserva `items[]` em vez de sobrescrever o manifest. Base para o uninstall manifest-driven (próxima release).
- +5 testes (158 Node + 33 Python verdes; lint limpo).

## [2.16.0] - 2026-06-17

### Hermes MCP seguro (VPS-safe) + gates honestos (revisão Codex P3)
- **Hermes MCP reescrito a partir da doc oficial** (`hermes_cli/mcp_config.py`, config reference): o `hermes mcp add` é **interativo** (podia travar um install) e os flags assumidos estavam errados. Agora o gstack escreve `mcp_servers` em `~/.hermes/config.yaml` com o **schema verificado** (`command`/`args`/`env` + `enabled`), de forma **VPS-safe**:
  - `config.yaml` **ausente** → cria com `mcp_servers` e **`enabled: false`** (Hermes não tenta conectar até o usuário habilitar o que tem).
  - `config.yaml` **existente** → **nunca tocado**; gera um snippet mergeável em `~/.hermes/gstack-mcp-servers.yaml` + orientação (mesclar e `/reload-mcp`).
  - Zero dependência nova; nada interativo; uninstall remove o snippet sem tocar no `config.yaml`.
- **Gates honestos:** novo `npm run lint` (zero-dep — `node --check` em todo `src/`+`tests/`+`scripts/`) e `npm run typecheck` honesto (declara que o projeto é ESM puro, sem TS; não finge gate). Meta-teste trava o lint no CI.
- +5 testes Hermes reescritos + lint test (153 Node + 33 Python verdes).

## [2.15.0] - 2026-06-17

### Endurecimento P2 do executor de planos (revisão Codex)
- **Sem `cmd.exe /c`:** o runner agora invoca a **própria CLI via Node** (`process.execPath` + `src/index.js`) com **array de argumentos puro** — cross-platform e imune a quoting/injeção do `cmd.exe`. Como planos ficam persistidos/editáveis em `.gstack/plans/*.json`, há **allowlist**: só `gstack_vibehard` é executável; comando adulterado é rejeitado antes de rodar.
- **Journal sem segredos:** `step_started` grava o comando **sanitizado** (`sanitizeCommand` redige valores após flags sensíveis `--token/--key/--secret/...`, `KEY=VALUE` sensível e credenciais embutidas em URL) — nunca o comando bruto.
- +3 testes (150 Node + 33 Python verdes).

## [2.14.0] - 2026-06-17

### Confiabilidade P1 (revisão Codex) — bugs ativos
- **`workflow inspect --json` sem `<runId>`** tratava `"--json"` como runId (`flags._[0] || args[1]`) e retornava JSON "de sucesso" com `runId:"--json"`. Agora usa só `flags._[0]` (o parseFlags já separa flags de posicionais) → retorna `{"error":"missing runId"}`. Perigoso para automação, corrigido.
- **`create` EBUSY no Windows:** os boots best-effort (AgentMemory/Graphify/Headroom) rodavam `npx` real contra o `projectDir` mesmo em teste, deixando handles presos → `EBUSY` na limpeza. Adicionado guard `GSTACK_SKIP_SIDE_EFFECTS` no `safeExec` (testes/CI não spawnam processos externos) + `maxRetries/retryDelay` na limpeza do teste.
- +1 teste de regressão (147 Node + 33 Python verdes).

## [2.13.0] - 2026-06-17

### Pending-features (roadmap honesto) + fix de classificação
- **`src/project-plan/pending-features.js`:** registro único de features futuras (`runtime:start|logs|open`, `dashboard:open`, `deploy:preview|production`). O `planner` passou a consultar esse registro (fonte única) em vez de tratar `runtime:start` inline — todos viram `pendingFeature` (sem comando), aparecem no plano como "ainda não implementado" e o executor **nunca** os roda.
- Recipes `saas-auth-stripe` e `web-app` ganham `deploy:preview` como passo de roadmap.
- **Fix de classificação:** a keyword greedy `"app"` na recipe `mobile-backend` roubava "web app" → removida. Agora "web app" → `web-app` e "app mobile" continua → `mobile-backend`.
- +3 testes (146 Node + 33 Python verdes). Encerra os 4 PRDs pendentes (só PR8/dashboard-contract fica como roadmap).

## [2.12.0] - 2026-06-17

### Loop Patterns library — o `task` escolhe o ciclo certo (inspirado no Kilo)
Biblioteca determinística (sem LLM) que faz o Loop Engineer (`task`) escolher o ciclo seguro por tipo de trabalho:
- **`src/project-plan/loop-patterns.js`** — 5 padrões: `test-driven`, `compiler-driven`, `review-driven`, `runtime-debugging`, `product-iteration`. Cada um com contexto, estratégia de ação, perfil de verificação, regras de parada e **comandos reais** (`context search`, `workflow run`, `delegate opencode --worktree`).
- **`verification-profiles.js`** — sinais/critérios e comandos preferidos+fallback por perfil; preview/browser é **opcional** (runtime futuro).
- **`stopping-rules.js`** — regras mapeadas para o `loop-budget` real (`maxIterations`, `maxConsecutiveSameFailure`, `maxWallTimeSeconds`, `humanHandoffOnCap`); as demais ficam declarativas.
- **`loop-classifier.js`** — classifica o pedido por keywords + sinais (`hasFailingTest`/`hasRuntimeError`); sem sinais → `test-driven` (mais seguro).
- **Integração no `task`:** o plano agora traz `loopPattern`/`loopReason`/`verificationProfile`, imprime "Loop escolhido: …", e a delegação OpenCode usa **`--worktree`** (isolado). Nenhum loop executa comando real. +12 testes (143 Node + 33 Python verdes).

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
