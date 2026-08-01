import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { join, relative, sep } from "path"

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

/** Audiências possíveis. `unknown` bloqueia; ausência de classificação não existe. */
export const AUDIENCES = Object.freeze([
  "public_diagnostic",       // aparece normalmente ou após falha — entra, deve ser inglês
  "public_security_decision", // bloqueio/approval/alerta — entra, deve ser inglês
  "machine_protocol",        // JSON/IDs/enums/códigos — inglês estável, sem texto localizado
  "internal_debug",          // diagnóstico interno explicitamente ativado — fora da claim
  "external_passthrough",    // saída de subprocesso externo — fora da claim
  "generated_app_copy",      // texto do app do usuário — segue o idioma do projeto
  "generated_dev_surface",   // mensagem técnica no projeto gerado — entra, inglês
  "user_content",            // conteúdo do usuário — nunca traduzir
  "unknown",                 // audiência indeterminada — BLOQUEIA a Fase 1
])

const IN_SCOPE_AUDIENCES = new Set(["public_diagnostic", "public_security_decision", "generated_dev_surface"])

export const isInScope = (audience) => IN_SCOPE_AUDIENCES.has(audience)

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
function classifyJsFile(absPath, repoRoot) {
  const text = readSafe(absPath)
  return scanFile(absPath, repoRoot, SINKS_JS).map((p) => ({
    ...p,
    ...classifyJsPoint({ sink: p.sink, emitsJson: emitsJsonAt(text, p.line) }),
  }))
}

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
export function classifyHookPoint({ sink, guardedByDebug = false, insideExceptHandler = false }) {
  if (sink === "json") return { audience: "machine_protocol", trigger: "hook_protocol" }
  if (guardedByDebug) return { audience: "internal_debug", trigger: "debug_flag" }
  if (sink === "stderr" && insideExceptHandler) return { audience: "public_diagnostic", trigger: "hook_failure" }
  if (sink === "stdout") return { audience: "machine_protocol", trigger: "hook_protocol" }
  return { audience: "unknown", trigger: null }
}

const DEBUG_GUARD = /\b(DEBUG|VERBOSE|GSTACK_DEBUG)\b/
const EXCEPT_NEARBY = /\bexcept\b|\braise\b|\bsys\.exit\b/

/** Contexto local de uma linha Python — base objetiva para `classifyHookPoint`. */
function pythonContext(text, line) {
  const linhas = text.split("\n")
  const janela = linhas.slice(Math.max(0, line - 6), line).join("\n")
  return { guardedByDebug: DEBUG_GUARD.test(janela), insideExceptHandler: EXCEPT_NEARBY.test(janela) }
}

/**
 * Constrói o inventário completo. `registry` é dado configurável e VERSIONADO: mapeia
 * `file` (ou prefixo) para audiência declarada. Toda entrada do registry é validada
 * contra os entry points reais — um registro que aponta para arquivo inexistente ou
 * para script que deixou de ser runtime é ERRO, não decoração.
 */
const collectJsPoints = (repoRoot, runtimeScripts) => [
  ...walkFiles(join(repoRoot, "src"), [".js", ".mjs", ".cjs"]),
  ...walkFiles(join(repoRoot, "templates"), [".js", ".mjs", ".cjs", ".ts", ".tsx"]),
  // mantenedor/CI fica fora da claim — por derivação do grafo, não por lista
  ...walkFiles(join(repoRoot, "scripts"), [".mjs", ".js", ".cjs"])
    .filter((f) => runtimeScripts.has(relative(repoRoot, f).split(sep).pop())),
].flatMap((f) => classifyJsFile(f, repoRoot))

const collectPyPoints = (repoRoot) => walkFiles(join(repoRoot, "hooks"), [".py"]).flatMap((f) => {
  const text = readSafe(f)
  return scanFile(f, repoRoot, SINKS_PY).map((p) => ({ ...p, ...classifyHookPoint({ sink: p.sink, ...pythonContext(text, p.line) }) }))
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

function enrichPoint(p, registry) {
  if (jaClassificado(p)) return finalize(p, p.audience, p.trigger || null)
  const declarado = declaredFor(registry, p)
  if (declarado) return finalize(p, declarado, "registry")
  return finalize(p, audienceBySink(p.sink) || "unknown", p.trigger || null)
}

export function buildInventory({ repoRoot = process.cwd(), registry = {} } = {}) {
  const runtimeScripts = new Set(runtimeReachableScripts(repoRoot))
  const pontos = [...collectJsPoints(repoRoot, runtimeScripts), ...collectPyPoints(repoRoot)]
  const enriquecidos = pontos.map((p) => enrichPoint(p, registry))

  const porAudiencia = {}
  for (const p of enriquecidos) porAudiencia[p.audience] = (porAudiencia[p.audience] || 0) + 1

  return {
    schemaVersion: I18N_INVENTORY_SCHEMA,
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
  return {
    schemaVersion: I18N_INVENTORY_SCHEMA,
    phase: gate.ok ? "1" : "1A",
    phaseStatus: gate.ok ? "complete" : "partial",
    unknown: inventory.unknown,
    rcBlocked: true,
    englishFirstClaimAllowed: false,
    nextPhase: gate.ok ? "2" : "1B",
    reason: gate.ok
      ? "inventário sem unknown — Fase 1 encerrada; migração pode começar"
      : `Fase 1A: extractor e gate fail-closed entregues; ${inventory.unknown} ponto(s) sem audiência. Fase 1B classifica e zera.`,
  }
}

export function phase1Gate(inventory) {
  return {
    ok: inventory.unknown === 0,
    unknown: inventory.unknown,
    reason: inventory.unknown === 0
      ? null
      : `${inventory.unknown} ponto(s) de saída sem audiência determinada — classificar antes de migrar`,
  }
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
