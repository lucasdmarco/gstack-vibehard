# Changelog - gstack-vibehard

## [3.21.0] - 2026-06-30

### Security & Governance Pack (PRD 12 PR9)
Governança e supply-chain como artefatos versionados — não promessa.
- **`SECURITY.md`** (publicado no pacote): política de report privado + **postura de defesas** mapeando as proteções reais (Secrets Broker, AgentShield, Challenge-Response, VFA Provenance, diff-hygiene/QA, capability matrix honesta, deps mínimas).
- **`THREAT_MODEL.md`**: modelo de ameaças REAL (T1–T10: prompt injection, exfiltração, manifest adulterado, config global, ação não-provável, harness fingindo enforcement, loop descontrolado, revisão otimista, supply chain, drift) → cada um mapeado à mitigação determinística já implementada.
- **`CONTRIBUTING.md`** (ritual de release + disciplina de testes de abuso + zero-dep), **`.github/CODEOWNERS`** (revisão obrigatória; áreas sensíveis secrets/vfa/runtime/agents).
- **CodeQL** (`.github/workflows/codeql.yml`, `security-extended`, semanal) + **SBOM CycloneDX** (`npm run sbom`).
- **dream audit**: governance = REAL → **18 REAL / 2 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**.
- **+4 testes** (SECURITY/threat-model/CODEOWNERS/CodeQL/SBOM presentes e com conteúdo real). 395 Node + 58 Python verdes; coverage gate; lint/syntaxcheck; pack smoke OK.

## [3.20.0] - 2026-06-30

### `verify` conhece o runtime + usa o package manager real (PRD 12 PR5)
Fecha o P1 da auditoria: o `verify` deixava `runtime`/`preview` como `pending_feature` incondicional (placebo) e rodava `npm install` mesmo em projeto pnpm.
- **Package manager REAL**: `deps`/`lint`/`typecheck`/`test`/`build` agora resolvem o PM (campo `packageManager` → lockfile → fallback npm) — **pnpm/yarn/bun**, não mais `npm` fixo. Cross-platform (no Windows o `pm.cmd` roda via `cmd.exe /c`).
- **Runtime-aware**: para app/web, o `verify` agora **carrega e VALIDA o Runtime Manifest V2** e lê o estado real (`.gstack/runtime/`): manifest **inválido → `failed`** (sinal real, não placebo); válido + serviços `ready` (o `dev` rodou) → **`passed`**; válido + não rodado → **`advisory`** ("rode `dev`"); **sem `runtime.json` → preserva o `pending_product`** (o projeto roda mas o gstack não verifica). `preview:open` reporta a URL real do state quando há.
- **+3 testes** (runtime válido→advisory sem bloquear; inválido→failed→blocked; projeto pnpm→deps usa pnpm). 391 Node + 58 Python verdes; coverage gate verde; lint/syntaxcheck; pack smoke OK.

## [3.19.0] - 2026-06-30

### Type-safety + Coverage + Benchmarks (PRD 12 B3 / PR10)
Tipos nos contratos, gate de cobertura e lint 40× mais rápido — e o `tsc --checkJs` **achou 2 bugs reais de ReferenceError** que nenhum teste/CI pegava (só disparam em caminhos específicos).
- **[bug] `install.js`: `confirm` não estava importado** (não é global no Node — o `tsc` resolveu pro `confirm` do DOM). Um `install` **interativo** (sem `--yes`) **crasharia** no prompt de confirmação. Corrigido (import do `cli/index.js`).
- **[bug] `sprint.js`: `pyCmd` fora de escopo no `catch`** (declarado `const` dentro do `try`) → crash no ENOENT do python. Corrigido (hoist).
- **`tsc --checkJs` + `.d.ts` dos contratos** (`types/contracts.d.ts`: Runtime Manifest V2, Secrets Schema V2, Agent Manifest V2, Attestation Receipt) + `jsconfig.json` para IntelliSense. (Gate `checkJs` full fica como adoção incremental de JSDoc nos options-bags — honesto.)
- **Coverage c8**: `npm run coverage` + **`coverage:ci` no CI** (gate ≥70% linhas / 72% funções / 65% branches; atual **73% / 78% / 73%**).
- **`npm run bench`** (`scripts/bench.mjs`): micro-bench dos caminhos quentes (hashFiles, buildReceipt, allocatePort) — detecta regressão de performance.
- **⚡ `lint` paralelizado**: `node --check` por arquivo agora roda concorrente → **~120s → 3s** no Windows (fim do flake recorrente do `lint.test.js`).
- **dream audit**: type-coverage = REAL → **17 REAL / 2 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**.
- devDeps: `typescript`, `@types/node`, `c8` (dev-only, não shipados). **+3 testes** (guard dos 2 bugs + infra B3). 388 Node + 58 Python verdes; coverage gate verde; pack smoke OK.

## [3.18.0] - 2026-06-30

### Meta-Harness MVP — o fecho do PRD 13 (PR13.6)
Orquestrador como **máquina de estado** sobre worktree+executor, com **verifier independente** e **dupla verificação** — amarra task-loop (B1), provenance (C1) e o resto.
- **Novo `src/meta/orchestrator.js`** (puro): `decideStatus` (a REGRA DE OURO §11.4.1 — o gate determinístico DECIDE, o LLM é advisory: **LLM aprova + QG falha = `failed`, NUNCA `passed`**; QG passa + LLM aponta risco = `needs_human_review`; QG ausente = `blocked_gate_missing`), `pickExecutor`/`pickVerifier` (planner por especialidade; verifier sempre **≠ executor**), `runOrchestration` (executor implementa → verifier revisa advisory → gate bloqueante → decisão → provenance; **hard caps**; executor≠verifier obrigatório em **risco alto**).
- **Novo `gstack_vibehard orchestrate <planId> [--verify-with <harness>] --yes`**: camada sobre worktree real + `diff-hygiene` como gate determinístico + provenance (recibos separando `llm_review_advisory` de `deterministic_gate`). **SEM auto-merge**: passo `passed` vira branch; o resto é descartado. Guarda: repo git + bloqueia `.env` rastreado. Reviewer LLM é um **hook advisory** (sem reviewer real, o gate decide).
- **dream audit**: meta-harness = REAL → **16 REAL / 2 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK** — **PRD 13 completo** (factory→shield→adapters→provenance→challenge→meta-harness).
- **+8 testes**: 6 de motor (regra de ouro; executor≠verifier; risco alto sem verifier→handoff; hard caps) + **2 e2e reais com git** (passo limpo→passed+branch sem tocar main; `debugger`→gate falha→descarta). 385 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.17.1] - 2026-06-30

### Correção: `challenge --evidence` negava no Windows (cmd/PowerShell quebra a vírgula)
Reconfirmação numa máquina Windows limpa: `challenge evaluate … --evidence a,b,c` retornava **DENY** mesmo com a evidência completa.
- **Causa:** o `cmd.exe`/PowerShell quebra o valor `a,b,c` (sem aspas) em **argumentos separados**, então o parser só via o 1º token (ou nenhum). No bash a vírgula fica num arg só, por isso passava.
- **Fix:** `--evidence` agora **consome múltiplos tokens** até o próximo `--flag` — `--evidence a b c` (split do cmd/PS) **e** `--evidence a,b,c` (bash) valem igual. **+1 teste** (ambas as formas → allow; sem evidência → deny). 377 Node verdes.

## [3.17.0] - 2026-06-30

### Challenge-Response para ações de alto risco (PRD 13 PR13.5)
Antes de uma ação perigosa, a policy exige **justificativa estruturada** — sem a evidência, a ação é **negada** (em harness com hook real).
- **Novo `src/vfa/challenge.js`** (puro): `classifyRisk` (escrita em config GLOBAL de harness, leitura de segredo, MCP global, comando destrutivo `rm -rf`/`drop database`/`push --force`, exfiltração) + `evaluateChallenge` (alto risco exige TODAS as evidências: `install-manifest-owner`/`backup-path`/`rollback-plan`; faltou → **deny**) + `buildChallenge`.
- **Honestidade do enforcement**: harness **instrucional** (copilot/gemini) → `posthoc_audit_only` (não bloqueia antes — só audita depois; **não** é Zero-Trust). Hook real → bloqueio.
- **Novo `gstack_vibehard challenge <classify|evaluate> --intent <i> --target <t> [--scope global] [--harness <id>] [--evidence …]`**: registra a decisão no **provenance** (recibo encadeado, C1).
- **dream audit**: challenge-response = REAL → **15 REAL / 2 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**. (Resta D1 — Meta-Harness — agora totalmente desbloqueado.)
- **+4 testes** (classifyRisk; DoD deny sem evidência/allow com evidência; instrucional=posthoc; buildChallenge). 376 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.16.0] - 2026-06-30

