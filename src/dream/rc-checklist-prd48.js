/**
 * Checklist de Release Candidate do PRD48 (S48.7 — fechamento do programa).
 *
 * Mapeia CADA lacuna crítica do PRD48 §3.2 (P1.1–P1.6, P2.1–P2.2) ao sprint/versão que a
 * endereçou, com o artefato de prova. Espelha o padrão do `rc-checklist-prd47.js`.
 *
 * ACHADO HONESTO deste fechamento: as 8 lacunas têm infraestrutura REAL e testada
 * construída (S48.1-S48.6), mas duas continuam genuinamente abertas — P2.2 (ajuda
 * contextual geral, além de mensagens localizadas) nunca foi endereçada por nenhum
 * sprint, e o wiring INTERATIVO dos presenters/prompts dentro de `start.js`
 * (`confirmAndRunPipeline`) foi deliberadamente deferido em S48.4 pra não arriscar a
 * pipeline madura sem escopo dedicado — mesma cautela do PRD47. Por isso os itens que
 * dependem desse wiring ficam `partial`, não `delivered`.
 */
export const PRD48_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd48.v1"

// tier: P0 (bloqueador) | P1 (importante). status: delivered | partial | pending.
/**
 * ESTADO DECLARADO DA INTEGRAÇÃO CODEX (decisão humana, certificação 2026-08-02).
 *
 * A Camada 2 (descoberta/trust/enforcement pelo Codex real) NÃO pôde ser executada:
 * esta máquina é Windows 11 Home Single Language, sem Windows Sandbox
 * (`Containers-DisposableClientVM` inexistente) nem Hyper-V, e a tentativa de
 * isolar por variáveis de ambiente falhou — o binário Rust do Codex leu
 * `C:\Users\lucas\.agents` real mesmo com `USERPROFILE`/`HOME`/`CODEX_HOME`
 * redirecionados.
 *
 * ROTA ESCOLHIDA (2 de 2): adiar a prova externa para o FECHAMENTO do PRD52,
 * mantendo esta versão como BASELINE INTERNA. Enquanto a prova não existir,
 * nenhuma claim de enforcement de hooks no Codex é permitida.
 *
 * Este bloco existe para que o estado não precise ser inferido de prosa: ele é
 * legível por código e o teste o verifica.
 */
export const CODEX_INTEGRATION_STATE = Object.freeze({
  support: "partial",
  hook_enforcement: "unproven",
  security_claim: "advisory",
  blocker: "external_clean_machine_e2e",
  provenBy: "camada 1 — payloads sintéticos válidos contra os scripts (codex-cli 0.145.0)",
  notProven: "descoberta, trust, execução e enforcement pelo Codex; precedência hooks.json × config.toml; restauração no uninstall",
  reentryCondition: "Camada 2 A–F em máquina Windows limpa, restaurada a snapshot antes de cada rodada — desinstalar o GStack NÃO equivale a máquina limpa, justamente porque o objeto da auditoria são resíduos globais",
  targetMilestone: "fechamento do PRD52",
})

