import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { join, relative, sep } from "path"
import { loadJsRegistry, isValidatedRegistry } from "./i18n-js-registry-loader.js"
import { AUDIENCES, isInScope } from "./i18n-audiences.js"

/**
 * Inventário de superfície de mensagem (PRD48 P2.1, Fase 1 da migração English-first).
 *
 * O que este módulo resolve: decidir, para ~1.792 pontos de saída, quais são mensagem
 * PÚBLICA do GStack (entram na claim English-first), quais são contrato de máquina,
 * quais são log interno e quais são conteúdo que não nos pertence. Fazer isso a olho,
 * caso a caso, garantiria inconsistência — e pior, inconsistência invisível.
 *
 * TRÊS REGRAS DE OURO, todas vindas da decisão humana no RC:
 *
 *  1. **Escopo de `scripts/` é DERIVADO do grafo de execução**, nunca de lista manual.
 *     Um script entra porque o runtime o alcança — se amanhã alguém passar a chamá-lo,
 *     o inventário muda sozinho. Lista manual envelheceria como o manual envelheceu.
 *
 *  2. **`templates/` não é excluído em bloco.** Template é artefato produzido pelo
 *     GStack e tem naturezas diferentes dentro do mesmo arquivo: copy do app gerado
 *     segue o idioma do projeto; mensagem técnica para o desenvolvedor nasce em inglês.
 *
 *  3. **Classificação é por EMISSOR/CANAL/CONDIÇÃO/CONSUMIDOR, nunca por conteúdo da
 *     frase.** Classificar pelo texto seria heurística sobre heurística — e é
 *     exatamente o que produz falso positivo em path, nome próprio e dado do usuário.
 *
 * `unknown` é um estado de PRIMEIRA CLASSE: uma escrita cuja audiência não pôde ser
 * determinada NUNCA vira "interna" por omissão. `unknown > 0` bloqueia a migração.
 */
export const I18N_INVENTORY_SCHEMA = "gstack.i18n-inventory.v1"

// O vocabulário mudou para `i18n-audiences.js` porque o loader do registry
// também precisa dele, e importá-lo daqui fecharia um ciclo ESM. Re-exportado
// para não quebrar nenhum consumidor existente.
export { AUDIENCES, isInScope }

// ── Grafo de execução ────────────────────────────────────────────────────────────
// Um script é RUNTIME quando o código publicado o alcança. Fonte: referências a
// `scripts/<arquivo>` dentro de `src/` (o que a CLI importa ou spawna) + os campos
// `bin` do package.json. `package.json.scripts` sozinho NÃO promove nada a runtime:
// é superfície de mantenedor/CI.
const SCRIPT_REF = /scripts[/\\]([A-Za-z0-9_.-]+\.(?:mjs|js|cjs|py|ps1|sh))/g

const SKIP_DIRS = new Set(["node_modules", ".git", ".gstack", "graphify-out", "coverage"])

const statSafe = (p) => { try { return statSync(p) } catch { return null } }
const listSafe = (d) => { try { return readdirSync(d) } catch { return [] } }