### VFA Provenance Alpha — recibos com hash-chain (PRD 13 PR13.4)
Verifiability-First: toda ação crítica deixa um **recibo encadeado por hash** — o sistema PROVA o que foi tentado/alterado (por hash, sem o conteúdo bruto), qual policy decidiu, e a cadeia não pode ser adulterada sem ser detectada.
- **Novo `src/vfa/attestation.js`** (puro): `buildReceipt` (inputHash/outputHash + `previousHash` + `receiptHash` que sela o conteúdo via `stableStringify` determinístico), `verifyChain` (pega receiptHash adulterado E previousHash quebrado por remoção/reordenação), `redactReceiptValues`.
- **Novo `src/vfa/provenance.js`**: `.gstack/provenance/actions.jsonl` **append-only** + `index.json`; hash chain **por run**; **redação ANTES de persistir** (segredo nunca em claro — o hash cobre o conteúdo já redigido, cadeia segue válida); logs por workspace.
- **Novo `gstack_vibehard audit <status|inspect|verify|export|doctor> [runId]`**: `verify` recomputa a cadeia e **falha (exit 1) se adulterada**.
- **Integração**: o `task run` (B1) registra um recibo encadeado em cada **accept/reject** (intent/target/policy — hashes, sem diff cru).
- **dream audit**: vfa-provenance = REAL → **14 REAL / 2 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**. Desbloqueia C2 (challenge-response) e os Audit Agents sobre o log.
- **+4 testes** (recibo/hashes; stableStringify determinístico; cadeia íntegra vs adulteração/remoção; provenance append+redação+jsonl adulterado→falha). 372 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.15.0] - 2026-06-30

### QA Multi-Lens — lentes determinísticas sobre o diff (PRD 12 B2)
Gate de revisão **determinístico** (sem LLM, sem rede) sobre os arquivos mudados, alinhado ao `ultracode.md` (zero eval, zero `any`, zero bare except, zero query sem limit, zero exec shell).
- **Novo `src/project-plan/qa-lenses.js`** (puro): lentes por linguagem — `eval`/`new Function` (ALTO), `exec` com string interpolada (ALTO, command injection), `shell:true` (MÉDIO), `: any`/`as any` (MÉDIO, TS), bare `except:` (MÉDIO, Py), `findMany()` ilimitado (MÉDIO), `SELECT` sem `LIMIT` (BAIXO). `evaluateQa`: ALTO/CRÍTICO bloqueiam; MÉDIO bloqueia em `--strict`.
- **Novo `gstack_vibehard qa [--strict] [--json]`**: varre os arquivos mudados (git), combina as lentes com o `diff-hygiene` (segredo/debugger), veredito por severidade. Testes legítimos e arquivos fora de escopo (.md) não disparam.
- **Sem falso-positivo**: `evaluate`≠`eval(`, `'any'` em string ≠ tipo, `except ValueError:` ≠ bare. Validado: `qa` na própria base do gstack = **0 findings**.
- **dream audit**: qa-multi-lens = REAL → **13 REAL / 2 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**. (Os Audit Agents sobre *provenance* do §10.4 chegam com a VFA — Sprint C1.)
- **+4 testes** (lentes pegam os anti-padrões; anti-falso-positivo incl. testes/idioma; gate strict; comando bloqueia). 368 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.14.0] - 2026-06-30

### Task Loop Executável — o `task` EXECUTA em worktree (PRD 12 B1 / Sprint B1)
O Loop Engineer sai de "só planeja" para **executar de verdade**: cada passo roda em **worktree isolado** e passa por **diff → diff-hygiene → accept/reject**, sem auto-merge.
- **Novo `src/project-plan/task-loop.js`** (motor PURO/injetável): `runTaskLoop` — por passo, cria worktree, aplica, captura diff, roda `diff-hygiene`; **aceita** (registra branch pronto pra merge) ou **rejeita** (`needs_review`, descarta). **Circuit breaker** (N falhas consecutivas → `handoff` humano; reseta no accept), **replay** (passos já aceitos pulam via journal), **hard cap** de iterações. O journal recebe só **resumo** (stepId/evento/branch/ids) — nunca o diff/segredo/comando.
- **Novo `gstack_vibehard task run [planId] --yes`**: executa o plano salvo. Reusa `worktree.js` (staging por allowlist, exclui `.env`/binário, respeita hooks), `diff-hygiene`, `journal`/`state` canônicos. **Sem auto-merge** — cada passo aceito vira um branch `task/<plano>-<passo>` pra revisão. Guarda: exige repo git e **bloqueia se `.env` está rastreado** (segredo iria pra worktree).
- **dream audit**: `task-loop` PARTIAL→**REAL** → **12 REAL / 2 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**. Desbloqueia o Meta-Harness (D1).
- **+10 testes**: 7 de motor (abuso — hygiene rejeita, circuit breaker + reset, journal sanitizado, replay, maxIterations) + 3 **e2e reais com git** (passo limpo→branch sem tocar main; `debugger`→rejeitado; `.env` rastreado→bloqueia). 364 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.13.1] - 2026-06-30

### Correção: `agents doctor` acusava drift falso em instalação limpa (Windows)
Reconfirmação numa máquina Windows limpa: `agents doctor` (3.13.0) reportava `Drift: Saida gerada desatualizada: copilot-instructions.md` numa instalação fresca.
- **Causa:** o tarball npm levou os adapters gerados com **CRLF** (autocrlf no Windows ao empacotar; a fonte embute CRLF), mas `build:agents --check` regenera em **LF** → a comparação **exata** do `writeText` acusava drift falso. (O manifest não sofria — é comparado via `JSON.parse`, que ignora line-ending.)
- **Fix:** a comparação de drift do `writeText` agora **normaliza CRLF→LF** — robusta a qualquer line-ending. `--check`/`agents doctor` passam numa instalação limpa independente do empacotamento. **+1 teste** (adapter em CRLF não acusa drift). 354 Node verdes.

## [3.13.0] - 2026-06-30

### Adapter Expansion + Capability Matrix honesta (PRD 13 PR13.3)
A matriz de adapters passa a declarar o **enforcement REAL** de cada harness — e nenhum harness instrucional é rotulado como enforcement/Zero-Trust.
- **Novo `src/agents/adapter-matrix.js`** (§8.4): `enforcement` por harness — `real_hooks` (claude) / `partial` (codex, hermes) / `rules_only` (cursor, **opencode** compat) / `instructional` (copilot, gemini, windsurf) / `detection_only` (kiro). `isInstructional`, `generatedHarnesses`.
- **`agents doctor` honesto**: a matriz mostra `enforcement=` real, não o `trust` de runtime. **opencode** vira `rules_only` (era `trust=strong`, enganoso — é compat Cursor sem hook próprio). Header explícito: "instrucional não é enforcement".
- **Copilot + Gemini gerados**: `agents/generated/copilot/copilot-instructions.md` e `gemini/GEMINI.md` (índices combinados, **com o Execution Contract**). Contrato agora em **65/65** adapters.
- **Label de proveniência**: o doctor mostra "compilado por X" (a versão que compilou os adapters), não a versão do package — honesto quando o release não regenera os adapters.
- **dream audit**: adapter-matrix = REAL → **11 REAL / 3 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**.
- **+3 testes de matriz** (enforcement honesto, isInstructional sem Zero-Trust, generatedHarnesses) + asserts de copilot/gemini gerados com contrato no e2e. 354 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.12.0] - 2026-06-29

### AgentShield Blocking Build — scan determinístico bloqueia injeção (PRD 13 PR13.2)
O scan de prompt-injection vira gate **determinístico e bloqueante**, em build **e** no `--check` (o gap que importava: uma injeção commitada não passava pelo `--check` do CI).
- **Novo `src/agents/scanner.js`** (puro/testável): `INJECTION_PATTERNS` (override de instrução, exfiltração, leitura de `.env`, desabilitar QG/hooks, vazamento de system prompt, comando destrutivo…), `scanFiles`, `evaluateScan`. **CRÍTICO bloqueia sempre; ALTO bloqueia em `--strict`** (CI release/Full).
- **Roda em build E `--check`** sobre o escopo §9.1 (`core/`, `knowledge/`, `agents/agents/`, `generated/`, `skills/skills/`). Antes o scan só rodava em build → o gate do CI (`--check`) era cego a injeção.
- **Cobertura honesta**: ECC AgentShield é cobertura **adicional**; sem ele o builtin determinístico segue ativo e o verdict é `APROVADO_COBERTURA_REDUZIDA`, nunca `pass` pleno (`reduced_coverage`).
- **Sem falso-positivo**: `process.env` e `.env.example` são BAIXO (não bloqueiam); word-boundary evita casar "send"/"open" em "resend"/"openai".
- **dream audit**: agentshield = REAL → **10 REAL / 3 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**.
- **+3 testes scanner** (injeção detectada, anti-falso-positivo, gate strict/non-strict) + **e2e de abuso** (injeção em knowledge bloqueia build E `--check`). 351 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.11.0] - 2026-06-29