export const PRD48_RC_ITEMS = Object.freeze([
  // ACHADO P1 — exit code inconsistente sob `--json`.
  //
  // Registrado no LEDGER, não apenas em comentário de teste: comentário não é
  // registro durável de produto — some da vista, não entra em contagem derivada
  // e não bloqueia nada. Aqui ele conta como residual e aparece no DOD.8.
  //
  // Descoberto ao endurecer o contrato `--json` (commit 6cd11f9). A correção NÃO
  // foi autorizada nesta fase: o raio alcança todo comando da CLI e a política
  // (qual exit code para qual classe de erro) é decisão humana ainda não tomada.
  {
    id: "P1.CLI-JSON-EXIT-CODE", tier: "P1", sprint: "certificação RC", version: "5.107.0",
    status: "delivered",
    needsDecision: false,
    fixedOn: "2026-08-17",
    evidence: "src/index.js chama runCLI(...) e DESCARTA o retorno; comandos que devolvem {error:true} (prd, plan) saem com exit 0, enquanto outros caminhos chamam process.exit(1) diretamente (cli/index.js:306,394; init.js:28,38,47; sprint.js:53,98; create.js:1867)",
    impact: "automação não distingue erro por process exit status — um consumidor de máquina precisa parsear o JSON para saber se falhou; scripts que checam `$?` tratam erro como sucesso",
    affectedScope: "comandos que anunciam --json",
    fixAuthorized: true,
    title: "Exit code inconsistente sob `--json`: erro saía 0 em parte dos comandos — automação não distinguia falha pelo status do processo",
    /**
     * TRÊS CORREÇÕES, uma por commit, e a raiz é a mesma nas três: a superfície
     * de erro não respondia ao consumidor que a chamou.
     *
     *   context       a flag virava o posicional, e os ramos de recusa por
     *                 omissão eram INALCANÇÁVEIS
     *   research      erros de USO saíam em prosa ANSI sob `--json`, em 6 pontos
     *   task run      as 3 guardas de segurança saíam em prosa E com exit 0 —
     *                 a mais grave: recusa por `.env` rastreado lida como sucesso
     *
     * Em todas, o exit code passou a valer nos DOIS modos. A automação que não
     * usa `--json` merece o mesmo contrato de status, e deixá-la de fora seria
     * corrigir metade do problema.
     */
    fix: "`context`: `posicional(args)` pula flags e valores de flags; `ctxFail`/`scoutError` setam `process.exitCode`. `research`: `researchUsageFail` emite `gstack.research.usage-error.v1` nos 6 pontos de uso. `task run`: `taskRunFail` emite `gstack.task-run.refusal.v1` com `blocked:true`, separando recusa por guarda de falha de execução.",
    // `proof` e UM caminho, conferido em disco pelo guarda do checklist — juntar
    // tres num campo so faria a verificacao passar por string, nao por arquivo.
    // O de `task run` encabeca por ser a ocorrencia mais grave; os outros dois
    // ficam em `additionalProofs`, cada um tambem conferido.
    proof: "tests/task_run_json_contract.test.js",
    additionalProofs: ["tests/context_json_contract.test.js", "tests/research_json_contract.test.js"],
    /**
     * DOIS ACHADOS DA MESMA FAMÍLIA, encontrados ao escrever as provas públicas
     * de `context --json` e `research --json` na Fase 1B do PRD51.
     *
     * Ficam AQUI e não em item próprio porque a pergunta de fundo é a mesma que
     * este P1 já registra e ainda não tem resposta: qual é o contrato de um
     * comando sob `--json` quando a chamada está errada. Abrir item novo daria
     * aparência de três problemas independentes.
     *
     * Ficaram FIXADOS por teste no estado observado até a autorização humana de
     * 2026-08-17 — mudar parsing de argumento ou canal de erro é mudança de
     * comportamento público, e não classificação de mensagem. A correção veio
     * deliberada e visível, que era exatamente o objetivo de fixá-los.
     */
    relatedFindings: [
      {
        id: "P1.CLI-JSON-EXIT-CODE.a",
        title: "`context <sub> --json` consome a própria flag como argumento posicional",
        evidence: "src/commands/context.js lia o posicional como `args[1]` cru (ctxSearch, ctxRelated, ctxExplain, ctxScout). Com `context search --json` o termo de busca virava a string `\"--json\"`, e `context scout --json` respondia como se a flag fosse a pergunta — provado em tests/context_json_contract.test.js",
        impact: "os ramos de recusa por omissão (`missing query`, `missing entity`, `missing topic`, `pergunta obrigatória`) eram INALCANÇÁVEIS: só um argumento vazio explícito chegava neles. Um consumidor que chamasse `context search --json` recebia resultado de uma busca pelo literal `--json`, não um erro",
        fixAuthorized: true,
        status: "delivered",
        fixedOn: "2026-08-17",
        fix: "`posicional(args)` pula flags e os valores das que consomem argumento (`--max`, `--backend`, `--mode`, `--source`, `--kind`, `--since`, `--db`). Os quatro handlers passaram a usá-lo. `ctxFail` e `scoutError` passaram a setar `process.exitCode = 1` — nos DOIS modos, porque a automação que não usa `--json` merece o mesmo contrato de status.",
        proof: "tests/context_json_contract.test.js — 21 controles: recusa por omissão alcançada nos 4 subcomandos, flag com VALOR não confundida com posicional, exit != 0 na recusa e == 0 no sucesso, modo humano preservado",
      },
      {
        id: "P1.CLI-JSON-EXIT-CODE.b",
        title: "Erros de USO de `research` ignoram `--json` e respondem em prosa ANSI",
        evidence: "src/commands/research.js emite os erros de uso pelo canal humano mesmo sob `--json`: `research validate --json` sem claim e `research skills audit --json` sem `--path`/`--repo` escrevem texto colorido em vez de documento — provado em tests/research_json_contract.test.js",
        impact: "quem chama errado com `--json` recebe texto com escapes ANSI onde esperava um documento; o consumidor de máquina não tem como distinguir erro de uso de payload malformado",
        fixAuthorized: true,
        status: "delivered",
        fixedOn: "2026-08-17",
        fix: "`researchUsageFail(json, code, detail, exitCode)` emite documento puro `gstack.research.usage-error.v1` com `ok:false`, código estável e a frase que o humano já recebia. Aplicado aos SEIS pontos: audit sem fonte, validate sem claim, notebooklm query/import sem argumentos, notebooklm com subcomando inválido e o dispatcher sem subcomando — este último é o mais provável de um consumidor encontrar. `validate` mantém o exit 2 que já tinha: a correção muda o CANAL, não o contrato de status.",
        proof: "tests/research_json_contract.test.js — 18 controles: os 6 pontos com documento/código/exit próprios, ausência de escape ANSI no payload, e 3 controles de que o modo humano continua em prosa",
      },
    ],
  },
  // BLOQUEANTE DE SEGURANÇA DO RC (decisão humana, certificação 2026-08-02).
  // Este item sozinho impede publicação.
  //
  // ESCOPO PRECISO — o que foi provado e o que NÃO foi:
  //  - PROVADO: comportamento dos scripts com payload sintético VÁLIDO, em HOME
  //    descartável (codex-cli 0.145.0, /c/Users/lucas/AppData/Roaming/npm/codex).
  //  - NÃO PROVADO: descoberta, trust e enforcement em runtime pelo Codex
  //    (Camadas 2-4). NÃO chamar de exploração E2E até isso rodar.
  //
  // Três precisões que a revisão humana impôs sobre a leitura inicial:
  //  1. `PermissionRequest` SÓ participa quando o Codex pretende pedir aprovação —
  //     não é barreira universal. Por isso `PreToolUse` precisa proteger de forma
  //     INDEPENDENTE do permission mode; hoje não protege.
  //  2. `permission_request.py` não permite tudo por default: permite o que casa
  //     com SAFE_PATTERNS e NÃO decide o resto (provado: `comando-desconhecido-xyz`
  //     e `Get-Content .env` saem sem decisão). O defeito é a allowlist ampla.
  //  3. `UserPromptSubmit` fica INCONCLUSIVO: o HOME descartável não continha os
  //     SKILL.md referenciados, e o script só injeta contexto quando os encontra.
  //
  // Medição direta das listas (leitura estática, confirmada por execução):
  //   BLOCK_PATTERNS (PreToolUse): 9 padrões, só destruição de sistema. Passaram:
  //     `curl … | sh`, `wget … | bash`, `cat/type/Get-Content .env`,
  //     `echo > .env`, `apply_patch` em `.env`, MCP lendo `.env`.
  //   SAFE_PATTERNS (PermissionRequest) auto-aprova: `node `, `python3? `,
  //     `npm install`, `npm run`, `git push|pull`, `cat`, `type`.
  //   Cinco caminhos atravessam AS DUAS camadas: cat .env, node -e, python -c,
  //     npm install <pkg>, git push --force.
  {
    id: "P0.CODEX-SECURITY", tier: "P0", sprint: "certificação RC", version: "5.107.0",
    status: "pending", blocking: true,
    forbiddenClaim: "Zero-Trust / proteção real de PreToolUse no Codex",
    // Camada 2 impossível nesta máquina (Win 11 Home, sem Sandbox/Hyper-V).
    // Adiado para o fechamento do PRD52 — ver CODEX_INTEGRATION_STATE.
    externalE2E: "blocked_by_external_e2e",
    blockingReason: "Security policy bypass when Codex hooks are routed: PreToolUse allows secret access and arbitrary execution primitives while PermissionRequest auto-allows cat/type, node, python, npm install/run and destructive/network Git commands. Script-level behavior proven with synthetic payloads; Codex discovery, trust and runtime enforcement remain pending.",
    title: "Bypass de política de segurança com hooks do Codex roteados — PreToolUse não barreira independente + PermissionRequest com allowlist ampla",
    proof: null,
  },
  // BLOQUEANTE DO RC (decisão humana, certificação 2026-08-02). Provado em HOME
  // descartável (`--harness codex`), com o HOME real verificado intocado byte-a-byte.
  // Confrontado com a doc oficial (learn.chatgpt.com/docs/hooks, ex-developers.openai.com).
  {
    id: "P0.CODEX-HOOKS", tier: "P0", sprint: "certificação RC", version: "5.107.0",
    status: "pending", blocking: true,
    forbiddenClaim: "integração de hooks do Codex correta/governada",
    // Os DEFEITOS são provados por leitura de código e ciclo isolado; o que fica
    // pendente de máquina limpa é a validação do enforcement, não o defeito.
    externalE2E: "blocked_by_external_e2e",
    blockingReason: "Dois P0 provados em ambiente isolado. (1) `post_tool_use` é registrado apontando para `stop.py` (codex.js:64) — o hook de PostToolUse executa o stop hook, e existe `post_tool_use_review.py` que nunca é registrado; a doc oficial ainda diz que PostToolUse NÃO desfaz efeito, então o erro é puramente aditivo e silencioso. (2) `uninstall` remove os `.py` por NOME (uninstall.js:81) sem consultar ownership e nunca toca `hooks.json`: no teste isolado sobraram 5 de 6 referências apontando para scripts removidos — o ambiente fica pior do que antes de instalar. Agravantes: hooks não entram no manifest (0 itens `.py`), violando o invariante #9 do produto; e `mergeCodexConfig` escreve chaves `on_stop`/`on_session_start`/`pre_tool_use`/`post_tool_use` que NÃO existem na documentação oficial (os nomes são `Stop`/`SessionStart`/`PreToolUse`/`PostToolUse`).",
    title: "Integração de hooks do Codex: PostToolUse aponta para stop.py, uninstall deixa referências quebradas em hooks.json, hooks sem ownership no manifest e chaves TOML fora do contrato oficial",
    // `pending` NÃO declara proof: não existe prova de ENTREGA, existe prova de DEFEITO
    // (relatório do teste isolado em HOME descartável). O invariante do checklist é que
    // proof sustenta entrega — apontar um arquivo aqui seria exatamente o proof forjado
    // que o teste `sem proof forjado` proíbe.
    proof: null,
  },
  { id: "P0.1", tier: "P0", sprint: "S48.0", version: "5.29.0", status: "delivered", title: "Baseline pós-PRD47 comprovado por comportamento (readiness/skill governance/Golden Run/Context Delta reais) + 5 controles negativos", proof: "tests/prd48_baseline_contract.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S48.1/S51.7.1", version: "5.85.0", status: "delivered", title: "Primeiro uso fecha harness/modelo — detecção e perfil reais (tests/harness_session_profile.test.js); auth/modelo permanecem 'unknown' por design (nunca fabricado); prompt interativo REAL wired em start.js (PRD51 S51.7.1) — pergunta quando >1 apto, persiste só com consentimento explícito, lembra a preferência (não pergunta de novo)", proof: "tests/start_harness_intake.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S48.2", version: "5.31.0", status: "delivered", title: "Onboarding brownfield read-only — discovery real, 3 opções sempre, dirty tree nunca descartada", proof: "tests/brownfield_discovery.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S48.3", version: "5.32.0", status: "delivered", title: "Índice unificado de sessão — 1º produtor real de `sessions` no State Store, task history/inspect", proof: "tests/session_index.test.js" },
  { id: "P1.4", tier: "P1", sprint: "S48.4/S51.7.2", version: "5.86.0", status: "delivered", title: "Decisão de policy compreensível — decision-presenter.js real e testado, WIRED em `policy eval` (PRD51 S51.7.2), a superfície real onde um humano vê uma decisão; `categorizeTarget` fecha o elo que faltava (canPersistChoice era inalcançável sem categoria derivada de alvo real)", proof: "tests/decision_presenter.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S48.4", version: "5.33.0", status: "delivered", title: "Checkpoint como produto — task checkpoints/restore reais, restore com provenance append-only, tamper aborta sem gravar sucesso falso", proof: "tests/task_checkpoint_ux.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S48.5", version: "5.34.0", status: "delivered", title: "Contexto/quota/custo como decisão única — contrato de 4 qualidades tipadas, quota unknown nunca suficiente, budget nunca reservado 2x", proof: "tests/usage_accounting.test.js" },
  // DECISÃO HUMANA (certificação do RC, 2026-08-01): este item é BLOQUEANTE, não
  // adiável nem non-goal. A decisão de produto é English-first: toda a interface pública
  // determinística da CLI em inglês; `cliLocale` fixo em `en` neste RC (sem seletor
  // exposto); o idioma de CONVERSA com as LLMs é preferência separada
  // (`conversationLanguage`). JSON, schemas, enums, IDs, flags, comandos e exit codes
  // permanecem sempre em inglês.
  //
  // Medição real que sustenta o bloqueio: apenas 4 de 1.049 saídas ao usuário em
  // `src/commands/` (0,4%) passam pela infraestrutura de mensagens. A infraestrutura é
  // sólida e provada; a APLICAÇÃO é que não existe.
  { id: "P2.1", tier: "P1", sprint: "S48.6", version: "5.35.0", status: "partial", blocking: true, blockingReason: "Decisão English-first do RC: a CLI pública ainda é PT-BR. Apenas 4/1.049 mensagens usam a infraestrutura de i18n; migração exige plano aprovado antes de qualquer edição de código.", forbiddenClaim: "English-first CLI", title: "Idioma da CLI — infraestrutura real (catálogo+resolver+messageId) provada, mas só 4/1.049 saídas migradas; a CLI pública NÃO atende à decisão English-first", proof: "tests/cli_i18n.test.js" },
  { id: "P2.2", tier: "P1", sprint: "S51.7.3", version: "5.87.0", status: "delivered", title: "Ajuda contextual geral — forma compartilhada `safe-next-action.js` (`{failureId,humanText,command,safe}`) + retrofit nas 6 falhas REAIS (first-run bloqueado, plano inválido, pipeline handoff, proof reprovado, policy deny, design system ausente); controle negativo garante que nenhuma ação sugerida contorna gate", proof: "tests/safe_next_action.test.js" },
])

const byTier = (tier) => PRD48_RC_ITEMS.filter((i) => i.tier === tier)

/**
 * Prontidão de RC do PRD48. `ready` exige TODOS os P0 `delivered` (só há 1 P0 nesta
 * checklist — o baseline do S48.0). Os P1 abertos/parciais ficam registrados como
 * incremento honesto, sem enfeite.
 */
export function prd48Readiness(items = PRD48_RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => i.status !== "delivered")
  const p1Open = items.filter((i) => i.tier === "P1" && i.status !== "delivered")
  return {
    schemaVersion: PRD48_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: { p0: p0.length, p0Delivered: p0.length - p0Pending.length, p1: byTier("P1").length, p1Open: p1Open.length },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