function walkFiles(dir, exts, out = []) {
  for (const name of listSafe(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSafe(p)
    if (!st) continue
    if (st.isDirectory()) walkFiles(p, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

const readSafe = (p) => { try { return readFileSync(p, "utf-8") } catch { return "" } }

/**
 * Scripts alcançados pelo RUNTIME. Derivado — se um script de mantenedor passar a ser
 * chamado por `src/`, ele aparece aqui automaticamente e entra no escopo da claim.
 */
// Comentários e strings de evidência NÃO são execução. A 1ª versão deste módulo contava
// qualquer menção textual a `scripts/x` e concluiu que 9 scripts eram runtime — inclusive
// um citado apenas dentro de um comentário. Isso é grep, não grafo. Só import estático,
// import dinâmico e spawn/exec REAIS promovem um script a runtime.
const stripCommentsAndDocstrings = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")

const REAL_IMPORT = /(?:import\s[^;]*?from\s*|import\s*\(\s*|require\s*\(\s*)["'`][^"'`]*scripts[/\\]([A-Za-z0-9_.-]+\.(?:mjs|js|cjs))["'`]/g
const REAL_SPAWN = /(?:execFileSync|execSync|spawnSync|spawn|fork)\s*\([^)]*?["'`][^"'`]*scripts[/\\]([A-Za-z0-9_.-]+\.(?:mjs|js|cjs|py|ps1|sh))["'`]/g

/**
 * Chaves de ciclo de vida do npm: rodam em `install`, `pack`, `publish`, `version` —
 * ou seja, DURANTE operações do usuário e do release. Um script citado aqui é executado
 * de verdade, mesmo que nenhum arquivo de `src/` o importe.
 */
export const NPM_LIFECYCLE_KEYS = Object.freeze([
  "preinstall", "install", "postinstall",
  "preuninstall", "uninstall", "postuninstall",
  "prepublish", "prepublishOnly", "postpublish",
  "prepack", "postpack", "prepare",
  "preversion", "version", "postversion",
])

/**
 * Raízes de execução, para além de `src/`. A 1ª conclusão deste módulo — "nenhum script
 * é runtime" — estava INCOMPLETA: olhava apenas import/spawn em `src/` e o campo `bin`.
 * `prepack` e `version` executam scripts durante empacotamento e versionamento, que são
 * operações reais do release; launchers e hooks Python também podem invocar.
 *
 * Ausência de import em `src/` não prova que o script não roda. Prova só que não roda
 * POR ALI.
 */
function rootsFromPackage(pkg) {
  const raizes = []
  for (const alvo of Object.values(pkg.bin || {})) raizes.push({ origem: "bin", cmd: String(alvo) })
  for (const chave of NPM_LIFECYCLE_KEYS) {
    if (pkg.scripts?.[chave]) raizes.push({ origem: `lifecycle:${chave}`, cmd: String(pkg.scripts[chave]) })
  }
  return raizes
}

/**
 * Scripts alcançados por EXECUÇÃO REAL, com a origem de cada um registrada.
 *
 * Fontes de raiz consideradas: `bin`, ciclo de vida do npm, launchers empacotados,
 * hooks Python e import/spawn em `src/`. Um script só entra com evidência de invocação
 * — nunca por menção em comentário ou string de evidência.
 */
export function runtimeReachableScripts(repoRoot = process.cwd()) {
  return Object.keys(runtimeScriptOrigins(repoRoot)).sort()
}

/** Mesma derivação, mas devolvendo POR QUE cada script é considerado alcançável. */
const originsFromSrc = (repoRoot) => walkFiles(join(repoRoot, "src"), [".js", ".mjs", ".cjs"]).flatMap((f) => {
  const code = stripCommentsAndDocstrings(readSafe(f))
  return [
    ...[...code.matchAll(REAL_IMPORT)].map((m) => [m[1], "src:import"]),
    ...[...code.matchAll(REAL_SPAWN)].map((m) => [m[1], "src:spawn"]),
  ]
})

const originsFromPkg = (repoRoot) => {
  const pkgPath = join(repoRoot, "package.json")
  if (!existsSync(pkgPath)) return []
  const pkg = JSON.parse(readSafe(pkgPath) || "{}")
  return rootsFromPackage(pkg).flatMap(({ origem, cmd }) =>
    [...cmd.matchAll(SCRIPT_REF)].map((m) => [m[1], origem]))
}

// Launchers e hooks são superfície EMPACOTADA e podem invocar scripts diretamente.
const originsFromPackagedDirs = (repoRoot) => ["launchers", "hooks"].flatMap((dir) =>
  walkFiles(join(repoRoot, dir), [".sh", ".ps1", ".bat", ".cmd", ".rb", ".py"]).flatMap((f) =>
    [...readSafe(f).matchAll(SCRIPT_REF)].map((m) => [m[1], `${dir}:invoke`])))

export function runtimeScriptOrigins(repoRoot = process.cwd()) {
  const pares = [...originsFromSrc(repoRoot), ...originsFromPkg(repoRoot), ...originsFromPackagedDirs(repoRoot)]
  const origens = {}
  for (const [nome, origem] of pares) (origens[nome] ||= new Set()).add(origem)
  return Object.fromEntries(Object.entries(origens).map(([k, v]) => [k, [...v].sort()]))
}

/** Scripts citados apenas em `package.json.scripts` — superfície de mantenedor/CI. */
export function maintainerOnlyScripts(repoRoot = process.cwd()) {
  const runtime = new Set(runtimeReachableScripts(repoRoot))
  const pkg = JSON.parse(readSafe(join(repoRoot, "package.json")) || "{}")
  const citados = new Set()
  for (const cmd of Object.values(pkg.scripts || {})) {
    for (const m of String(cmd).matchAll(SCRIPT_REF)) citados.add(m[1])
  }
  return [...citados].filter((s) => !runtime.has(s)).sort()
}

// ── Detecção de pontos de saída ──────────────────────────────────────────────────
const SINKS_JS = [
  { re: /\b(info|warn|error|success|section)\s*\(/g, sink: "cli_render" },
  { re: /console\.(log|warn|error|info)\s*\(/g, sink: "console" },
  { re: /process\.stdout\.write\s*\(/g, sink: "stdout" },
  { re: /process\.stderr\.write\s*\(/g, sink: "stderr" },
]
const SINKS_PY = [
  { re: /\bprint\s*\(/g, sink: "print" },
  { re: /sys\.stdout\.write\s*\(/g, sink: "stdout" },
  { re: /sys\.stderr\.write\s*\(/g, sink: "stderr" },
  { re: /json\.dumps\s*\(/g, sink: "json" },
]

const lineOf = (text, index) => text.slice(0, index).split("\n").length

function scanFile(absPath, repoRoot, sinks) {
  const text = readSafe(absPath)
  const rel = relative(repoRoot, absPath).split(sep).join("/")
  const pontos = []
  for (const { re, sink } of sinks) {
    for (const m of text.matchAll(re)) pontos.push({ file: rel, line: lineOf(text, m.index), sink })
  }
  return pontos
}

/** Aplica a classificação por canal aos pontos JS, com `emitsJson` medido na linha. */
function classifyJsFile(absPath, repoRoot, registry = null) {
  const rel = relative(repoRoot, absPath).split(sep).join("/")
  const doRegistry = registry?.byFile?.get(rel)
  if (doRegistry) return pontosDoRegistry(rel, doRegistry)

  const text = readSafe(absPath)
  return scanFile(absPath, repoRoot, SINKS_JS).map((p) => ({
    ...p,
    ...classifyJsPoint({ sink: p.sink, emitsJson: emitsJsonAt(text, p.line) }),
  }))
}

/**
 * Converte entradas do registry AST em pontos do inventário.
 *
 * Convivência ARQUIVO A ARQUIVO: só quem está em `convertedFiles` chega aqui. O
 * resto continua no extrator legado por DECLARAÇÃO — um arquivo ausente do
 * registry não é erro, é "ainda não migrado". O que é erro (e bloqueia) é o
 * registry inteiro estar ausente, corrompido ou defasado.
 */
/** Rótulo do sink: escrita direta em stream, ou o caminho do callee. */
const sinkDaEntrada = (e) => (e.sink ? `process.${e.sink}.write` : (e.calleePath ?? e.callee ?? null))

/**
 * A âncora é `file+line+column` — só `line` não identifica um callsite, porque
 * duas chamadas cabem na mesma linha. `calleePath`, `bindingOrigin` e
 * `provenance` são preservados porque são a EVIDÊNCIA da classificação: sem
 * eles, auditar um ponto exigiria regerar o registry inteiro.
 */
const pontoDoRegistry = (rel, e) => ({
  file: rel,
  line: e.line,
  column: e.column,
  sink: sinkDaEntrada(e),
  calleePath: e.calleePath ?? e.callee ?? null,
  bindingOrigin: e.bindingOrigin ?? null,
  provenance: e.provenance ?? null,
  audience: e.audience,
  trigger: e.rule ?? null,
  source: "ast_registry",
})

const pontosDoRegistry = (rel, entries) => entries.map((e) => pontoDoRegistry(rel, e))

// ── Classificação por canal (NUNCA por conteúdo da frase) ────────────────────────
/**
 * `machine_protocol` é decidido pelo SINK, não pelo texto: `json.dumps` e
 * `process.stdout.write(JSON.stringify(...))` são contrato, independentemente do que
 * carregam. `stdout` cru em hook é protocolo de hook.
 */
const audienceBySink = (sink) => (sink === "json" ? "machine_protocol" : null)

/**
 * Classificação de ponto JS por CANAL — não por conteúdo, e não por default.
 *
 * A 1ª versão marcava `public_diagnostic` tudo que era do GStack e não caísse noutra
 * regra: 1.850 pontos "classificados" por omissão. Isso é o oposto do que a decisão
 * humana pede, e teria dado a impressão de inventário completo com 0 análise.
 *
 * Agora só o canal SANCIONADO de renderização (`info/warn/error/success/section`, a
 * camada pública de `cli/index.js`) é público por construção — porque esse é
 * literalmente o canal criado para falar com o usuário. Escrita crua (`console.*`,
 * `stdout`, `stderr`) NÃO se auto-declara: vira `machine_protocol` quando o sink é
 * JSON, e `unknown` caso contrário, exigindo classificação explícita no registry.
 */
export function classifyJsPoint({ sink, emitsJson = false }) {
  if (sink === "cli_render") return { audience: "public_diagnostic", trigger: "cli_render" }
  if (emitsJson) return { audience: "machine_protocol", trigger: "json_contract" }
  return { audience: "unknown", trigger: null }
}

// `stdout`/`console` carregando JSON.stringify na MESMA linha é contrato de máquina.
const emitsJsonAt = (text, line) => {
  const l = text.split("\n")[line - 1] || ""
  return /JSON\.stringify/.test(l)
}

/**
 * Owner: de quem é a mensagem. `templates/` produz artefato do USUÁRIO; o resto é do
 * GStack. Determina se a claim English-first sequer se aplica.
 */
const ownerOf = (file) => (file.startsWith("templates/") ? "generated" : "gstack")

/**
 * Classificação de HOOK Python por canal/condição — a regra que o usuário exigiu:
 * emissor, canal, condição e consumidor. Conteúdo da frase não participa.
 *
 * `stderr` sem condição determinável fica `unknown` DE PROPÓSITO: uma escrita direta
 * cuja audiência não se prova não pode virar "interna" em silêncio, porque é
 * exatamente assim que uma mensagem em português sobrevive à migração.
 */
/**
 * Regras de canal descobertas na Fase 1B (fatia `hooks/hooks/stop.py`). Cada uma é
 * ESTRUTURAL — deriva do emissor, do canal, da condição do ramo e do consumidor. Nenhuma
 * olha o texto da mensagem, porque texto é justamente o que não se pode usar como sinal:
 * seria heurística sobre heurística, com falso positivo garantido em path e nome próprio.
 *
 * A ordem importa: condições mais específicas primeiro. `unknown` é o último recurso e
 * NUNCA vira "interno" por default.
 */
const HOOK_RULES = Object.freeze([
  {
    id: "json-sink",
    when: ({ sink }) => sink === "json",
    audience: "machine_protocol", trigger: "hook_protocol",
    reason: "sink é serialização — contrato de máquina por construção, independente do que carrega",
  },
  {
    id: "stdout-hook-protocol",
    when: ({ sink }) => sink === "stdout",
    audience: "machine_protocol", trigger: "hook_protocol",
    reason: "stdout de hook é o canal do protocolo com o harness, não superfície de leitura humana",
  },
  {
    id: "control-char-only",
    when: ({ payloadIsControlChar }) => payloadIsControlChar,
    audience: "terminal_control", trigger: "terminal_bell",
    reason: "payload é byte de controle do terminal (BEL/ANSI) — não existe idioma a migrar, e chamar isso de protocolo confundiria com contrato consumido por parser",
  },
  {
    id: "test-observability-marker",
    when: ({ envGuarded, emitsStructuredToken }) => envGuarded && emitsStructuredToken,
    audience: "test_observability", trigger: "test_env_activation",
    reason: "marcador consumido por teste sob ativação explícita de env (tests/test_stop_audio_cues.py) — precisa ser estável, mas NÃO é protocolo público do produto",
  },
  {
    // CORREÇÃO da revisão humana: traceback gerado DENTRO do hook não é passthrough. Se
    // o GStack decide imprimi-lo, a exposição é DELE — e traceback cru em fluxo normal
    // ainda carrega risco de path, conteúdo e secret. `external_passthrough` passa a
    // exigir subprocesso externo identificado e bytes encaminhados sem transformação.
    id: "own-crash-traceback",
    when: ({ inCrashHandler, guardedByDebug }) => inCrashHandler && !guardedByDebug,
    audience: "public_diagnostic", trigger: "unhandled_exception",
    reason: "traceback impresso por decisão do próprio GStack em fluxo de crash: a moldura vira mensagem inglesa e o traceback exige resumo redigido (risco de path/secret) — nunca passthrough",
    risk: "traceback cru pode expor paths absolutos, conteúdo de variáveis e secrets",
  },
  {
    id: "security-branch",
    when: ({ securityBranch }) => securityBranch,
    audience: "public_security_decision", trigger: "guard_block",
    reason: "escrita no ramo de um predicado de bloqueio/guarda — comunica decisão de segurança ao usuário",
  },
  {
    id: "debug-flag",
    when: ({ guardedByDebug }) => guardedByDebug,
    audience: "internal_debug", trigger: "debug_flag",
    reason: "fora do fluxo padrão e exige ativação explícita de depuração",
  },
  {
    id: "channel-prefixed-diagnostic",
    when: ({ sink, channelPrefixed }) => sink === "stderr" && channelPrefixed,
    audience: "public_diagnostic", trigger: "normal_flow",
    reason: "stderr com prefixo de canal ([gitops]/[Porteiro]/…) é a superfície de leitura do usuário no fluxo normal",
  },
  {
    id: "except-handler-diagnostic",
    when: ({ sink, insideExceptHandler }) => sink === "stderr" && insideExceptHandler,
    audience: "public_diagnostic", trigger: "hook_failure",
    reason: "stderr em tratamento de exceção aparece ao usuário após falha",
  },
])

/**
 * Regras do Python de SUBPROCESSO DE CLI — espécie `cli_subprocess`.
 *
 * Lista separada de `HOOK_RULES` porque a pergunta é outra, e a diferença está
 * escrita na própria regra de hook: "stdout de hook é o canal do protocolo com o
 * harness". Aqui não há harness nenhum. Quem executa é o GStack, e quem lê o
 * stdout é o usuário — `context.js` captura a saída do indexer e a encaminha
 * crua (`context.js:249/260/278/280`) ou a reparseia (`explainJson`).
 *
 * A CONSEQUÊNCIA DISSO É A REGRA `cli-stdout-surface`: em subprocesso de CLI, o
 * stdout é superfície de leitura por padrão, não protocolo. É o inverso exato do
 * hook, e reusar a lista de lá teria afirmado contrato de máquina sobre as
 * frases que o usuário lê no terminal.
 *
 * O que ainda é protocolo continua sendo, mas por evidência ESTRUTURAL: o
 * payload é uma serialização e não há ramo humano na mesma chamada.
 */
const PY_SERIALIZADOR = /\bjson\.dumps\s*\(/
// Expressão condicional de Python (`a if cond else b`) na própria chamada: há
// DOIS payloads possíveis, e um deles é a frase.
const PY_CONDICIONAL = /\bif\b[^\n]*\belse\b/

const CLI_RULES = Object.freeze([
  {
    id: "cli-debug-flag",
    when: ({ guardedByDebug }) => guardedByDebug,
    audience: "internal_debug", trigger: "debug_flag",
    reason: "exige ativação explícita de depuração — fora do fluxo padrão",
  },
  {
    id: "cli-control-char-only",
    when: ({ payloadIsControlChar }) => payloadIsControlChar,
    audience: "terminal_control", trigger: "terminal_bell",
    reason: "payload é byte de controle do terminal — não existe idioma a migrar",
  },
  {
    id: "cli-json-sink",
    when: ({ sink }) => sink === "json",
    audience: "machine_protocol", trigger: "structural_serializer",
    reason: "sink é serialização — contrato de máquina por construção; o consumidor fica declarado e ANCORADO no arquivo, nunca herdado do canal de hook",
  },
  {
    /**
     * `print(json.dumps(x))` — a serialização É a linha inteira.
     *
     * A ausência de condicional é porta, e não detalhe: `print(json.dumps(out)
     * if args.json else f"Indexados …")` emite payload OU uma frase em
     * português, conforme a flag. Tratar as duas formas igual tiraria da claim
     * uma frase que o usuário lê metade das vezes.
     */
    id: "cli-stdout-serialized",
    when: ({ sink, payloadIsSerialized }) => sink === "print" && payloadIsSerialized,
    audience: "machine_protocol", trigger: "structural_serializer",
    reason: "a chamada inteira é `print(json.dumps(...))`, sem ramo humano: o stdout daquele subcomando é UM documento de contrato",
  },
  {
    id: "cli-stdout-surface",
    when: ({ sink }) => sink === "print",
    audience: "public_diagnostic", trigger: "cli_subprocess_stdout",
    reason: "stdout de subprocesso do próprio GStack é superfície de leitura: o processo pai captura e encaminha ao terminal do usuário. O inverso do hook, onde stdout é protocolo — e é por isso que as duas espécies não compartilham lista de regras",
  },
  {
    id: "cli-stderr-prefixed",
    when: ({ sink, channelPrefixed }) => sink === "stderr" && channelPrefixed,
    audience: "public_diagnostic", trigger: "normal_flow",
    reason: "stderr com prefixo de canal ([graphify]/…) é a superfície de aviso do usuário no fluxo normal",
  },
  {
    id: "cli-stderr-failure",
    when: ({ sink, insideExceptHandler }) => sink === "stderr" && insideExceptHandler,
    audience: "public_diagnostic", trigger: "subprocess_failure",
    reason: "stderr em tratamento de exceção aparece ao usuário depois da falha",
  },
])

const aplicarRegras = (regras, ctx) => {
  const regra = regras.find((r) => r.when(ctx))
  if (!regra) return { audience: "unknown", trigger: null, rule: null }
  return { audience: regra.audience, trigger: regra.trigger, rule: regra.id }
}

export function classifyHookPoint(ctx = {}) {
  return aplicarRegras(HOOK_RULES, ctx)
}

export function classifyCliSubprocessPoint(ctx = {}) {
  return aplicarRegras(CLI_RULES, ctx)
}

const semCorpo = ({ id, audience, trigger, reason, risk }) =>
  ({ id, audience, trigger, reason, ...(risk ? { risk } : {}) })

export const hookRules = () => HOOK_RULES.map(semCorpo)
export const cliSubprocessRules = () => CLI_RULES.map(semCorpo)

/**
 * `machine_protocol` só é legítimo com CONSUMIDOR real provado — parser identificado,
 * contrato declarado e teste que o exerça. Sem os três, a categoria vira depósito de
 * "casos sem idioma" e a migração passa por cima deles sem ninguém perceber.
 *
 * Registro do que hoje sustenta a classificação nos hooks. Cada entrada é auditável:
 * o consumidor existe, o contrato tem nome, e o teste pode ser aberto.
 */
export const MACHINE_PROTOCOL_CONSUMERS = Object.freeze([
  {
    // ANCORADA EM `hooks/` desde que a fronteira Python passou a incluir
    // subprocesso de CLI. Sem a âncora, esta declaração — que fala de PROTOCOLO
    // DE HOOK — passaria a cobrir os `json.dumps` de `context_db.py`, cujo
    // consumidor é outro. A cobertura acidental é o que este registro existe
    // para impedir; deixá-la valer aqui seria o registro se autoenganando.
    file: "hooks/",
    sink: "json",
    consumer: "harness (Claude Code / Codex) via protocolo de hook",
    contract: "objeto JSON em stdout com decisão do hook (block/allow + reason)",
    evidence: "tests/test_stop_output_guard_rbac.py — subprocess real do hook, parseia a decisão",
  },
  {
    // Python de CLI, e não de hook: quem lê é o próprio GStack, no processo pai.
    // A prova de que este arquivo é alcançado — e por quem — está na fronteira
    // (`PYTHON_RUNTIME_ROOTS`), derivada com o provador de origem de C-4(a).
    file: "src/context-docs/py/context_db.py",
    sink: "json",
    consumer: "src/commands/context.js — `runIndexer` captura o stdout e o encaminha ou reparseia (`explainJson`)",
    contract: "sob `--json`, cada subcomando do indexer emite UM documento JSON em stdout",
    evidence: "tests/i18n_python_boundary.test.js — a fronteira prova o spawn; tests/test_context_db.py exercita index/search/related por subprocesso real",
  },
  {
    // MESMA emissão, contada duas vezes pelo scanner: a linha casa o padrão de
    // `print` E o de serialização. É a dívida de MEDIÇÃO já registrada do lado
    // JS — onde o padrão de helper casa dentro da chamada de console —, e não um
    // segundo contrato. A declaração existe porque o ponto de `print` também sai
    // `machine_protocol` e o audit cobra consumidor de todo ponto que sai assim
    // — o que ele NÃO pode aceitar é que a declaração do hook cubra este arquivo.
    //
    // E NÃO É TEORIA: a primeira versão deste comentário escrevia as chamadas
    // por extenso e o próprio scanner contou TRÊS pontos de emissão dentro dele,
    // inflando o censo em 3. Comentário deste módulo não pode citar sintaxe de
    // sink literal.
    file: "src/context-docs/py/context_db.py",
    sink: "print",
    consumer: "src/commands/context.js — mesmo consumidor do sink `json`; a linha é `print(json.dumps(...))` e o scanner a conta por dois canais",
    contract: "sob `--json`, o stdout do subcomando é UM documento JSON",
    evidence: "tests/i18n_python_cli_rules.test.js — só a chamada SEM ramo condicional é aceita como payload; a forma ternária fica na claim",
  },
  {
    sink: "stdout",
    consumer: "harness — stdout do hook É o canal do protocolo, não superfície de leitura",
    contract: "payload serializado; texto humano vai para stderr",
    evidence: "tests/test_stop_sandbox.py, tests/test_stop_test_gate.py",
  },
  {
    // 1º sink JS a chegar aqui: a conversão AST de `create.js` renomeia o rótulo de
    // sink de `stdout` (regex) para `process.stdout.write`, e o ponto deixa de casar
    // com a entrada do hook acima. O `file` é o ANCORAMENTO: sem ele, esta declaração
    // passaria a cobrir todo `process.stdout.write` do repositório — que é exatamente
    // o depósito que este registro existe para impedir.
    file: "src/cli/create.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `create --dry-run --json` — stdout inteiro é UM documento JSON",
    contract: "sob `--json`, o relatório de dry-run sai serializado em stdout; o texto humano fica no ramo `else` (console.log)",
    evidence: "tests/json_purity_contract.test.js — `create amostra --dry-run --json` roda por subprocess real e prova stdout puro + payload fora do stderr",
  },
  {
    // Lote JS 1/14. Âncora por arquivo é EXATA aqui: só o comando `qa` alcança
    // `qa.js`. A âncora por comando/modo (arquivo + command + mode) vive na
    // camada do AST, que é onde a classificação acontece; aqui a pergunta é
    // apenas "todo ponto `machine_protocol` tem consumidor declarado?".
    file: "src/commands/qa.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `qa --json` — veredito e recusa, ambos documento JSON único",
    contract: "sob `--json`, stdout é UM documento: o veredito (`verdict`/`blocked`/`findings`/`byLens`) ou a recusa (`{\"error\":\"not_a_git_repo\"}`); a saída humana fica no ramo `else`",
    evidence: "tests/qa_json_contract.test.js — `node src/index.js qa --json` por subprocess real, dentro e fora de repo git, com stdout puro e schema mínimo",
  },
  {
    // Lote JS 2/14. Âncora por arquivo é EXATA aqui: só o comando `secrets`
    // alcança `secrets.js` (é o único importador, em src/cli/index.js:20). A
    // âncora fina por comando/modo vive na camada do AST, que é onde a
    // classificação acontece; aqui a pergunta é apenas "todo ponto
    // `machine_protocol` tem consumidor declarado?".
    file: "src/commands/secrets.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `secrets --json` — relatório do doctor e listagem de nomes, cada um documento JSON único",
    contract: "sob `--json`, stdout é UM documento: o relatório de `doctor` (`provider`/`available`/`required`/`stored`/`missing`/`ok`) ou a listagem de `list` (`names`); a saída humana fica no ramo `else`. O VALOR do segredo nunca entra em nenhum dos dois",
    evidence: "tests/secrets_json_contract.test.js — `node src/index.js secrets doctor --json` e `secrets list --json` por subprocess real, com stdout puro, schema mínimo e controle de ausência de campo de valor",
  },
  {
    // Lote JS 4/14. Âncora por arquivo é EXATA aqui: só o comando `orchestrate`
    // alcança `orchestrate.js`. Os dois pontos são RAMOS do mesmo comando e modo
    // — recusa e resultado —, e a distinção entre eles vive na camada do AST
    // (arquivo + command + mode); aqui a pergunta é apenas "todo ponto
    // `machine_protocol` tem consumidor declarado?".
    file: "src/commands/orchestrate.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `orchestrate --json` — resultado da orquestração e recusa por plano ausente, cada um documento JSON único",
    contract: "sob `--json`, stdout é UM documento: o resultado (`planId`/`status`/`steps`/`limits`/`handoff`/`reviewerCoverage`) ou a recusa (`{\"error\":\"plan_not_found\"}`); a saída humana fica no ramo `else`. Recusa e resultado se distinguem pelo DOCUMENTO, não pelo código de saída",
    evidence: "tests/orchestrate_json_contract.test.js — `orchestrate <plano> --yes --json` e `orchestrate <inexistente> --json` por subprocess real em repo git, com stdout puro nos dois ramos e controle negativo do ramo sem `--json`",
  },
  {
    // Lote JS 6/14. Âncora por arquivo é EXATA: só o comando `visual` alcança
    // `visual.js`. Os onze pontos vivem em cinco subcomandos do mesmo par
    // (comando, modo); a distinção fina vive na camada do AST.
    // Lote JS 9/14. UM ponto (`ctxJson`, context.js:50) serve os CINCO caminhos
    // de `--json` do arquivo, e nenhuma guarda envolve a escrita — quem está sob
    // `if (json)` são os chamadores. O ponto só é `machine_protocol` por causa
    // da guarda HERDADA; sem ela nenhuma declaração podia cobri-lo sem afirmar
    // prova sobre o ramo humano.
    file: "src/commands/context.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `context … --json` — search, related, explain e scout, cada chamada um documento JSON único",
    contract: "sob `--json`, stdout é UM documento: recusa de `ctxFail` (`{error:\"missing query|missing entity|missing topic|no_index|…\"}`), recusa de `scoutError` (`{ok:false,error}`), relatório do scout ou o payload de decisão/explain. A saída humana fica nos ramos `else`",
    evidence: "tests/context_json_contract.test.js — subprocess real em sandbox: as quatro recusas de `ctxFail`, os dois ramos de `scoutError` e o relatório completo do scout, com stdout puro, payload fora do stderr e dois controles negativos do ramo sem `--json`. NÃO exercita `decisionContext` nem `explainJson`, que exigem índice real e escrevem pelo MESMO ponto — lacuna declarada",
  },
  {
    // Lote JS 13/14. UM ponto de máquina, e ele é o preflight READ-ONLY. A prova
    // roda em ambiente inteiramente descartável e afere ZERO escrita — não
    // "escreveu só onde podia".
    file: "src/installer/install.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `install --audit-only --json` — preflight de impacto, degradações previstas e supply chain, num documento único",
    contract: "sob `--audit-only --json`, stdout é UM documento `gstack.install-audit.v1` com `readOnly: true`, `impact` por categoria, `predictedDegradations` e `supplyChain`. READ-ONLY por construção (P0.3): sem `--save-report` nada é gravado",
    evidence: "tests/install_json_contract.test.js — subprocess em HOME/USERPROFILE/TMPDIR/XDG/APPDATA/LOCALAPPDATA descartáveis, com stdout puro, schema conferido, exit 0, árvore do sandbox comparada antes/depois (zero escrita nos dois ramos) e controle provando que a troca de HOME pegou",
  },
  {
    // Lote JS 12/14. Declaração FILE-SCOPED: o arquivo tem um export e serve um
    // subcomando (`task run`). O handler do DISPATCH vive em `task.js`, que
    // reexporta — a aresta cross-módulo não é modelada, e declarar por comando
    // seria declarar uma rota que a derivação não prova.
    file: "src/commands/task-run.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `task run --json` — recusa e resultado do loop, cada chamada um documento único",
    contract: "sob `--json`, stdout é UM documento: a recusa `{error:\"plan_not_found\"}` quando não há plano, ou o resultado do loop (`planId`, `status`, `accepted`/`rejected`/`skipped`, `handoff`, `iterations`, `branches`). A saída humana fica no ramo seguinte",
    evidence: "tests/task_run_json_contract.test.js — subprocess real em repo git de verdade: a recusa (task-run.js:43) e o resultado completo do loop (:97), com stdout puro, payload fora do stderr e dois controles negativos (ramo humano e a guarda de `--yes`)",
  },
  {
    // Lote JS 9/14. CINCO pontos de máquina, um por família de subcomando — não
    // há helper único aqui. `emitCancelled` fica declarado como lacuna: exige
    // TTY respondendo NÃO ao confirm, e sem TTY o fluxo para antes.
    file: "src/commands/research.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `research … --json` — skills audit, notebooklm e validate, cada chamada um documento JSON único",
    contract: "sob `--json`, stdout é UM documento: recusa por consentimento de rede (`{error:\"needs_confirmation\",hint}`), auditoria read-only (`gstack.external-skills-audit.v1`, com `guardrails`), payload do conector (`gstack.notebooklm-adapter.v1`) ou revisão epistêmica (`gstack.epistemic-review.v1`). A saída humana fica nos ramos `else`",
    evidence: "tests/research_json_contract.test.js — subprocess real em sandbox: `notebooklm doctor` e `connect`, a recusa de `skills audit --repo` sem `--yes`, a auditoria de `skills audit --path` com guardrails e a revisão de `validate`; stdout puro, payload fora do stderr e dois controles negativos do ramo sem `--json`. NÃO cobre `emitCancelled` (research.js:129), alcançável só com TTY — lacuna declarada, não presumida",
  },
  {
    file: "src/commands/visual.js",
    sink: "process.stdout.write",
    consumer: "consumidor de máquina do `visual --json` — doctor, detect, explain, check, hooks e context, cada ramo um documento JSON único",
    contract: "sob `--json`, stdout é UM documento por ramo: relatório do motor (`counts`/`activeRules`), achados do detector (`findings`/`counts`), regra explicada (`ruleId`/`status`), gate visual (`driverAvailable`/`blocked`/`problems`), projeções de hook (`results`), recusa por falta de consentimento (`{error:\"needs_confirmation\"}`), estado/execução do design context (`status`/`sourceHash`, `applied`/`plans`) ou a recusa por design system ausente (`{error:\"no_design_system\"}`). A saída humana fica no ramo `else`",
    evidence: "tests/visual_json_contract.test.js — dez dos onze pontos por subprocess real, com stdout puro e controle negativo do ramo sem `--json`. NÃO cobre `visual.js:138` (`emitCancelled`), que exige TTY respondendo NÃO ao confirm — lacuna declarada, não presumida",
  },
])

/** Audiências que exigem consumidor provado para serem aceitas. */
const REQUIRE_CONSUMER = new Set(["machine_protocol"])

/**
 * Verifica que todo ponto `machine_protocol` do inventário tem consumidor registrado
 * para o seu sink. Um sink novo cair em `machine_protocol` sem entrada aqui é ERRO —
 * é assim que a categoria segura viraria depósito.
 *
 * COBERTURA ANCORADA: uma entrada com `file` só cobre pontos DAQUELE arquivo. Sem
 * `file`, a entrada cobre o sink inteiro — que é o alcance herdado das duas entradas
 * dos hooks Python.
 *
 * DÍVIDA CONHECIDA (reconciliação no lote JS): a entrada `sink: "stdout"` dos hooks
 * cobre hoje, por colisão de RÓTULO, os pontos JS ainda não convertidos — o scanner
 * regex rotula `process.stdout.write` como `stdout`, igual ao canal do hook. São ~130
 * pontos em `src/commands/*` que nenhuma das duas declarações descreve. Converter um
 * arquivo os tira da colisão (o AST rotula `process.stdout.write`) e força a
 * declaração real, um a um. Ancorar os hooks em `hooks/` antes disso só trocaria a
 * cobertura acidental por um gate vermelho de 130 achados sem consumidor declarado.
 */
/**
 * `file` terminado em `/` é PREFIXO de diretório; sem barra, arquivo exato.
 *
 * A forma de prefixo entrou com a fronteira Python: a declaração dos hooks
 * precisava dizer "os hooks, e só eles" sem enumerar dezesseis arquivos, e
 * enumerar teria a mesma doença da lista manual — envelhece calada quando um
 * hook novo aparece.
 */
const cobreArquivo = (c, p) => !c.file
  || (c.file.endsWith("/") ? p.file.startsWith(c.file) : c.file === p.file)

const cobre = (c, p) => c.sink === p.sink && cobreArquivo(c, p)

export function machineProtocolAudit(inventory, consumers = MACHINE_PROTOCOL_CONSUMERS) {
  const semConsumidor = inventory.points
    .filter((p) => REQUIRE_CONSUMER.has(p.audience) && !consumers.some((c) => cobre(c, p)))
    .map((p) => ({ file: p.file, line: p.line, sink: p.sink }))
  return { ok: semConsumidor.length === 0, semConsumidor }
}

const DEBUG_GUARD = /\b(DEBUG|VERBOSE|GSTACK_DEBUG)\b/
const EXCEPT_NEARBY = /\bexcept\b|\braise\b|\bsys\.exit\b/
// Ativação explícita por variável de ambiente — evidência de "fora do fluxo padrão".
const ENV_GUARD = /os\.environ\.get\(\s*["'][A-Z0-9_]+["']\s*(?:,[^)]*)?\)\s*==\s*["'][^"']+["']/
// Predicados de bloqueio/guarda: o RAMO é a evidência, não a frase.
const SECURITY_BRANCH = /\bif\s+(?:\w*blocked\b|_?redaction_events\b|\w*_blocked\b)|\ballow_dirty\b/
// Prefixo de canal `[algo]` no início do payload — convenção de superfície de usuário.
const CHANNEL_PREFIX = /["'f]*\s*["']\s*\[[A-Za-z][\w-]*\]/
// Só escapes/controle no payload (ex.: "\a"), sem nada localizável.
const CONTROL_ONLY = /\(\s*["'](?:\\[abfnrtv0])+["']\s*\)/
// Token estruturado `chave:valor` sem prosa — consumido por parser, não lido como texto.
const STRUCTURED_TOKEN = /["'f]*["'][a-z][\w-]*:\{?\w/

/**
 * Contexto ESTRUTURAL de uma linha Python — a base objetiva de `classifyHookPoint`.
 * Tudo aqui é sobre onde a chamada está e sob que condição roda; nada é sobre o que a
 * mensagem diz.
 */
const indentOf = (l) => (l.match(/^[ \t]*/) || [""])[0].length
const BLOCK_OPENER = /^\s*(if|elif|else|try|except|finally|for|while|with|def|class)\b/

/**
 * Condições que REALMENTE envolvem a linha, por indentação.
 *
 * Achado da Fase 1B: a 1ª versão usava janela de 6 linhas e classificou uma escrita de
 * fluxo normal (`stop.py:1227`, "commit criado") como decisão de segurança, porque um
 * `if allow_dirty:` aparecia 5 linhas acima — mas a escrita estava FORA desse ramo,
 * depois do `subprocess.run`. Janela de linhas não é escopo; em Python, escopo é
 * indentação. Aqui só entram os aberturas de bloco com indentação MENOR que a da
 * chamada, subindo até o topo da função.
 */
const isTopLevelDef = (l) => /^\s*(def|class)\b/.test(l)

/** Uma linha "sobe" o escopo quando tem conteúdo e indentação menor que o nível atual. */
const dedents = (l, nivel) => Boolean(l.trim()) && indentOf(l) < nivel

function enclosingConditions(linhas, line) {
  const envolventes = []
  let nivel = indentOf(linhas[line - 1] || "")
  for (let i = line - 2; i >= 0; i--) {
    const l = linhas[i]
    if (!dedents(l, nivel)) continue
    if (BLOCK_OPENER.test(l)) envolventes.push(l)
    nivel = indentOf(l)
    if (isTopLevelDef(l)) break
  }
  return envolventes.join("\n")
}

function pythonContext(text, line) {
  const linhas = text.split("\n")
  const envolventes = enclosingConditions(linhas, line)
  // A chamada pode abrir em `write(` e continuar na linha seguinte.
  const chamada = linhas.slice(line - 1, line + 2).join("\n")
  const funcao = linhas.slice(Math.max(0, line - 25), line).join("\n")
  return {
    guardedByDebug: DEBUG_GUARD.test(envolventes),
    insideExceptHandler: EXCEPT_NEARBY.test(envolventes),
    envGuarded: ENV_GUARD.test(envolventes),
    securityBranch: SECURITY_BRANCH.test(envolventes),
    inCrashHandler: /_crash_handler|format_exception/.test(funcao),
    payloadIsControlChar: CONTROL_ONLY.test(chamada),
    emitsStructuredToken: STRUCTURED_TOKEN.test(chamada),
    channelPrefixed: CHANNEL_PREFIX.test(chamada),
    // Serialização SEM ramo humano na mesma chamada. As duas condições juntas:
    // `print(json.dumps(x))` é payload; `print(json.dumps(x) if f else "frase")`
    // é payload OU frase, e a frase pertence à claim.
    payloadIsSerialized: PY_SERIALIZADOR.test(chamada) && !PY_CONDICIONAL.test(chamada),
  }
}

/**
 * Constrói o inventário completo. `registry` é dado configurável e VERSIONADO: mapeia
 * `file` (ou prefixo) para audiência declarada. Toda entrada do registry é validada
 * contra os entry points reais — um registro que aponta para arquivo inexistente ou
 * para script que deixou de ser runtime é ERRO, não decoração.
 */
/** Os arquivos JS que o inventário efetivamente varre. */
const arquivosJsColetados = (repoRoot, runtimeScripts) => [
  ...walkFiles(join(repoRoot, "src"), [".js", ".mjs", ".cjs"]),
  ...walkFiles(join(repoRoot, "templates"), [".js", ".mjs", ".cjs", ".ts", ".tsx"]),
  // mantenedor/CI fica fora da claim — por derivação do grafo, não por lista
  ...walkFiles(join(repoRoot, "scripts"), [".mjs", ".js", ".cjs"])
    .filter((f) => runtimeScripts.has(relative(repoRoot, f).split(sep).pop())),
]

/**
 * Devolve os pontos E o conjunto de arquivos VISITADOS.
 *
 * O conjunto é registrado explicitamente porque "produziu zero pontos" e "nunca
 * entrou na coleta" são estados diferentes e indistinguíveis pelo resultado.
 * Inferir visita a partir dos pontos deixaria passar um `convertedFiles` que o
 * coletor jamais varre.
 */
const collectJsPoints = (repoRoot, runtimeScripts, registry = null) => {
  const arquivos = arquivosJsColetados(repoRoot, runtimeScripts)
  return {
    visitados: new Set(arquivos.map((f) => relative(repoRoot, f).split(sep).join("/"))),
    pontos: arquivos.flatMap((f) => classifyJsFile(f, repoRoot, registry)),
  }
}

// ── Fronteira do inventário Python ──────────────────────────────────────────
//
// ACHADO QUE ABRIU ESTA FATIA (C-4(a)). `context.js:249/260/278/280` repassam,
// sem uma moldura sequer, o stdout de `src/context-docs/py/context_db.py`. O
// provador de origem mostrou que aquele artefato NÃO é ferramenta de terceiros:
// é script do próprio pacote, e ele imprime prosa escrita pelo GStack
// ("(sem resultados)", "Entidade '…' não encontrada."). Só que o inventário
// varria `hooks/` e mais nada — as frases não eram contadas em lugar nenhum.
//
// A fronteira antiga era um caminho literal (`hooks`), sem uma linha explicando
// por quê. Substituí-la por outro caminho literal repetiria o erro num arquivo
// a mais. O que decide é o critério, e ele tem DUAS condições:
//
//   1. DISTRIBUÍDO   — o arquivo viaja no pacote (`package.json#files`). Tirar
//                      o diretório dali tira o arquivo da fronteira, sem que
//                      ninguém precise lembrar de editar este módulo;
//   2. ALCANÇÁVEL    — há execução REAL declarada, com evidência nomeada. Sem
//                      esta condição a fronteira engoliria os 40 `.py` do
//                      manifesto — 361 pontos, quase todos de script de skill
//                      que a CLI nunca dispara. Medido, não estimado.
//
// É a mesma regra de ouro nº 1 do topo deste módulo, aplicada ao Python:
// escopo é DERIVADO de execução, nunca de lista de caminhos.

/** Diretórios que nunca são superfície do produto, em qualquer raiz. */
const PY_SEGMENTOS_EXCLUIDOS = new Set([
  "__pycache__", ".venv", "venv", "site-packages", "tests", "test", "fixtures", "__fixtures__",
])

/** Arquivo de teste por CONVENÇÃO de nome — a que o pytest usa para descobrir. */
const PY_ARQUIVO_DE_TESTE = /^(?:test_.*|.*_test|conftest)\.py$/

/** Caminho relativo com barras normais — a forma canônica de todo `file` daqui. */
const norm = (p) => String(p).split(sep).join("/")

const ehPythonDeProduto = (rel) => {
  const partes = rel.split("/")
  if (partes.some((s) => PY_SEGMENTOS_EXCLUIDOS.has(s))) return false
  return !PY_ARQUIVO_DE_TESTE.test(partes[partes.length - 1])
}

/**
 * RAÍZES DE EXECUÇÃO do Python, cada uma com a evidência que a sustenta.
 *
 * Declarada e versionada, no mesmo espírito de `MACHINE_PROTOCOL_CONSUMERS`:
 * quem entra precisa dizer QUEM executa e ONDE isso está provado. O teste de
 * fronteira confere as duas coisas contra o repositório real e, sobretudo, faz
 * o controle de DERIVA — nenhum outro `.py` distribuído pode ser disparado por
 * `src/` sem estar aqui.
 */
export const PYTHON_RUNTIME_ROOTS = Object.freeze([
  Object.freeze({
    path: "hooks",
    kind: "harness_hook",
    runner: "harness (Claude Code / Codex / OpenCode) via configuração de hook instalada",
    evidence: "src/installer/install.js copia `hooks/hooks/*.py` e registra os eventos; tests/test_stop_sandbox.py roda o hook por subprocesso real",
  }),
  Object.freeze({
    path: "src/context-docs/py/context_db.py",
    kind: "cli_subprocess",
    runner: "src/commands/context.js — `context index|search|related|explain|status`",
    evidence: "tests/i18n_python_boundary.test.js prova, com o provador de origem de C-4(a), que o spawn de context.js resolve para ESTE arquivo",
  }),
])

/**
 * Os arquivos `.py` da fronteira, com o `kind` da raiz que os alcança.
 *
 * Interseção das duas condições: a raiz é declarada E o arquivo está dentro do
 * que o manifesto publica. Uma raiz que aponte para fora do pacote não rende
 * arquivo nenhum — e é isso que faz a condição 1 ser porta, não decoração.
 */
export function distributedPythonFiles(repoRoot = process.cwd()) {
  const publicados = arquivosPublicados(repoRoot, ".py")
  const saida = new Map()
  for (const raiz of PYTHON_RUNTIME_ROOTS) {
    for (const rel of arquivosDaRaiz(repoRoot, raiz.path)) {
      if (publicados.has(rel) && ehPythonDeProduto(rel) && !saida.has(rel)) saida.set(rel, raiz)
    }
  }
  return saida
}

/** `.py` sob a raiz declarada — arquivo único ou diretório inteiro. */
function arquivosDaRaiz(repoRoot, raiz) {
  const abs = join(repoRoot, raiz)
  const st = statSafe(abs)
  if (!st) return []
  if (st.isFile()) return raiz.endsWith(".py") ? [norm(relative(repoRoot, abs))] : []
  return walkFiles(abs, [".py"]).map((f) => norm(relative(repoRoot, f)))
}

/**
 * O que o manifesto PUBLICA, com a extensão pedida.
 *
 * `package.json#files` é a única fonte: é ela que decide o que sai no tarball, e
 * portanto o que pode chegar à máquina de alguém. Uma entrada que não existe em
 * disco simplesmente não contribui — o manifesto pode citar caminho futuro.
 */
function arquivosPublicados(repoRoot, ext) {
  const pkg = JSON.parse(readSafe(join(repoRoot, "package.json")) || "{}")
  const saida = new Set()
  for (const entrada of pkg.files || []) {
    for (const rel of arquivosDaRaiz(repoRoot, String(entrada).replace(/\/$/, ""))) {
      if (rel.endsWith(ext)) saida.add(rel)
    }
  }
  return saida
}

/**
 * Classificador por espécie de raiz.
 *
 * `HOOK_RULES` descreve hook: a regra `stdout-hook-protocol` diz, com todas as
 * letras, que "stdout de hook é o canal do protocolo com o harness". Aplicá-la a
 * um subprocesso de CLI afirmaria contrato de máquina sobre a saída que o
 * usuário lê. Em `CLI_RULES` o stdout é o inverso — superfície de leitura por
 * padrão —, e é justamente por isso que as duas listas não podem ser uma só.
 */
const CLASSIFICADOR_POR_ESPECIE = {
  harness_hook: (ctx) => classifyHookPoint(ctx),
  cli_subprocess: (ctx) => classifyCliSubprocessPoint(ctx),
}

const collectPyPoints = (repoRoot) => [...distributedPythonFiles(repoRoot)].flatMap(([rel, raiz]) => {
  const abs = join(repoRoot, rel)
  const text = readSafe(abs)
  const classificar = CLASSIFICADOR_POR_ESPECIE[raiz.kind]
  return scanFile(abs, repoRoot, SINKS_PY)
    .map((p) => ({ ...p, ...classificar({ sink: p.sink, ...pythonContext(text, p.line) }) }))
})

// O registry só REFINA o que a análise de canal deixou `unknown`. Nunca sobrescreve uma
// audiência derivada — declaração humana não pode reclassificar contrato de máquina como
// texto público, nem o contrário.
const declaredFor = (registry, p) =>
  registry[`${p.file}:${p.line}`] || registry[p.file] || registry[p.file.split("/").slice(0, 2).join("/") + "/"]

const finalize = (p, audience, trigger) => ({
  ...p, audience, trigger, owner: ownerOf(p.file),
  classification: isInScope(audience) ? "in_scope" : "out_of_scope",
})

const jaClassificado = (p) => Boolean(p.audience) && p.audience !== "unknown"

/**
 * Chave de um callsite. `file+line+column` — nunca só `file`, nunca prefixo.
 *
 * O registry LEGADO (`declaredFor`) aceita `arquivo`, `arquivo:linha` e prefixo
 * de diretório, o que é aceitável para refinar `unknown` em massa. Os overrides
 * do AST são outra coisa: cada um carrega `reason`, `owner`, `evidence` e
 * `expectedFileHash` porque descreve UMA decisão sobre UM callsite. Casá-los por
 * arquivo espalharia silenciosamente uma decisão para pontos que ninguém olhou.
 */
export const anchorOf = (p) => `${p.file}|${p.line}|${p.column}`

const porAncora = (lista) => new Map(
  (lista || []).map((o) => [`${o.file}|${o.line}|${o.column}`, o]),
)

const overridesPorAncora = porAncora

/**
 * Marca de decisão aplicada a partir de veredito com PROCEDÊNCIA.
 *
 * A procedência é verificada UMA VEZ, no veredito inteiro
 * (`isValidatedRegistry`), antes de qualquer aplicação — o que cobre `byFile`,
 * `overrides` e `provenanceDecisions` de uma vez só. Duas versões anteriores
 * erraram aqui: a primeira aceitava qualquer objeto na propriedade; a segunda
 * marcava só as decisões de provenance e deixava os OVERRIDES passarem pela
 * mesma porta.
 *
 * Este símbolo sobrevive apenas para `unresolvedProvenance`, que é exportada e
 * pode receber pontos montados fora do pipeline — nesse caminho não há veredito
 * a inspecionar, e a marca no ponto é o que resta.
 */
const DECISAO_VALIDADA = Symbol("i18n.provenanceDecision.validated")

export const decisaoValidada = (p) => Boolean(p?.provenanceDecision?.[DECISAO_VALIDADA])

/**
 * Anexa a decisão ao ponto, PRESERVANDO a provenance original.
 *
 * Sobrescrever `provenance.resolved` para `true` apagaria a evidência de que o
 * argumento é interpolado — e a decisão passaria a parecer análise automática.
 * O dado bruto continua dizendo "não resolvido"; a decisão fica ao lado, com
 * quem decidiu, por quê e com qual estratégia.
 */
const comDecisaoProvenance = (p, d) => {
  if (!d) return p
  const decisao = {
    strategy: d.strategy,
    interpolations: Array.isArray(d.interpolations) ? [...d.interpolations] : d.interpolations,
    reason: d.reason,
    owner: d.owner,
    evidence: d.evidence,
  }
  Object.defineProperty(decisao, DECISAO_VALIDADA, { value: true, enumerable: false })
  return { ...p, provenanceDecision: decisao }
}

/**
 * Override humano tem a última palavra — mas SÓ no callsite exato que ele
 * ancora, e o loader já garantiu que a âncora existe e que o `expectedFileHash`
 * confere. Aqui é aplicação, não validação.
 */
const aplicarOverride = (p, ov) => ({
  ...finalize(p, ov.audience, "override"),
  override: { reason: ov.reason, owner: ov.owner, evidence: ov.evidence },
})

/** Classificação quando não há override: derivada > declarada > por sink. */
const semOverride = (p, registry) => {
  if (jaClassificado(p)) return finalize(p, p.audience, p.trigger ?? null)
  const declarado = declaredFor(registry, p)
  if (declarado) return finalize(p, declarado, "registry")
  return finalize(p, audienceBySink(p.sink) ?? "unknown", p.trigger ?? null)
}

function enrichPoint(p, registry, overrides = null, decisoes = null) {
  const ancora = anchorOf(p)
  const ov = overrides?.get(ancora)
  const base = ov ? aplicarOverride(p, ov) : semOverride(p, registry)
  return comDecisaoProvenance(base, decisoes?.get(ancora))
}

/**
 * Provenance não resolvida bloqueia — mas SÓ para audiência `in_scope`.
 *
 * `argumentProvenance` marca `unresolved` quando o argumento é template com
 * interpolação: `${plan.id}` é do projeto, `${objective}` é do usuário,
 * `${count}` é derivado, e sem análise de fluxo não dá para saber qual. Isso
 * importa para o que vai ser TRADUZIDO — se metade da string vem de fora, o
 * tradutor precisa saber.
 *
 * Fora do escopo da claim, não importa: `render_primitive` recebe o texto do
 * chamador (que já foi contado) e `machine_protocol` não é traduzido. Bloquear
 * neles travaria a migração por um dado que ninguém vai usar.
 */
/** Provenance bem formada: objeto com `resolved` booleano. */
const provenanceValida = (v) => Boolean(v) && typeof v === "object" && typeof v.resolved === "boolean"

/**
 * Motivo de pendência de um ponto, ou `null` se ele está resolvido.
 *
 * FAIL-CLOSED PARA PONTO AST. Um ponto vindo do registry SEMPRE deveria trazer
 * provenance — o gerador a emite para toda entrada. Se ela veio ausente ou
 * malformada, algo se perdeu entre gerar e consumir, e tratar isso como
 * "resolvido" seria presumir a resposta justamente onde o dado sumiu.
 *
 * Ponto LEGADO (extrator regex) não tem provenance por construção: exigir dele
 * bloquearia todo arquivo ainda não convertido, que é o oposto da convivência
 * arquivo a arquivo.
 */
/**
 * Decisão humana VALIDADA resolve a pendência — e só ela. Checar a PRESENÇA da
 * propriedade aceitava qualquer objeto forjado; a marca interna prova que ela
 * veio do loader, que conferiu âncora, hash e identificadores.
 */
const pendenciaPorDecisao = (p) => {
  if (decisaoValidada(p)) return { resolvido: true }
  return p.provenanceDecision ? { motivo: "unvalidated_decision" } : null
}

const pendenciaPorProvenance = (p) => {
  if (provenanceValida(p.provenance)) return p.provenance.resolved ? null : "interpolated"
  return p.source === "ast_registry" ? "missing_provenance" : null
}

const pendenciaDe = (p) => {
  if (p.classification !== "in_scope") return null
  const daDecisao = pendenciaPorDecisao(p)
  if (daDecisao) return daDecisao.motivo ?? null
  return pendenciaPorProvenance(p)
}

export function unresolvedProvenance(inventory) {
  const pendentes = []
  for (const p of inventory.points || []) {
    const motivo = pendenciaDe(p)
    if (motivo) pendentes.push({ p, motivo })
  }

  const faltando = pendentes.filter((x) => x.motivo === "missing_provenance").length
  const detalhe = faltando > 0 ? ` (${faltando} sem provenance no registry — regenerar)` : ""

  return {
    ok: pendentes.length === 0,
    count: pendentes.length,
    missingProvenance: faltando,
    points: pendentes.map(({ p, motivo }) => ({
      file: p.file, line: p.line, column: p.column,
      reason: motivo, ids: p.provenance?.ids ?? [],
    })),
    reason: pendentes.length === 0
      ? null
      : `${pendentes.length} ponto(s) in_scope com origem de argumento não resolvida — interpolação não prova de onde vem o dado${detalhe}`,
  }
}

/**
 * Inventário BLOQUEADO por registry inválido.
 *
 * Devolve a MESMA forma, com `points: []` e contagens `null`, mais
 * `jsRegistry.ok:false`. Três decisões deliberadas:
 *
 *  - **Não lança.** Exceção com stack seria indistinguível de bug e perderia a
 *    razão estruturada. O consumidor recebe o motivo e decide.
 *  - **Não devolve pontos do regex.** Entregar o inventário legado seria o
 *    fallback silencioso que esta fatia existe para impedir: a classificação
 *    antiga voltaria a valer sobre código novo, e o número pareceria saudável.
 *  - **Contagens `null`, nunca `0`.** Zero é resultado de medição; aqui não
 *    houve medição. `unknown: 0` seria lido como "nada a classificar", que é a
 *    leitura oposta à verdade.
 */
/**
 * O que foi DECLARADO precisa ter sido CONSUMIDO.
 *
 * Dois vazamentos silenciosos que isto fecha:
 *
 *  - **Arquivo convertido que o coletor não varre.** `convertedFiles` pode listar
 *    um caminho fora de `src/`, `templates/` e dos scripts alcançáveis. Ele passa
 *    em todas as validações do loader — existe, hash confere — e simplesmente
 *    nunca é lido. O registry anuncia cobertura que não acontece.
 *
 *  - **Decisão de provenance que nunca casa.** Se o arquivo dela não é
 *    coletado, a decisão é válida, declarada... e inerte. O gate via
 *    `provenance.ok: true` porque a pendência também não foi coletada — verde
 *    por ausência dos dois lados.
 *
 * Bloqueia como `corrupt`: é incoerência entre artefato e pipeline, não
 * defasagem de conteúdo.
 */
const incoerencia = (reason, details) => ({ ok: false, status: "corrupt", reason, details })

/** Declarado × aplicado, para cada tipo de decisão humana. */
const divergenciaAplicacao = (rotulo, declaradas, aplicadas) => (declaradas === aplicadas
  ? null
  : incoerencia(
    `${rotulo} declarad${rotulo.startsWith("overrides") ? "os" : "as"} (${declaradas}) divergem d${rotulo.startsWith("overrides") ? "os" : "as"} aplicad${rotulo.startsWith("overrides") ? "os" : "as"} (${aplicadas}) — decisão válida que nunca casa é inerte`,
    { declared: declaradas, applied: aplicadas },
  ))

function auditarConsumo(veredito, pontos, visitados) {
  // VISITA, não inferência a partir dos pontos: um arquivo com zero entradas
  // pode ter sido varrido e não ter saída, ou nunca ter entrado na coleta. Os
  // dois produzem "zero pontos" e só o conjunto de visitados os separa.
  const naoVisitados = veredito.convertedFiles.filter((f) => !visitados.has(f))
  if (naoVisitados.length > 0) {
    return incoerencia(
      `${naoVisitados.length} arquivo(s) em convertedFiles não são varridos pelo inventário — o registry anuncia cobertura que não acontece`,
      { files: naoVisitados },
    )
  }

  return divergenciaAplicacao("decisões de provenance", veredito.provenanceDecisions.length,
    pontos.filter((p) => decisaoValidada(p)).length)
    ?? divergenciaAplicacao("overrides", veredito.overrides.length,
      pontos.filter((p) => p.override != null).length)
    ?? { ok: true }
}

const inventarioBloqueado = (veredito, runtimeScripts) => ({
  schemaVersion: I18N_INVENTORY_SCHEMA,
  jsRegistry: { ok: false, status: veredito.status, reason: veredito.reason, details: veredito.details },
  blocked: true,
  // `null`, NUNCA `0`. Zero é um resultado de medição; aqui não houve medição, e
  // `unknown: 0` num inventário bloqueado seria lido como "nada a classificar" —
  // exatamente a leitura oposta à verdade. Consumidor que somar ou comparar
  // recebe `null` e quebra alto, em vez de propagar um número inventado.
  total: null,
  inScope: null,
  unknown: null,
  byAudience: null,
  runtimeScripts: [...runtimeScripts],
  points: [],
})

/**
 * Sem procedência do loader, nada é aplicado.
 *
 * `jsRegistry` existe para injetar vereditos em teste, e era o buraco: um objeto
 * `{ok:true}` fabricado, com override ancorado num callsite real, reclassificava
 * a mensagem e liberava o gate sem passar por validação alguma. Agora a
 * procedência é exigida ANTES de olhar qualquer conteúdo — quem quiser exercitar
 * caminho hostil precisa escrever os arquivos e passar pelo loader de verdade.
 */
const semProcedencia = {
  ok: false, status: "corrupt",
  reason: "veredito de registry sem procedência de `loadJsRegistry` — overrides e decisões de provenance só se aplicam a partir do loader validado",
  details: {},
}

/** Veredito utilizável, ou a razão para bloquear. */
const vereditoDeEntrada = (repoRoot, jsRegistry) => {
  const v = jsRegistry ?? loadJsRegistry({ repoRoot })
  if (!v.ok) return { bloqueio: v }
  return isValidatedRegistry(v) ? { veredito: v } : { bloqueio: semProcedencia }
}

export function buildInventory({ repoRoot = process.cwd(), registry = {}, jsRegistry = null } = {}) {
  const runtimeScripts = new Set(runtimeReachableScripts(repoRoot))
  const entrada = vereditoDeEntrada(repoRoot, jsRegistry)
  if (entrada.bloqueio) return inventarioBloqueado(entrada.bloqueio, runtimeScripts)
  const veredito = entrada.veredito

  const js = collectJsPoints(repoRoot, runtimeScripts, veredito)
  const pontos = [...js.pontos, ...collectPyPoints(repoRoot)]
  const overrides = overridesPorAncora(veredito.overrides)
  const decisoes = porAncora(veredito.provenanceDecisions)
  const enriquecidos = pontos.map((p) => enrichPoint(p, registry, overrides, decisoes))

  const consumo = auditarConsumo(veredito, enriquecidos, js.visitados)
  if (!consumo.ok) return inventarioBloqueado(consumo, runtimeScripts)

  const porAudiencia = {}
  for (const p of enriquecidos) porAudiencia[p.audience] = (porAudiencia[p.audience] || 0) + 1

  return {
    schemaVersion: I18N_INVENTORY_SCHEMA,
    jsRegistry: {
      ok: true,
      status: veredito.status,
      convertedFiles: veredito.convertedFiles,
      overrides: veredito.overrides.length,
      // Conta pela PROPRIEDADE, não pelo texto do trigger: uma regra AST que um
      // dia se chamasse "override" inflaria a contagem em silêncio.
      overridesApplied: enriquecidos.filter((p) => p.override != null).length,
      provenanceDecisionsApplied: enriquecidos.filter((p) => p.provenanceDecision != null).length,
    },
    blocked: false,
    provenance: unresolvedProvenance({ points: enriquecidos }),
    total: enriquecidos.length,
    inScope: enriquecidos.filter((p) => p.classification === "in_scope").length,
    unknown: enriquecidos.filter((p) => p.audience === "unknown").length,
    byAudience: porAudiencia,
    runtimeScripts: [...runtimeScripts],
    points: enriquecidos,
  }
}

/**
 * Portão da Fase 1: `unknown > 0` IMPEDE avançar para a migração. Sem isso, cada ponto
 * não classificado seria uma mensagem em português com chance de sobreviver ao cutover
 * sem ninguém notar.
 */
/**
 * Estado declarado da Fase 1 (decisão humana no RC). A infraestrutura do detector pode
 * ser mergeada; a FASE não pode ser dada como concluída enquanto houver `unknown`.
 *
 * Este objeto existe para que ninguém — humano ou agente — leia "extractor mergeado"
 * como "inventário pronto". `englishFirstClaimAllowed` é falso e permanece falso até o
 * cutover da Fase 6.
 */
export function phaseStatus(inventory) {
  const gate = phase1Gate(inventory)

  // Registry inválido NÃO é "Fase 1A com N pendências": é ausência de medição.
  // A versão anterior lia `inventory.unknown` direto e anunciava "0 ponto(s) sem
  // audiência" para um inventário que nunca foi computado.
  if (gate.blocked) {
    return {
      schemaVersion: I18N_INVENTORY_SCHEMA,
      phase: "1B",
      phaseStatus: "blocked",
      blocked: true,
      registryStatus: gate.registryStatus,
      unknown: null,
      rcBlocked: true,
      englishFirstClaimAllowed: false,
      nextPhase: "1B",
      reason: gate.reason,
    }
  }

  return faseMedida(gate, inventory)
}

/**
 * A pendência de provenance vira campo próprio porque pode ser a ÚNICA razão de
 * o gate reprovar (com `unknown` já zerado). Um relatório que só falasse de
 * `unknown` diria "0 pontos sem audiência" ao lado de um gate vermelho —
 * contradição aparente, sem causa visível.
 */
const faseMedida = (gate, inventory) => ({
  schemaVersion: I18N_INVENTORY_SCHEMA,
  phase: gate.ok ? "1" : "1A",
  phaseStatus: gate.ok ? "complete" : "partial",
  blocked: false,
  registryStatus: gate.registryStatus,
  unknown: inventory.unknown,
  provenanceOk: gate.provenanceOk !== false,
  unresolvedProvenance: gate.unresolvedProvenance ?? 0,
  rcBlocked: true,
  englishFirstClaimAllowed: false,
  nextPhase: gate.ok ? "2" : "1B",
  reason: gate.ok
    ? "inventário sem unknown e com provenance resolvida — Fase 1 encerrada; migração pode começar"
    : `Fase 1A: extractor e gate fail-closed entregues. ${gate.reason} Fase 1B classifica e zera.`,
})

const estaBloqueado = (inv) => inv.blocked === true || inv.jsRegistry?.ok === false

const gateBloqueado = (r) => ({
  ok: false,
  blocked: true,
  registryStatus: r.status ?? "unknown",
  unknown: null,
  reason: `registry de saída JS ${r.status ?? "inválido"}: ${r.reason ?? "sem motivo declarado"}`,
  details: r.details ?? {},
})

const razaoUnknown = (n) => (n === 0
  ? null
  : `${n} ponto(s) de saída sem audiência determinada — classificar antes de migrar`)

/**
 * Zerar `unknown` NÃO basta para liberar a Fase 1.
 *
 * A Fatia 4 criou `unresolvedProvenance` e o expôs no inventário, mas o gate
 * continuou olhando só a contagem — ou seja, o veredito era anunciado e inerte,
 * exatamente o defeito que este programa já corrigiu noutros lugares. Um ponto
 * `in_scope` cuja origem de argumento é indeterminada não está pronto para
 * migrar: quem traduz não sabe o que é literal e o que veio de fora.
 */
const PROVENANCE_NEUTRA = Object.freeze({ ok: true, count: 0, reason: null })

/** As duas razões saem juntas: corrigir uma sem saber da outra é trabalho repetido. */
const razaoDoGate = (nUnknown, prov) =>
  [razaoUnknown(nUnknown), prov.ok === false ? prov.reason : null].filter(Boolean).join(" | ") || null

const gateMedido = (inv) => {
  const prov = inv.provenance ?? PROVENANCE_NEUTRA
  const provOk = prov.ok !== false
  return {
    ok: inv.unknown === 0 && provOk,
    blocked: false,
    registryStatus: inv.jsRegistry?.status ?? "fresh",
    unknown: inv.unknown,
    provenanceOk: provOk,
    unresolvedProvenance: prov.count ?? 0,
    reason: razaoDoGate(inv.unknown, prov),
  }
}

/**
 * ORDEM IMPORTA. Num inventário bloqueado `unknown` é `null` — não medido. A
 * checagem de bloqueio vem PRIMEIRO para que o gate nunca dependa de contagem
 * nesse caminho: se um dia alguém trocar `null` por `0`, o gate continua
 * reprovando em vez de aprovar um inventário que nunca foi computado.
 */
export function phase1Gate(inventory) {
  return estaBloqueado(inventory) ? gateBloqueado(inventory.jsRegistry ?? {}) : gateMedido(inventory)
}

/**
 * Valida o registry contra a realidade: entrada apontando para arquivo inexistente, ou
 * para script que não é mais alcançado pelo runtime, é lixo acumulado que daria falsa
 * sensação de cobertura.
 */
const scriptProblem = (alvo, runtime) => (runtime.has(alvo.split("/").pop())
  ? null
  : "script não é alcançado pelo runtime — não pertence à claim")

const pathProblem = (chave, repoRoot, runtime) => {
  const alvo = chave.includes(":") ? chave.split(":")[0] : chave
  if (!existsSync(join(repoRoot, alvo))) return "arquivo não existe"
  return alvo.startsWith("scripts/") ? scriptProblem(alvo, runtime) : null
}

function registryEntryProblem(chave, audiencia, repoRoot, runtime) {
  if (!AUDIENCES.includes(audiencia)) return `audiência inválida: ${audiencia}`
  return chave.endsWith("/") ? null : pathProblem(chave, repoRoot, runtime)
}

export function validateRegistry(registry = {}, repoRoot = process.cwd()) {
  const runtime = new Set(runtimeReachableScripts(repoRoot))
  const problemas = Object.entries(registry)
    .map(([chave, audiencia]) => ({ chave, erro: registryEntryProblem(chave, audiencia, repoRoot, runtime) }))
    .filter((x) => x.erro)
  return { ok: problemas.length === 0, problemas }
}