### Agent Factory Contract — fonte única, drift guard, Execution Contract (PRD 13 PR13.1)
A fábrica de agentes (`core/` + `knowledge/` + `agents/agents/` → adapters por harness) vira **contrato do produto**: o que é gerado é comprovável e não pode apodrecer em silêncio.
- **Manifest V2** (`agents/generated/manifest.json`): `schemaVersion 2` + `compilerVersion` + **hashes da fonte** (`coreHash`/`knowledgeHash`/`agentsHash`) + adapter versions/status + security verdict. **Determinístico** (sem `generatedAt`) — o `--check` compara por igualdade sem ruído/churn.
- **Execution Contract** (`src/agents/factory.js`, §8.6): bloco imutável injetado no **fim de TODO adapter gerado** (claude/codex/cursor) — mesmo DNA operacional: "LLM cross-review é advisory only", "Fallow/QG indisponível bloqueia, não passa", respeitar hooks, nunca vazar segredo. Não substitui hooks reais (instrucional segue instrucional).
- **Drift Guard**: `build:agents --check` falha se generated está stale (core/knowledge/agents mudou), foi editado à mão, ou um adapter perdeu o contrato.
- **Novo comando `gstack_vibehard agents <build|check|diff|doctor|list|explain>`** — `doctor` mostra manifest v2, drift, contrato N/N, security e a **matriz de adapters × confiança real** (capabilities.js); nenhum harness instrucional rotulado enforcement.
- **dream audit** ganha `agent-factory` = **REAL** → **9 REAL / 3 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK**.
- **+4 testes** de factory (contrato idempotente, hashFiles determinístico, manifest v2, `evaluateDrift` de abuso) + asserts de manifest v2/contrato/**drift on edit** no build e2e. Adapters regenerados (21 agentes). **347 Node** + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.10.1] - 2026-06-26

### Correções pós-reconfirmação na máquina Windows limpa
- **`secrets run` falhava no bin global do Windows** ("Uso: secrets run --"): o shim `.cmd` do npm **engole o `--`**, então o separador não chegava ao comando. Agora o `--` é **opcional** — `secrets run node x.js` vale igual a `secrets run -- node x.js` (pega tudo após `run`, ou após o `--` se houver; comando preservado verbatim). **+1 teste** (`parseRunArgs` com e sem `--`).
- **`install --help` não listava `--allow-degraded`**: o flag funcionava mas não era descobrível. Adicionado ao usage. 343 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.10.0] - 2026-06-26

### Truth-sync: o `dream audit` agora conhece o sprint entregue (PRD 12 PR1)
Reconcilia as promessas com a realidade — o auditor anti-placebo passou a listar o que o sprint PRD 12 entregou.
- **`dream audit` ganha 5 claims REAIS** com evidência verificada no código: **runtime-supervisor** (`dev`/`stop`), **secrets-broker** (keychain, sem `.env`), **runtime-manifest** (V2), **package-manager** (`doctor --package-manager`) e **full-contract** (`--allow-degraded`). Resultado: **8 REAL / 3 PARTIAL / 0 PLACEBO / 0 ROADMAP / 1 RISK** (Output Guard segue RISK honesto — auditoria pós-resposta, sem intercept pré-render).
- **README:** corrige a claim **factualmente errada** "ECC2" → **ECC** (`ecc-universal`; ECC2 era vaporware/404 que auditamos) e aponta segredos para o **broker** (keychain), não `.env` em claro.
- **+5 asserts** no teste do audit travam os novos claims como REAL. 342 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.9.0] - 2026-06-26

### Contrato Full sem degradação silenciosa (PRD 12 §11, P1-#7)
"Full = tudo" não termina mais como **concluído** se um componente do completo falhou em silêncio.
- **Novo `src/installer/full-contract.js`** (puro/testável): `trackDegraded(report, comp, reason)` (dedup por componente) + `evaluateFullContract({degraded, projectOnly, auditOnly, skipDeps, allowDegraded})` → `{block, isFull, message}`. Regra: no modo **Full**, qualquer componente degradado **BLOQUEIA** (exit 1); Lite/project-only/audit-only **toleram** (só avisam).
- **`install` rastreia o degradado** em vez de só `warn`-and-continue: **gbrain, graphify, ECC, headroom** (binário ausente após instalar) e **Obsidian app**. No fim, imprime "Contrato Full — componentes degradados" e **bloqueia** sem `--allow-degraded`.
- **Novo flag `--allow-degraded`**: aceita explicitamente o estado parcial (Full prossegue, marcado como DEGRADADO). Sem ele, o install sai com erro e remediação clara.
- Não afeta `--audit-only`/`--project-only` (retornam antes do gate / são tolerados). **+5 testes** (bloqueia/allow/ok/Lite tolera/dedup). 342 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.8.0] - 2026-06-26

### Secrets Broker real — keychain do SO, sem `.env` (PRD 12 §10, P0-B)
Sai do "lista de nomes" para um broker de verdade: o **valor** vive no keychain do SO e é injetado **só em memória** no serviço; o repo nunca vê segredo em claro.
- **Providers por SO** (`src/secrets/providers.js`): **Windows DPAPI** (cifra com a chave do usuário, externa ao arquivo — via PowerShell `ConvertFrom/ConvertTo-SecureString`), **macOS Keychain** (`security`), **Linux libsecret** (`secret-tool`). Valor sempre por **STDIN**, nunca em argv (não vaza na lista de processos). Detecção por sonda benigna (não `--version`).
- **Schema v2** (`src/secrets/schema.js`): `{schemaVersion:2, provider, required:[{name,scope,services,sensitive}], optional}`. Migra o v1 (lista de nomes) automaticamente. `create` agora gera o v2; `required[].services` = allowlist de quem recebe cada segredo.
- **Broker** (`src/secrets/broker.js`): namespace por projeto (hash do path), índice de **nomes/metadados** (`names.json`, **nunca valores**), resolução em memória, `redact()` p/ logs, `parseDotEnv` p/ import.
- **`gstack_vibehard secrets <doctor|list|set|delete|import|run>`**: `set` sem echo (ou `--stdin`); `list` **nunca** mostra valor; `import .env` guarda no keychain e oferece renomear o `.env`; `run -- <cmd>` injeta só os requeridos em memória.
- **`dev` consome o broker**: resolve os `secretRefs` declarados do keychain (precedência sobre o shell; fallback honesto sem broker) e injeta só ao serviço dono.
- **`.env` NÃO é mais exposto ao Atomic** (`workspace.toml`) e o template/README passa a orientar `secrets`, não `cp .env.example .env`.
- **+5 testes** (migração v1→v2, parseDotEnv, broker com provider fake, índice sem valor, resolve só declarados, redação). 337 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.7.3] - 2026-06-25

### Correção: manifest/config com BOM era ignorado em silêncio no Windows (PRD 12 PR4)
Reconfirmação numa máquina Windows limpa expôs: `gstack_vibehard dev` dizia "Sem manifest de runtime" mesmo com o `.gstack/runtime.json` presente.
- **Causa real:** o PowerShell 5.1 (`Set-Content -Encoding utf8`) e vários editores no Windows gravam UTF-8 **com BOM** (EF BB BF). Os leitores faziam `JSON.parse(readFileSync(...))` sem remover o BOM → `JSON.parse` lançava no `﻿` inicial → o `catch` engolia → o arquivo era tratado como **ausente/ilegível** em silêncio.
- **Fix de raiz:** novo `src/util/json.js` com `stripBom`/`readJsonFile` (no-op em arquivo limpo — seguro). Aplicado nos leitores dos arquivos que o usuário edita à mão: **runtime manifest** (`runtime.json`/`services.json`), state do supervisor, **resolver de package manager** (`package.json`/`app.json`) e **project-plan** (`state`, `detect-profile`, `verify-runner`).
- **+2 testes** (stripBom no-op/início; `loadRuntimeManifest` lê manifest COM BOM). 332 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.7.2] - 2026-06-25

### Endurecimento do Runtime Supervisor — 2 P0 de segurança + 4 P1 (PRD 12 PR4)
Auditoria externa pegou abusos que o smoke/CI de *funcionalidade* não cobriam. Reproduzi os 6, corrigi e blindei com testes de **abuso** (não só de feature).
- **[P0] Vazamento de `process.env`** — `dev` passava `{...process.env}` ao serviço e gravava `{...s}` (com env) no state. Agora o serviço só recebe **base OS-essencial + porta + segredos DECLARADOS em `secretRefs`** (allowlist), e o state file é gravado por **whitelist de campos** (`pickState`) — **env/segredo nunca vão a disco**. Reproduzido vazando `GSTACK_FAKE_SECRET` antes; sumiu depois.
- **[P0] Path traversal pelo nome do serviço** — nome `../../../x` escrevia fora de `.gstack/runtime`. Agora `validateRuntimeManifest` **rejeita** nome fora de `[A-Za-z0-9._-]`/com `..` (1ª defesa: `dev` para antes do disco) e `writeServiceState` valida nome + **contém o caminho** no runtime dir (`assertWithin`, defesa em profundidade).
- **[P1] Spawn de binário inexistente derrubava o CLI** — `Unhandled 'error' event` + exit 1. Agora o `dev` aguarda o desfecho do spawn (`'spawn'` vs `'error'`) de forma determinística → serviço vira `status: failed` honesto, **sem crash**.
- **[P1] `dev` duplicado orfanava processos** — `clearState()` rodava antes de checar execução viva. Agora o `dev` **recusa** se já há runtime vivo (`isAlive` via signal 0); `--force` reinicia parando o antigo primeiro.
- **[P1] `stop` não validava dono do PID** — pid reusado/state adulterado podia matar processo alheio. Agora valida a **idade real do processo** (tz-free: `Get-Process`/`ps -o etimes=`) vs a registrada → foreign é **pulado** (`skipped-foreign`), não morto. Fallback honesto quando não dá pra ler.
- **[P1] readiness aceitava 4xx como saudável** — `pollReadiness` agora só **2xx/3xx** = pronto; 4xx/5xx = `unhealthy`.
- **+15 testes de abuso** (env-allowlist, state-whitelist, traversal rejeitado, dono-do-PID, isAlive, readiness 4xx, spawn-no-crash e2e, dev-idempotente e2e). 330 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.7.1] - 2026-06-25

### Correção: `stop` vazava processo no Linux (PRD 12 PR4 — pego pelo CI)
O CI (ubuntu) pegou o que o smoke no Windows não podia: o `stop` da v3.7.0 **não matava** os serviços no Linux.
- **Causa real:** no POSIX o `stop` rodava `kill -TERM -<pid>` via **binário**; o `kill` do **util-linux** (Linux) **sai 0 sem matar** quando recebe `-<pid>` como grupo (só o `kill` BSD do macOS aceitava). Resultado: `stop` reportava "stopped" mas o processo seguia de pé.
- **Fix:** no POSIX o `stop` agora usa o primitivo **nativo** `process.kill(-pid, "SIGTERM")` (syscall direta no **grupo** de processos — o `dev` sobe `detached`, então o pid é líder do grupo). Sem dependência do binário `kill`. Windows segue com `taskkill /T /F` (árvore). **O `exec` só é injetado no Windows.**
- **Teste e2e robusto:** lê a porta/status **reais** do state (`.gstack/runtime/web.json`) em vez de assumir a `preferred` (que colide no CI). **+1 unit** do caminho POSIX nativo (mata o grupo via `-pid`, nunca o binário).
- Sem mudança no shipado fora do `stop`/teste. 321 Node + 58 Python verdes; lint/syntaxcheck; pack smoke OK.

## [3.7.0] - 2026-06-24

### Runtime Supervisor — `dev`/`stop`/`logs`/`open` (PRD 12 PR4 — o motor)
Sobe e derruba os serviços do projeto a partir do Runtime Manifest V2 (PR3). Sem shell, sem race de porta, mata a **árvore** de processos.
- **Novo `src/runtime/ports.js`:** `isPortFree`/`allocatePort` por **bind real** em `127.0.0.1` (sem race — quem aloca já segurou a porta); injetável para teste.
- **Novo `src/runtime/supervisor.js`:** lógica **pura/injetável** — `planStart` (manifest → plano de spawn com **argv** e env de porta, **sem shell**), `killTreeCommand` (Windows `taskkill /T /F`; POSIX `kill -TERM -<grupo>`), `stopAll` idempotente, `pollReadiness` HTTP, state por serviço em `.gstack/runtime/`.
- **`gstack_vibehard dev [--open] [--json]`:** sobe cada serviço **detached** (sobrevive ao launcher), redireciona stdout/stderr para `.gstack/runtime/logs/<svc>.log` (fd numérico — não WriteStream), aloca porta, aguarda readiness e marca `ready`/`unhealthy` honestamente.
- **`stop`** encerra a árvore e limpa o state (idempotente); **`logs [svc]`** mostra o log; **`open`** abre o preview web.
- **`.gstack/runtime/`** entra no `.gitignore` do template (state local, não versionado).
- **+9 testes** (8 unit de ports/plan/kill/stop/readiness/state + **1 e2e real**: sobe um http server de verdade, prova que sobrevive ao `dev` e que o `stop` mata). 320 Node + 58 Python verdes; lint/syntaxcheck limpos; pack smoke OK.

## [3.6.0] - 2026-06-24

### Runtime Manifest V2 + `runtime status` (PRD 12 PR3 — fundação do supervisor)
Evolui os manifests que o `create` já gera (não cria formato concorrente) para o contrato que o supervisor (`dev`, PR4) vai consumir.
- **Novo `src/runtime/manifest.js`:** `buildRuntimeManifest`/`migrateServiceToV2`/`validateRuntimeManifest`/`loadRuntimeManifest`. Schema **v2**: `command` sempre em **array** (sem shell string), `port.autoAllocate`, `health.readiness`+`liveness`, `restart` com circuit breaker, `dependsOn`, `secretRefs`. Migra o v1 (`services.json`) automaticamente.
- **`create` grava `.gstack/runtime.json`** (v2) junto dos manifests existentes.
- **Novo `gstack_vibehard runtime status [--json]`:** lê e **valida** o manifest declarado (o que o `dev` vai subir), com checagem honesta (`válido`/`INVÁLIDO`). `dev/stop/logs/open` respondem `pending_feature` até o PR4 (supervisor).
- **Sem motor ainda** (supervisão de processo é o PR4). **+5 testes** (tokenize/migração/build/validação/load). 311 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.5.0] - 2026-06-24

### `doctor --package-manager` — resolver único de npm/pnpm (PRD 12, sprint 1)
Primeiro PR do PRD 12 (PR2). Resolve a dor real que vivemos nesta jornada (corepack `EPERM`, pnpm ausente, `node_modules` pnpm com `package-lock` npm).
- **Novo resolver** (`src/installer/package-manager.js`): detecta o PM por prioridade — `packageManager` do package.json → lockfile versionado → `.gstack/app.json` → layout de `node_modules` → fallback npm. Retorna **estado honesto**: `ok | missing_binary | lockfile_conflict | node_modules_mismatch`, com reparo seguro por estado.
- **`gstack_vibehard doctor --package-manager` (`--pm`)**: reporta o estado; `--json`/`--strict` p/ automação. **`--fix`** instala o **pnpm ausente** via `npm install -g pnpm` (com confirmação; `corepack` precisa de admin no Windows). **Nunca apaga lockfile/node_modules automaticamente** — conflito/mismatch exigem confirmação manual.
- Já flagra o mismatch do próprio repo (`package-lock.json` + `node_modules/.pnpm`).
- **+6 testes** (todos os estados do resolver, io injetado). 306 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.4.2] - 2026-06-24

### Correção honesta do encoding no pipe (o fix do v3.4.1 não funcionava)
- **[honestidade] o `chcp` no pipe do v3.4.1 NÃO consertava o mojibake** e foi revertido para só-TTY. Motivo real (validado na máquina): o PowerShell **cacheia `[Console]::OutputEncoding` no startup** (codepage OEM) e um `chcp` rodado por **subprocesso** não muda esse cache — então `gstack ... | Select-String` continua distorcendo. O **render DIRETO** (uso normal) está **perfeito** (confirmado: banner e `✓` legíveis). Para pipe, o usuário roda uma vez na sessão: `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8`.
- **[confirmado] `install --yes` instala o ECC com segurança** — o `postinstall` do `ecc-universal` é apenas um `echo` (não auto-injeta skills no `~/.claude`); o `ecc` é um CLI **instalador** (sem `--version`), consumido on-demand. Alinha com o contrato b+c (gstack dono do namespace, ECC como biblioteca).
- Sem mudança de teste (revert + doc honesta). 300 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.4.1] - 2026-06-24

### Polimento pós-validação na máquina real (encoding no pipe + ECC no install)
- **[encoding] `chcp 65001` agora roda MESMO quando a saída é canalizada** (`gstack ... | Select-String`): antes pulava se não-TTY, e o PowerShell relia a saída nativa como OEM → mojibake no pipe. A codepage é do console (compartilhado), então trocá-la conserta também o pipe. Render direto já estava legível (confirmado na máquina); agora o pipe também.
- **[Full = tudo] `install --yes` instala o ECC global** (`ecc-universal`, binário `ecc`) — antes só o `create --full` o instalava, deixando `ecc` ausente após um `install` puro. Consistente com gbrain/graphify/headroom; pula se já presente.
- **+1 teste de guarda** (install instala ecc-universal). 300 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.4.0] - 2026-06-23

### `/start` como ponto de entrada guiado (PRD 11 Fase 4 — fecha o roadmap)
- **Nova skill `/start`** (`skills/skills/start/SKILL.md`, `trigger: /start`): a porta de entrada do gstack — objetivo → plano → execução, mapeando para `gstack_vibehard start`. O usuário comum não precisa decorar a CLI.
- **`/start` surfaçado PRIMEIRO** no guidance de cada harness (Claude, Codex, OpenCode) — antes de `/newproject`, com o rótulo "PONTO DE ENTRADA — use primeiro". No completo, `/start` oferece a instalação completa; no lite, explica o caminho enxuto.
- **+2 testes** (skill /start com trigger; ordenado antes de /newproject nos 3 harnesses). 299 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.3.2] - 2026-06-23

### Output legível no PowerShell legado (fim do mojibake) — PRD 11 Fase 4 (P2)
- **No Windows TTY, o gstack troca a codepage do console para UTF-8 (`chcp 65001`) no startup** — conserta de uma vez TODO o output (banner `╔══╗`, `✓`, `—`, …) que aparecia como mojibake (`ÔòöÔòÉ`, `Ô£ô`) no Windows PowerShell 5.1. Só em TTY, ignora erros, pula terminais que já são UTF-8 (Windows Terminal/VSCode).
- **Fallback ASCII:** se a codepage não puder ser trocada (ou via `--ascii`/`GSTACK_ASCII=1`), o banner usa moldura ASCII (`+---+`/`|`/`-`) em vez de box-drawing — sem depender de UTF-8.
- **+1 teste** (banner ASCII sem box-drawing). 297 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.3.1] - 2026-06-23

### MCP global + app Obsidian no modo completo (PRD 11 Fase 3 parte 2 — "Full = tudo")
- **[P0] MCP global agora é escrito no completo** (`install.js`): antes era opt-in (`--global-mcp`); agora o `install --yes` escreve os MCP servers do gstack em `~/.mcp.json` por padrão (alinha o preflight, que já declarava o Headroom escrevendo lá). **Opt-out: `--no-global-mcp`.** `project-only`/lite **nunca** escrevem.
- **App Obsidian no completo:** quando não detectado, o Full **tenta instalar o app** (`winget install Obsidian.Obsidian` no Windows / `brew install --cask obsidian` no mac) — reportado honesto, **degraded** se não houver winget/admin/cask (o vault em `~/gstack-vault` é markdown e abre em qualquer editor). **Opt-out: `--no-obsidian`.**
- **+2 testes de guarda** (MCP opt-out; Obsidian winget + opt-out). 296 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.3.0] - 2026-06-23

### Status honesto por componente no `create --full` (sem ✓ falso)
PRD 11 Fase 3 (parte 1): o Full deixa de dizer "✓ configurado" para componentes que **não instalaram** na máquina.
- **`bootEcc2`/`initAtomic`/`bootAgentMemory` retornam status real** (`installed | degraded | skipped`) em vez de void; `startCasdoor` vira `online | degraded`. O `create --full` imprime um resumo **"Componentes do Full (status real nesta máquina)"** com ✓/⚠ por item — se faltou Docker (Casdoor) ou Rust (Atomic), aparece **`degraded`** com o reparo, não um check falso. Removido o phantom `phases.daemons: "configured"`.
- **Honestidade:** Git e o projeto seguem funcionais mesmo com componentes degraded; o Full não mente que subiu tudo.
- **+1 teste** (phases com status real; sem "daemons configured" falso). 294 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.2.1] - 2026-06-23

### ECC como biblioteca on-demand (decisão b+c) + AgentShield no `verify`
Decisão de produto: o gstack é **dono** do seu namespace (skills/hooks/agentes em `gstack-vibehard/`) e consome o ECC como **biblioteca on-demand** — **sem** injetar o perfil do ECC (evita clobber das 261 skills do ECC sobre as do gstack).
- **`create --full`** reenquadra a mensagem do ECC: instala o pacote `ecc-universal` (binário `ecc`) e **não** roda `ecc-install --profile full` automático; surfaça as capacidades on-demand (`ecc`, `npx ecc-agentshield scan`). Confirmado que `ecc-universal@2.0.0` expõe os bins `ecc`/`ecc-install`/`ecc-control-pane` e que `ecc-agentshield@1.4.0` é pacote npm real.
- **Novo `verify --agentshield`** (ou `GSTACK_AGENTSHIELD=1`): roda o **ECC AgentShield** (scan de prompt-injection) no `CLAUDE.md`/`AGENTS.md` como camada **advisory e não-bloqueante** — gstack consumindo o ECC como biblioteca, com skip gracioso se indisponível (não vira dependência dura do gate).
- **+3 testes** (AgentShield advisory / falha-não-bloqueia / opt-in). 293 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.2.0] - 2026-06-23

### 🧭 Alinhamento do ECC e do Atomic VCS à realidade (fim do "ecosystem drift")
A auditoria das fontes provou que dois componentes do modo completo estavam apontando para **vaporware** (repos/domínios que não existem). Fontes reais (passadas pelo dono) integradas:
- **[fix] ECC** — o `bootEcc2` (`create.js`) clonava `github.com/gstack-dev/ecc2` (**404**) e compilava um daemon Rust via cargo — dependência fantasma que travava o `create --full`. O ECC real é o pacote npm **`ecc-universal@2.0.0`** (otimizador de performance de harness: agents/skills/hooks/AgentShield; binário `ecc`); o daemon `ecc2` é só protótipo alfa in-tree. Agora instala via `npm i -g ecc-universal` (pula se `ecc` já existe); perfil completo opcional via `npx ecc-install --profile full`.
- **[fix] Atomic VCS** — o `initAtomic` baixava de `atomic-vcs.dev` (**domínio morto, não resolve**). Fonte real: **`github.com/atomicdotdev/atomic`** (Rust) → `git clone` + `cargo install --path atomic-cli` (usa o Rust que o gstack já instala). Removido `atomic-vcs.dev` da allowlist de downloads.
- **[fix] `monitor`** não depende mais de `ecc2 daemon status` (binário fantasma) p/ o orçamento de tokens — usa `GSTACK_TOKEN_BUDGET`/default, sem chamar daemon inexistente.
- **Coerência:** `app.json` `controlPlane` vira `ecc-universal`; AGENTS.md e o script de dev deixam de prometer "ECC 2.0 Daemon (dashboard/sessions)" → "Harness Optimizer: ECC". **Lite intocado.**
- **+2 testes de guarda** (ECC=ecc-universal sem gstack-dev/ecc2; Atomic=atomicdotdev/atomic sem atomic-vcs.dev). 290 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.1.5] - 2026-06-23

### graphify instala global (token-saver) + fim do pacote fantasma cli-anything-hub
- **[fix] graphify agora INSTALA de verdade, global** (`install.js`): o pacote PyPI é **`graphifyy`** (dois "y"; o CLI continua `graphify`) — por isso `uv tool install graphify` dava **E404**. Agora `uv tool install graphifyy` instala o indexador AST por commit pra **qualquer projeto** (economiza muito token: a IA lê a topologia do código sem gastar contexto). Pula se já presente; honesto se uv faltar. Fonte: `github.com/safishamsi/graphify`.
- **[fix] removido o pacote fantasma `cli-anything-hub`** — `npm install -g cli-anything-hub` dava **E404** porque o pacote **nunca existiu**. O recurso real é o **Printing Press** (gerador de CLIs em Go), que o gstack já integra via `gstack_vibehard tools` (catálogo `@mvanhorn/printing-press-library` → compila `cli-printing-press` sob demanda). Sem mais 404 no install; o install aponta o caminho real.
- **+2 testes** (guarda de regressão dos nomes: `graphifyy` ✓, sem `cli-anything-hub`). 288 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.1.4] - 2026-06-23

### Robustez/honestidade do install no Windows (PRD 11 — Fase 1)
- **[P0] template `postinstall` quebrava o `pnpm install` no Windows** — era `fallow coverage setup … || true`, mas `|| true` é shell Unix (o `true` não existe no `cmd.exe`) → `ELIFECYCLE exit 1`. Agora é `node scripts/postinstall-fallow.mjs` (cross-platform): roda o fallow **se existir** e **sempre sai com exit 0** (opcional, nunca falha o install do projeto).
- **[P1] `install --yes` não pergunta mais o harness** — antes, num PowerShell interativo o prompt "Instalar em quais harnesses?" aparecia mesmo com `--yes`. Agora `--yes` (modo completo) seleciona **todos os detectados** sem prompt; para subconjunto, `--harness <id>`.
- **[P0] preflight de MCP coerente** — o preflight dizia "MCP global: NÃO será escrito" enquanto o Headroom configura `~/.mcp.json`. Agora é honesto: no completo declara **"Headroom configura `~/.mcp.json`"** + estado dos MCP servers do gateway (`--global-mcp`); em `project-only`, nada.
- **+2 testes** (postinstall: referenciado sem `|| true` e sempre exit 0). 286 Node + 58 Python verdes; lint/syntaxcheck limpos; heavy smoke (pnpm install + turbo build) OK.

## [3.1.3] - 2026-06-23

### 🪟 `refreshPath` quebrava o `cmd.exe` no meio do install (root cause do ENOENT)
- **[fix] causa-raiz:** `refreshPath()` (`install.js`) **substituía** o `process.env.Path` pelos valores crus do registro — que guardam `%SystemRoot%\system32` **não-expandido** (REG_EXPAND_SZ). Resultado: depois dele, o PATH perdia o **System32**, e qualquer spawn de `cmd.exe` dava `spawnSync cmd.exe ENOENT` (foi o que sobrou no `cli-anything-hub`, que roda **depois** do `refreshPath`; o playwright passou porque roda antes). Agora `refreshPath` **expande `%VAR%` e MESCLA** com o PATH atual (novo `mergeWindowsPath`, dedup case-insensitive) — nunca perde o System32.
- **Blindagem extra:** `npmArgv`/`npxArgv` passam a usar o caminho **absoluto** do cmd.exe (`process.env.ComSpec`), robusto mesmo se algo mexer no PATH.
- **+1 teste** (`mergeWindowsPath` expande/mescla/dedup) e `npm/npxArgv`/printing-press atualizados p/ ComSpec. 284 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.1.2] - 2026-06-22

### 🪟 Robustez do `install` no Windows (3 falhas reais que o install do dono expôs)
- **[fix] `graphify` parava de dar erro espúrio** (`install.js`): o passo fazia `uv tool install graphify`, mas **graphify não é pacote PyPI** → falhava SEMPRE com `No solution found... no versions of graphify`. Agora **pula se o binário já existe** (`findWorkingBinary`) e, se não, dá mensagem honesta (opcional) — sem o erro de resolução confuso.
- **[fix] `npm`/`npx` no Windows davam `spawnSync ENOENT`** — `execFileSync("npm"/"npx", …)` sem `.cmd` não acha o binário no Windows. Novo helper `npmArgv` (espelha o `npxArgv`) e uso cross-platform (`cmd.exe /c npm`/`npx`) em: `cli-anything-hub` (`install.js`), `connectAgentMemory` e `installGraphifyGitHooks` (`agent-distribution.js`). Agora a skill `cli-anything-hub` e a distribuição AgentMemory **instalam no Windows**.
- **+1 teste** (`npmArgv` win/unix) e assertions de comando agora cross-platform via `npxArgv`. 283 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.1.1] - 2026-06-22

### 🏗️ O template fullstack agora COMPILA (turbo build verde) + CI o garante
- **[fix] o template `fullstack-monorepo` não compilava** com `turbo build` — um usuário que rodava `create` + build levava erro na cara. Endurecido até **`Tasks: 4 successful, 4 total`** (web + api + api-fastify + api-hono), verificado num scaffold limpo do zero. Correções:
  - **`packageManager: pnpm@10.33.0`** no root (turbo 2.x exige p/ resolver os workspaces).
  - **deps faltando declaradas:** `@radix-ui/react-slot`, `class-variance-authority`, `tailwindcss-animate` (web); `drizzle-orm` (api-hono).
  - **arquivos faltando:** `apps/web/src/vite-env.d.ts` (tipos de `import.meta.env`), `apps/api/src/openapi.ts` (era importado mas inexistente).
  - **imports errados:** `patterns/index.ts` (`../components/patterns/…` → `./…`), pattern→lib (`../../lib` → `../../../lib`), `index.css` (`./themes/…` → `./styles/themes/…`).
  - **tipos:** CORS do Hono (`|| false` → default localhost string), `eq(users.id, req.params.id as string)` (Express), `req.query as unknown as …` (ParsedQs), `FastifyError` no error handler, imports não usados em `schema.ts`.
- **CI agora roda o build PESADO** (`.github/workflows/test.yml` job `templates`): `corepack enable` + `GSTACK_TEMPLATE_INSTALL=1` → `pnpm install` + `turbo build` do fullstack lite, **bloqueante**. `scripts/test-templates.mjs` passou a usar **pnpm** (o PM real do monorepo), não npm.
- Sem mudança no runtime do instalador. 282 Node + 58 Python verdes; lint/syntaxcheck limpos; pack/template smoke OK.

## [3.1.0] - 2026-06-22

### `doctor --repair-manifest` — conserta manifest inseguro sem destruir backups
- **Novo `doctor --repair-manifest`** (`src/installer/repair-manifest.js`): repara/migra um manifest de instalação inseguro (o que deixava `safeToUninstall=false`) **sem precisar de uninstall/reinstall total**. Ações: **poda** entradas cujo arquivo rastreado sumiu (nada a desinstalar); **marca não-restaurável** a entrada cujo backup não existe mais (mantém a entrada — **NUNCA apaga backups do usuário**); **reporta** (sem tocar) config JSON inválido e drift; **normaliza** schema legado.
- **Seguro por padrão:** `--dry-run` (default) só mostra o **plano**, não escreve nada. `--yes` aplica — e antes faz **backup versionado do próprio manifest**. `--json` para automação; `--strict` sai ≠0 se há mutação pendente não aplicada.
- Reusa `checkInstallIntegrity`/`sha256` (`integrity.js`), `versionedBackup` (`safe-write.js`) e o manifest como fonte de verdade. Rodado na máquina real, já achou entradas mortas de runs antigas.
- **+3 testes** (dry-run não toca nada; apply poda/marca/preserva backups e melhora `safeToUninstall`; manifest ausente). 282 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.17] - 2026-06-22

### QG_VERSION sincronizado + gate de release (não publica QG stale)
- **[fix] `QG_VERSION` estava congelado em `"3.0.3"`** (`hooks/hooks/qg.py`) enquanto o package já estava em 3.0.16 → o `verify` reportava uma versão de Quality Gate **falsa**. Agora o `QG_VERSION` **espelha o `package.json`** e é sincronizado automaticamente.
- **Novo `scripts/sync-qg-version.mjs`** + hook de lifecycle `npm version`: todo bump reescreve a linha `QG_VERSION` (replace **ancorado de uma linha**, idempotente) e faz `git add` do qg.py. O humano nunca mais edita à mão. (O drift de **conteúdo** continua coberto pelo `qg_hash` do próprio qg.py.)
- **Gate HARD no `publish-guard`** (`src/project-plan/publish-guard.js`): novo check `qg-version` **bloqueia o release** se `qg.py` divergir do `package.json` (rede de segurança contra edição manual / falha do sync / merge torto). `not_applicable` se o qg.py não existir (outro repo).
- **+6 testes** (sync: reescreve/idempotente/erro-loud; gate: match/mismatch-HARD/not_applicable). Suítes Node+Python verdes; lint/syntaxcheck limpos.

## [3.0.16] - 2026-06-22

### 🔒 Correção de segurança: `.gitignore` gerado em runtime (`.env` fora do git)
- **[SEGURANÇA] `create` gera um `.gitignore` próprio** (`src/cli/create.js`, em `writeRuntimeFiles`): como o v3.0.15 passou a rodar `git init` automaticamente, o projeto nascia como repo git **sem `.gitignore`** → um `git add -A` estagiava `node_modules` e, pior, o **`.env` com secrets**. Causa-raiz: o **npm faz strip de qualquer arquivo `.gitignore`** do tarball publicado, então o `.gitignore` do template **nunca chegava ao usuário** (verificado: ausente nos 4 templates no pacote instalado). Agora o `.gitignore` é **gerado em runtime** (independe do strip), cobrindo **todos os templates e modos** (lite e full): ignora `node_modules`, `dist`/`build`/`.next`/`coverage`, `.turbo`/`.vercel`, **`.env` / `.env.*`** (mantendo `!.env.example`), `.gstack/*.local`. Validado fim-a-fim com `git add -A` real → `.env` **não** rastreado.
- **Removido o `.gitignore` morto do template** `fullstack-monorepo` (nunca era publicado — o npm o removia; causava divergência repo≠tarball). Fonte única agora é a geração em runtime.
- **[teste] `bootGit` com exec injetável (DI)**: o teste de `git init` voltou a ser **hermético** (`GSTACK_SKIP_SIDE_EFFECTS=1` + `gitExec` mockado) — não spawna mais git/graphify/headroom reais (corrige o teste não-determinístico do v3.0.15, que dependia de quais binários estavam no PATH).
- **+2 testes** (git init via DI; `.gitignore` protege `.env` em default **e** vertical). 273 Node + 58 Python verdes; lint/syntaxcheck limpos; pack/template smoke OK.

## [3.0.15] - 2026-06-22

### `create` lite nasce versionado (git) → graphify se instala sozinho
- **[melhoria] `create` (lite) agora roda `git init`** (`src/cli/create.js`, novo `bootGit`): o projeto lite nasce **versionado** — o VCS do lite já é o git (`app.json` `vcs: "git"`). O `git init` roda **antes** do `bootGraphify`, então o graphify instala os hooks de commit **sem precisar de `git init` manual**. Some a mensagem "`hook install` nao retornou — opcional". Padrão de scaffolders (create-react-app, Vite). Em **full** o VCS continua sendo o Atomic (sem `git init`).
- **Causa-raiz corrigida:** em lite o `projectDir` só era criado no scaffold (Fase 4), **depois** do `bootGraphify` — o graphify rodava sem repo/diretório e não retornava. Agora o diretório é garantido (`mkdirSync`) + `git init` antes do graphify.
- **Honesto e não-bloqueante:** se o git não estiver instalado, mensagem clara e o `create` segue sem versionamento (idempotente — pula se já houver `.git`).
- +1 teste Node (lite roda `git init` → `.git` existe + `app.json vcs:"git"`). 272 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.14] - 2026-06-20

### Reinstalação e atualização limpas na mesma máquina
- **`install` agora grava os hooks no MANIFEST** (`refreshHooks` usa `safeCopyFile` em vez de `copyFile`): todo hook instalado/refrescado é **rastreável** → o `uninstall` sempre os reverte. Fecha o gap que deixava a máquina com hooks instalados mas manifest ausente (uninstall incompleto).
- **Novo comando `gstack_vibehard update`** (`src/commands/update.js`): checa a versão instalada vs a última no npm e mostra o comando de atualização (1 linha, idempotente). `--run` atualiza de fato; `--json` para automação; degrada gracioso sem rede.
- **`install --reinstall`/`--force`**: reaplica hooks/config completos (via Safe Write + manifest) mesmo se "já instalado" — conserta install antigo sem desinstalar.
- **Script de aceitação versionado** (`scripts/clean-install-acceptance.ps1` + `.sh`, `npm run test:accept`): roda o veredito de instalação limpa (versão, `--help` seguro, `doctor`, `audit-only` sem escrita, `create` lite sem escrita global) e imprime **PASS/FAIL** por item — repetível a cada update. README documenta o ciclo de reinstalação/atualização.
- +3 testes Node (update: disponível/atualizado/offline). 271 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.13] - 2026-06-20

### Correções do teste de instalação real (máquina Windows do dono)
- **[BUG] `create` LITE escrevia no global `~/gstack-vault`** (`src/cli/create.js`): o bloco do vault Obsidian rodava sem gate de lite. Agora é **opt-in** (`--full` ou `--vault`); em **lite (padrão) o `create` não escreve NADA global** — só `./<nome>`. Cumpre a promessa do README/PR5. +teste com HOME temp (lite → 0 escrita em `~/gstack-vault`; `--vault` → criado).
- **[ruído] graphify/headroom**: `bootGraphify`/`bootHeadroom` deixam de tentar **baixar via `npx --yes`** e de logar o confuso "Graphify falhou (sem erro)". Agora **só rodam se o binário já estiver instalado**; ausente → mensagem honesta ("opcional, instale `graphify` para ativar"), sem fetch remoto, não-bloqueante.
- **[clareza] conflito OpenCode no `doctor`**: a mensagem deixa explícito que é **config pré-existente do usuário** (o gstack NÃO toca) e aponta o remédio de 1 comando: **`gstack_vibehard doctor --fix`** (merge assistido com backup; `--dry-run` mostra o plano).
- 268 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.12] - 2026-06-20

### README acessível e coerente com o código (docs)
- Reescrita do `README.md` adotando o tom acessível ("português de gente", tabela problema→solução, "para quem é", analogia, "como funciona na prática") **com claims 100% verificados no código**.
- **Correções de coerência:** todos os comandos usam **`gstack_vibehard`** (underscore — o sugerido usava hífen, que falharia); `create` descrito como **lite por padrão** (`--full` opt-in); test gate marcado como **opt-in** (`GSTACK_TEST_GATE`); RBAC **qualificado** com precisão (`GSTACK_USER_ROLE` viewer/developer/admin no Output Guard pós-resposta, não um RBAC corporativo); sem hipérbole ("não alucina").
- **Bug de manutenção corrigido:** a versão **deixa de ser hardcoded no título** (vinha dessincronizando a cada release) — fonte de verdade agora é o badge npm + CHANGELOG. Removido o bloco de changelog antigo (v2.1.x/v2.2.0) do README.
- Mantido o enquadramento "seguro no primeiro contato" (no-args = ajuda, `install --audit-only`, opt-in global, como desfazer) e toda a referência técnica de comandos com os flags reais. Sem mudança de runtime.

## [3.0.11] - 2026-06-19

### Template smoke + README 5-minutos (PR8 e PR9 do finalprd10.md — fecham o programa)
- **[PR8] `npm run test:templates`** (`scripts/test-templates.mjs`): valida os metadados de cada template (README, `.env.example`, scripts `dev/build/test` coerentes) e cria o **fullstack-monorepo em LITE end-to-end** (scaffold + `.gstack/app.json` mode=lite + `.env.example`). O `install+build` pesado é opt-in (`GSTACK_TEMPLATE_INSTALL=1`). Adicionado `README.md` ao template fullstack (documenta env e o caminho de 5 minutos; `.env.example` já existia).
- **[PR9] README orientado ao primeiro contato**: o topo agora ensina **"começar sem medo em 5 minutos"** (1º comando seguro, criar+rodar app lite, ativar em projeto existente, o que escreve global, como desfazer) — e corrige a **versão dessincronizada** (estava travada em 3.0.4). Histórico vai para o CHANGELOG; arquitetura fica abaixo.
- 267 Node + 58 Python verdes; lint/syntaxcheck limpos; pack smoke e template smoke OK.

> Com isto, os **9 PRs do finalprd10** estão entregues (v3.0.4 → v3.0.11): first-run seguro, help universal, doctor JSON, MCP opt-in, OpenCode plugins manifest-owned, create lite por padrão, política de download remoto, pack smoke, template smoke e README de adoção.

## [3.0.10] - 2026-06-19

### Pack smoke — prova o tarball npm, não a árvore-fonte (PR7 do finalprd10.md)
- **`npm run test:pack`** (`scripts/test-pack.mjs`): empacota (`npm pack --json`), **inspeciona o conteúdo** (falha se houver `node_modules`/`__pycache__`/`.pyc`/`.tgz`), **instala o `.tgz`** num projeto temp e chama o **bin instalado** (não a fonte): `--version`, `--help` (exit 0, sem "Comando desconhecido"), `doctor --json` (JSON puro) e `install --audit-only` (read-only). Cross-platform (npm via `cmd.exe` no Windows; bin via `node <pacote>/src/index.js`).
- **`clean-pkg` agora loga em stderr** (`scripts/clean-pkg.mjs`): não contamina mais `npm pack --json`.
- 267 Node + 58 Python verdes; **pack smoke OK** (698 arquivos, tarball limpo, bin instalado responde).

## [3.0.9] - 2026-06-19

### Política de download remoto — opt-in (PR6 do finalprd10.md)
- **Por padrão o gstack NÃO baixa nem executa scripts remotos** (`src/installer/remote-policy.js`): novo módulo com allowlist de origens HTTPS (`bun.sh`, `sh.rustup.rs`, `astral.sh`, `atomic-vcs.dev`, ...) e `checkRemoteDownload()`. Só executa com opt-in explícito (`--allow-remote-downloads` ou `GSTACK_ALLOW_REMOTE_DOWNLOADS=1`) **E** origem na allowlist.
- **`install` e `create` gateados**: os instaladores remotos (Bun/uv/Rust no `install.js`; Atomic VCS no `create.js`) agora **só rodam com `--allow-remote-downloads`** — caso contrário imprimem a instrução manual e seguem. Fecha o vetor `curl|sh` / `irm|iex` / `ExecutionPolicy Bypass` por padrão.
- **Guard test anti-regressão**: um teste varre `src/` e **falha** se algum arquivo fizer execução remota perigosa (`ExecutionPolicy Bypass`) sem passar pela `remote-policy`.
- +4 testes Node (allowlist HTTPS, default bloqueia/opt-in libera, env, guard). 267 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.8] - 2026-06-19

### `create` LITE e project-scoped por padrão (PR5 do finalprd10.md)
- **`gstack_vibehard create <nome>` agora é LITE por padrão** (`src/cli/create.js`): escreve **só `./<nome>`** — **sem** Casdoor (Docker), Atomic VCS, ECC2 daemon, AgentMemory federation **nem escrita global** (ex.: `~/.atomic`). Antes provisionava tudo por padrão.
- **`--full`** habilita o stack completo (Casdoor/Atomic/ECC2/...). `--lite` continua válido; em conflito `--lite` vence (mais seguro).
- **`create --dry-run [--json]`**: mostra o plano (modo, diretório, escritas project-scoped vs global, provisionamentos) e **não escreve nada**; `--json` puro.
- **`.gstack/app.json` reflete as capacidades reais**: `mode: lite|full`, e em lite `vcs:"git"`, `mcpGateway:null`, `controlPlane:null`, `iam:"none"` (não mais afirma Casdoor/Atomic/ECC2 que não existem).
- +2 testes Node (default lite só `./app`+mode lite; dry-run não cria diretório); teste do boot completo passa com `--full`. 263 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.7] - 2026-06-19

### OpenCode plugins manifest-owned + kill switch (PR4 do finalprd10.md)
- **Plugins do OpenCode agora são manifest-owned** (`src/harness/opencode.js`): a cópia dos 3 plugins (`gstack-security/session/prompt.js`) deixa de usar `cpSync(force:true)` e passa por **`safeCopyFile`** → backup versionado + registro no manifest. Plugin **novo** do gstack → `removeOnUninstall` (uninstall remove); plugin **homônimo do usuário** → backup + `restoreOnUninstall` (uninstall restaura o do usuário). Zero resíduo após uninstall.
- **Kill switch `GSTACK_OPENCODE_DISABLE=1`** (`src/plugins/opencode/*.js`): cada plugin retorna sem hooks quando a env var está setada — desliga o comportamento gstack no OpenCode em runtime sem desinstalar.
- +3 testes Node (3 plugins no manifest; backup/restore do homônimo; kill switch). 261 Node + 58 Python verdes; lint/syntaxcheck limpos; manifest real intacto.

## [3.0.6] - 2026-06-19

### MCP global opt-in no Codex (PR3 do finalprd10.md)
- **`install --yes` deixa de escrever `mcp_servers` do gstack no Codex** (`src/harness/codex.js`): o `mergeCodexConfig` agora só injeta os servidores MCP quando `mcp:true` (via `--global-mcp`/`--global`). Antes adicionava fallow/supabase/playwright/context7/etc. sempre — inclusive placeholders como `${SUPABASE_PROJECT_REF}`. Hooks e config do usuário continuam preservados.
- **`--mcp-server <name>`** (repetível ou CSV): com `--global-mcp`, escreve **só** os servidores escolhidos (ex.: `--global-mcp --mcp-server playwright` → só Playwright, sem placeholders de Supabase/Context7).
- `installCodex({ mcp, mcpServers })` + parsing de `--mcp-server` no `install.js`.
- +2 testes Node (opt-out default sem MCP; `--mcp-server` único) e testes existentes ajustados p/ a nova assinatura. 258 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.5] - 2026-06-19

### Doctor JSON + resiliência (PR2 do finalprd10.md)
- **`doctor --json` agora é JSON PURO** (`src/installer/doctor.js`): novo coletor `collectDoctorJson()` (determinístico, sem banner/prosa/ANSI) com versões, harnesses, componentes, MCP global, OpenCode, Playwright, deps, integridade e impacto. `--impact --json` e `--install-integrity --json` também retornam estruturado.
- **`doctor --strict --json`** → exit≠0 se um check obrigatório falha (Node/Python ausente ou manifest com problema).
- **EPERM/EACCES-safe**: todo scan de filesystem (incl. a pasta de browsers do Playwright) usa `safeReaddir` → vira **warning, nunca crash**.
- +4 testes Node (JSON puro, estrutura, EPERM-safe, strict exit≠0 com manifest problemático). 256 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.4] - 2026-06-19

### First-run seguro + help universal (PR1 do finalprd10.md)
Corrige as falhas de **primeiro contato** que faziam o CLI parecer arriscado:
- **`gstack_vibehard` sem argumentos NÃO instala mais** (`src/index.js`): mostra ajuda curta e sugere `gstack_vibehard start` (exit 0, zero escrita). Antes caía em `install` por padrão.
- **Help universal** (`src/cli/index.js`): `--help`/`-h`/`help`/`help <comando>`/`help advanced` e **`<comando> --help`** mostram ajuda e **nunca executam** o comando (ex.: `install --help` não instala mais). `--help` deixa de virar "Comando desconhecido".
- **Banner único**: o `help` não duplica mais o banner (removido o `logo()` redundante do `showHelp`).
- **`--no-color`** (e `NO_COLOR`): suprime as sequências ANSI — saída limpa p/ logs/pipes.
- **Ajuda em 2 níveis**: curta (start/create/init/status/enable/disable/doctor/verify/install/uninstall/help) + `help advanced` (tools/context/delegate/workflow/a2a/dream/proxy/monitor/publish-guard/...), com `<cmd> --help` por comando — tudo a partir de um **registro único** de comandos.
- +7 testes Node (no-args não instala/não escreve, help exit 0, banner único, install --help não instala, --no-color). 252 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.3] - 2026-06-19

### Ajuste Final P0 — QG consistente, verify rápido, audit read-only, E2E (PRD PRDAJUSTEFINAL.MD)
- **[P0.1] QG versionado + drift-aware + sem npx lento** (`hooks/hooks/qg.py`, `src/project-plan/verify-runner.js`): o `qg.py` ganha `QG_VERSION` e emite `qg_version`/`qg_hash` em **todo** caminho; resolve o Fallow preferindo **binário local** (`node_modules/.bin/fallow` → global → `npx` fallback), evitando o cold-start; modo `--strict`/`GSTACK_QG_STRICT=1` → Fallow ausente vira `tool_missing`/exit≠0 (nunca pass silencioso em CI/release). O `verify` agora reporta `qg={origin,path,version,hash}` e **detecta drift** entre o qg instalado e o **empacotado** → `qgDrift` + `ready_with_warnings` (não "ready" silencioso). `--profile release` roda o qg empacotado (consistência garantida).
- **[P0.2] `verify --quick` + cache** (`src/project-plan/verify-runner.js`, `src/commands/verify.js`): perfil `quick` (deps via checagem filesystem, lint, diff-hygiene, QG L1 advisory com timeout 15s) roda em **~8s** (era ~163s no full). Cache por fingerprint de arquivos (`.gstack/verify-cache.json`) → 2ª run sem mudanças = `cache_hit`. Perfil `release` torna o publish-guard bloqueante. `--json` puro no final.
- **[P0.3] `install --audit-only` literalmente READ-ONLY** (`src/installer/install.js`): por padrão **não escreve nada** (só stdout); `--save-report` grava o relatório e avisa o efeito.
- **[P0.4] E2E em HOME descartável** (`tests/e2e/safe-install.e2e.test.js`, `npm run test:e2e`, gated por `GSTACK_E2E_SAFE_INSTALL=1`): prova as invariantes de segurança — audit-only não escreve nada, `--save-report` grava exatamente 1 arquivo, `delegate --worktree` bloqueia `.env` rastreado, uninstall preserva drift (e só sobrescreve com `--resolve-drift`) — tudo num HOME temporário, sem tocar a máquina real.
- **[P0.5] Mensagem do `publish-guard`**: quando a tag da versão já existe, o `detail` orienta (nova release → bump; validação local → publish é advisory no verify).
- +9 testes (Node verify drift/quick/cache + Python qg strict/version + E2E). 245 Node + 58 Python verdes; lint/syntaxcheck limpos.

## [3.0.2] - 2026-06-19

### Fechamento de qualidade — auditoria 4 pontos (rumo ao 10/10)
- **[qg.py] Timeout robusto + JSON garantido** (`hooks/hooks/qg.py`): o Fallow agora roda via `Popen` em grupo/sessão própria; no timeout o gstack **mata a árvore inteira** (`taskkill /T` no Windows, `killpg` no POSIX) — antes o `--timeout` não cortava em cache frio do `npx` porque netos seguravam o pipe (trava >60s no Windows). Em timeout, o JSON de erro é **sempre** emitido.
- **[delegação] Staging por ALLOWLIST** (`src/delegation/worktree.js`): `commitWorktree` deixa de usar `git add -A`. Agora lista o `git status --porcelain` e adiciona **explicitamente** só os arquivos elegíveis (exclui `.env`, build/saídas, binários; mantém lockfiles). `isExcludedFromCommit` exportada e testada. Não força commit quando só há excluídos.
- **[autosave] `--no-verify` agora é OPT-IN** (`hooks/hooks/git_worktree_autosave.py`): por padrão **respeita os hooks de pre-commit**; só pula com `GSTACK_AUTOSAVE_NO_VERIFY=1`.
- **[README] Claims 100% alinhados ao código**: versão do topo atualizada; `delegate` **bloqueia** `.env` rastreado (antes dizia "avisa"); a afirmação de "`git add -A` removido / staging explícito" agora é **verdadeira** (delegação + autosave usam allowlist).
- +2 testes Node (allowlist staging; sem commit quando só excluídos). 241 Node + 56 Python verdes; lint/syntaxcheck limpos.
- Nota honesta: o `verify` usa o `qg.py` **instalado** (`~/.codex`/`~/.gstack`), que reflete o ambiente real do usuário; ele fica em sincronia com o pacote ao rodar `gstack_vibehard install` (atualiza hooks obsoletos). Itens do `dream audit` (Output Guard, Auto-dream, Zero-Trust) seguem honestamente como PARTIAL/RISK no roadmap.

## [3.0.1] - 2026-06-19

### Pacote npm estado-da-arte — sem artefatos Python no tarball
- O `files` (allowlist) incluía `__pycache__/*.pyc` gerados localmente sob `hooks/`/`src/` no tarball publicado (ruído inofensivo, mas não-limpo). Agora um hook **`prepack`** (`scripts/clean-pkg.mjs`) remove todo `__pycache__`/`.pyc`/`.pyo` automaticamente antes de cada `npm pack`/`npm publish` → o pacote sai **100% limpo, sempre**. Também exposto como `npm run clean`.

## [3.0.0] - 2026-06-19

### Safe & adaptive by default — flip do default do `install` (Fases 5–6, fecha o master plan)

**BREAKING CHANGES (instalação):**
- **`install` é preflight-first:** antes de qualquer escrita global, mostra o impacto por categoria e **exige confirmação**. Em modo **não-interativo** agora exige `--yes` (ou `--global`) — antes instalava direto. Migração: use `gstack_vibehard install --yes` (completa) ou `--project-only --yes` (impacto mínimo).
- **MCP global é opt-in:** o `install` **não escreve mais MCP global por padrão** — use `--global-mcp` (ou `--global`). Antes era escrito automaticamente. (Codex AC8.)

**Honestidade & docs (Fase 5):**
- `npm run syntaxcheck` (novo nome honesto; `typecheck` mantido como alias) — deixa claro que é checagem de **sintaxe ESM** (`node --check`), não TypeScript.
- README: seção de Safe Install (preflight/`--audit-only`/`--project-only`/`--harness`/`--global-mcp`), nota de honestidade dos scripts, ponteiros de auditoria/rollback.

**Fecha o master plan `entregafinal.md`:** AC1–AC8 do Codex cobertas; duas camadas (contexto/identidade + checks determinísticos por arquétipo) entregues; tudo testado de ponta a ponta sem tocar a máquina real (DI de `home`/`exec`), com a invariante de md5 do manifest.
- +1 teste Node (MCP opt-in no impacto). 240 Node + 56 Python verdes; lint/syntaxcheck limpos.

## [2.32.0] - 2026-06-19

### Delegação que não vaza segredo + uninstall que não perde sua edição (Fase 4)
- **[AC6] Commit delegado verificado** (`src/delegation/worktree.js`, `src/delegation/opencode.js`): o `commitWorktree` agora exclui do staging também **build/saídas pesadas** (`dist`, `build`, `.next`, `out`, `coverage`, `node_modules`) além do `.env`. Antes de marcar o branch como revisável, roda **`diff-hygiene` determinística** nos arquivos alterados; achado **HIGH** (segredo/`debugger`) → status **`needs_review`** (não `ok`), com os achados listados. `delegate` instrui a revisar antes de mergear.
- **[AC7] Uninstall drift-safe** (`src/installer/uninstall.js`): antes de restaurar um backup, compara o hash atual do arquivo com o `installedHash` do manifest. Se você **editou o arquivo depois da instalação**, o restore é **PULADO** (sua edição é preservada) — a menos de `gstack_vibehard uninstall --resolve-drift`.
- **`doctor --impact`** (`src/installer/doctor.js`): mostra os **componentes globais ativos** por categoria (hooks, config de harness, MCP global, skills/scripts, vault) e avisa o que afeta qualquer projeto; aponta o rollback.
- +6 testes Node (needs_review na delegação, drift-safe + resolve-drift, impacto). 239 Node + 56 Python verdes; lint/typecheck limpos.

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
