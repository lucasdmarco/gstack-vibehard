#!/usr/bin/env node
/**
 * MATRIZ DE COMPATIBILIDADE DO RUNTIME — Trilha B2 do PRD51.
 *
 * O que esta matriz responde, e o que NAO responde. Ela mede se o PACOTE REAL
 * funciona num dado Node. Ela NAO mede se a suite de testes roda naquele Node —
 * sao claims separadas, e confundi-las foi exatamente o erro que produziu o
 * `P0.NODE-SUPPORT-GATE-INVALID`: a suite falha em Node 18 por
 * `import.meta.dirname` em 351 arquivos de TESTE, o que nada diz sobre o produto.
 *
 * POR QUE NAO COMPARAR VERSOES ENTRE SI. Uma falha identica em todas as versoes
 * passaria como sucesso. Prova viva: `context stats` NAO EXISTE e sai com codigo
 * 0 imprimindo o help — um criterio por exit code ou por igualdade entre versoes
 * aprovaria esse comando em 18/20/22/24 sem que ele exista. Por isso cada
 * comando tem ORACULO SEMANTICO proprio, verificando efeito ou conteudo.
 *
 * FALHA DE AMBIENTE NAO E INCOMPATIBILIDADE. Se o binario nao roda, o npm nao
 * instala ou o tarball nao chega, o veredito e `test_environment_unsupported` —
 * nunca `runtime_incompatible`. Confundir os dois transformaria indisponibilidade
 * de infraestrutura em julgamento sobre o produto.
 *
 * Uso:
 *   node scripts/test-runtime-matrix.mjs --node <path> [--node <path> ...]
 *   node scripts/test-runtime-matrix.mjs --tarball <tgz> --node <path>
 *   node scripts/test-runtime-matrix.mjs --json
 *
 * `--tarball` e obrigatorio em CI: sem ele o script empacota, e uma matriz de 12
 * jobs empacotaria 12 vezes — o Node deixaria de ser a unica variavel.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync, cpSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const isWin = process.platform === "win32"

// ── Argumentos ───────────────────────────────────────────────────────────────

/** Flags que ACUMULAM valores, e as que guardam um valor unico. */
const LISTAS = { "--node": "nodes", "--aggregate": "agregarDe" }
const UNICOS = { "--tarball": "tarball", "--cache-seed": "cacheSeed" }

function parseArgs(argv) {
  const r = { nodes: [], agregarDe: [], tarball: null, cacheSeed: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (LISTAS[flag]) r[LISTAS[flag]].push(argv[++i])
    else if (UNICOS[flag]) r[UNICOS[flag]] = argv[++i]
    else if (flag === "--json") r.json = true
  }
  return r
}

// ── Sandbox: nenhum subprocesso herda diretorio gravavel real ────────────────

/**
 * Redireciona TUDO que um processo poderia escrever para dentro do descartavel.
 *
 * A lista e longa de proposito: basta uma variavel esquecida para o npm ou o
 * proprio produto escreverem no HOME real, e a matriz passaria a medir um
 * ambiente contaminado.
 */
function ambienteIsolado(sandbox, nodeBin, cacheSeed = null) {
  const sub = (nome) => {
    const p = path.join(sandbox, nome)
    mkdirSync(p, { recursive: true })
    return p
  }
  const home = sub("home")
  const temp = sub("temp")
  const cache = sub("npm-cache")
  const prefix = sub("npm-prefix")

  // O cache da sandbox nasce VAZIO por design — isolamento. Mas isso descartava
  // o cache comum que o CI prepara: `NPM_CONFIG_CACHE` era sobrescrito e cada
  // linha da matriz resolvia a arvore pela REDE, podendo baixar entradas
  // diferentes ou falhar. Com `--cache-seed`, o conteudo verificado e COPIADO
  // para dentro da sandbox: a instalacao fica offline e o isolamento continua.
  if (cacheSeed && existsSync(cacheSeed)) cpSync(cacheSeed, cache, { recursive: true })

  return {
    ...process.env,
    // O Node ALVO encabeça o PATH. Sem isto, o produto roda sob o alvo mas
    // qualquer `execFileSync("node", …)` interno alcança o Node do host — foi o
    // que o diagnóstico do WIP revelou: `doctor.versions.node` reportava a versão
    // do host em todas as linhas da matriz. Um usuário real com Node 18 instalado
    // tem Node 18 no PATH; a sandbox precisa refletir isso.
    PATH: `${path.dirname(nodeBin)}${path.delimiter}${process.env.PATH ?? ""}`,
    Path: `${path.dirname(nodeBin)}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: home,
    USERPROFILE: home,
    TEMP: temp, TMP: temp, TMPDIR: temp,
    APPDATA: sub("appdata"),
    LOCALAPPDATA: sub("localappdata"),
    XDG_CONFIG_HOME: sub("xdg-config"),
    XDG_CACHE_HOME: sub("xdg-cache"),
    XDG_STATE_HOME: sub("xdg-state"),
    GIT_CONFIG_GLOBAL: path.join(sandbox, "gitconfig"),
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_PREFIX: prefix,
    NPM_CONFIG_USERCONFIG: path.join(sandbox, "npmrc"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
    NO_COLOR: "1",
  }
}

/**
 * Caminhos globais REAIS que a matriz nao pode tocar.
 *
 * Allowlist e nao snapshot do HOME inteiro: o HOME real muda o tempo todo por
 * outros processos, e comparar tudo produziria falso positivo constante.
 *
 * E a allowlist mira o que o INSTALADOR declara escrever — nao o diretorio
 * inteiro da ferramenta de terceiros. Vigiar `.codex/` cru deu falso positivo na
 * primeira medicao: o Codex CLI do usuario, rodando em paralelo, gravou em
 * `sessions/`, `logs_2.sqlite` e `process_manager/`. Nada disso e do GStack, e
 * acusar vazamento ali seria culpar o produto por atividade alheia.
 */
const CAMINHOS_VIGIADOS = [
  ".codex/hooks",
  ".claude/hooks",
  ".claude/skills",
  ".agents/skills",
  ".config/opencode/opencode.json",
  ".config/gstack",
  ".gstack_vibehard",
  ".npmrc",
]

const impressaoGlobal = () => {
  const raiz = process.env.USERPROFILE || process.env.HOME || ""
  const marca = (rel) => {
    const p = path.join(raiz, rel)
    if (!existsSync(p)) return `${rel}:ausente`
    const s = statSync(p)
    return `${rel}:${s.isDirectory() ? readdirSync(p).length : s.size}`
  }
  return CAMINHOS_VIGIADOS.map(marca).join("|")
}

// ── Execucao ─────────────────────────────────────────────────────────────────

/**
 * Timeouts separados por natureza da operação.
 *
 * O install extrai ~1000 arquivos com o cache do npm VAZIO — a sandbox começa
 * limpa de propósito. Isso levou mais de 180s na primeira medição e o
 * `spawnSync` devolveu `status: null`, que o runner classificou como
 * `test_environment_unsupported`. A classificação estava certa (é ambiente, não
 * produto), mas o limite estava errado.
 */
const TIMEOUT_INSTALL = 900000
const TIMEOUT_COMANDO = 420000

const rodar = (bin, args, opts) => spawnSync(bin, args, {
  encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: TIMEOUT_COMANDO, ...opts,
})

const npm = (nodeBin, args, opts) => {
  // `npm` do Node alvo, invocado pelo proprio binario alvo — assim os lifecycle
  // scripts rodam na versao sob teste, nao na do host.
  const cli = path.join(path.dirname(nodeBin), "node_modules", "npm", "bin", "npm-cli.js")
  if (existsSync(cli)) return rodar(nodeBin, [cli, ...args], opts)
  return isWin ? rodar("cmd.exe", ["/c", "npm", ...args], opts) : rodar("npm", args, opts)
}

const sha256 = (arquivo) => `sha256:${createHash("sha256").update(readFileSync(arquivo)).digest("hex")}`

// ── Oraculos ─────────────────────────────────────────────────────────────────

const ok = (nome, detalhe = null) => ({ nome, ok: true, detalhe })
const falhou = (nome, motivo) => ({ nome, ok: false, motivo })

const parseJson = (texto) => { try { return JSON.parse(texto) } catch { return null } }

/**
 * Por que um comando nao devolveu JSON.
 *
 * `spawnSync` mata por timeout devolvendo `status:null` com stdout E stderr
 * VAZIOS — indistinguivel, na mensagem, de "o comando imprimiu lixo". A primeira
 * medicao reportou `stdout nao e JSON puro: ""` em tres oraculos, e a causa real
 * era carga da maquina, nao saida suja. Confundir os dois mandaria alguem
 * investigar o produto quando o problema e o limite de tempo.
 */
const morreuPorTempo = (r) => r.error?.code === "ETIMEDOUT" || (r.status === null && !r.stdout && !r.stderr)

function motivoSemJson(r) {
  if (morreuPorTempo(r)) return `TIMEOUT apos ${TIMEOUT_COMANDO / 1000}s (sem saida) — ambiente, nao produto`
  const amostra = (r.stdout || r.stderr || "").slice(0, 140).replace(/\s+/g, " ").trim()
  return `stdout nao e JSON puro (exit ${r.status}): ${amostra || "(vazio)"}`
}

/**
 * Cada oraculo verifica CONTEUDO ou EFEITO, nunca so o exit code.
 *
 * `doctor.versions.node` e o mais forte da matriz: prova ao mesmo tempo que o
 * binario alvo executou e que o produto le a propria versao corretamente.
 */
function oraculoDoctor(chamar, versaoEsperada) {
  const r = chamar(["doctor", "--json"])
  const j = parseJson(r.stdout)
  if (!j) return falhou("doctor", motivoSemJson(r))
  if (j.versions?.node !== versaoEsperada) {
    return falhou("doctor", `versions.node=${j.versions?.node}, esperado ${versaoEsperada}`)
  }
  if (typeof j.ok !== "boolean") return falhou("doctor", "campo `ok` ausente")
  return ok("doctor", { node: j.versions.node, os: j.os })
}

/** Primeira regra violada, ou `null`. Mantem cada oraculo declarativo e raso. */
const primeiraFalha = (regras) => regras.find(([violada]) => violada)?.[1] ?? null

/** Aplica as regras e devolve o veredito do oraculo. */
const veredito = (nome, regras, detalhe) => {
  const problema = primeiraFalha(regras)
  return problema ? falhou(nome, problema) : ok(nome, detalhe())
}

const contagensNumericas = (s) => typeof s.REAL === "number" && typeof s.PLACEBO === "number"

function oraculoDreamAudit(chamar) {
  const r = chamar(["dream", "audit", "--json"])
  const j = parseJson(r.stdout)
  if (!j) return falhou("dream-audit", motivoSemJson(r))
  const s = j.summary || j
  // INVARIANTES, nao snapshot: `REAL === 24` quebraria ao adicionar capacidade.
  return veredito("dream-audit", [
    [!contagensNumericas(s), "summary sem contagens numericas"],
    [s.PLACEBO !== 0, `PLACEBO=${s.PLACEBO}, esperado 0`],
    [s.REAL <= 0, `REAL=${s.REAL}, esperado > 0`],
  ], () => ({ REAL: s.REAL, PARTIAL: s.PARTIAL ?? null, PLACEBO: s.PLACEBO }))
}

function oraculoCreate(chamar, ws) {
  const r = chamar(["create", "smoke-app", "--lite"], ws)
  const appJson = path.join(ws, "smoke-app", ".gstack", "app.json")
  if (!existsSync(appJson)) return falhou("create", `sem .gstack/app.json (exit ${r.status})`)
  const j = parseJson(readFileSync(appJson, "utf-8"))
  if (j?.mode !== "lite") return falhou("create", `mode=${j?.mode}, esperado lite`)
  return ok("create", { mode: j.mode })
}

const AGULHA = "ZQXJV-runtime-matrix-needle"

/** A busca encontrou o documento plantado? Aceita JSON ou texto. */
const buscaEncontrou = (saida) => {
  const j = parseJson(saida)
  if (!j) return saida.includes(AGULHA)
  return JSON.stringify(j).includes(AGULHA) || (j.results?.length ?? 0) > 0
}

/** `context init` + `index` + `search`: o oraculo e ENCONTRAR o documento plantado. */
function oraculoContexto(chamar, proj) {
  const init = chamar(["context", "init"], proj)
  if (!existsSync(path.join(proj, ".gstack", "context.json"))) {
    return falhou("context", `init nao criou .gstack/context.json (exit ${init.status})`)
  }
  const docs = path.join(proj, "docs", "adr")
  mkdirSync(docs, { recursive: true })
  writeFileSync(path.join(docs, "adr-matrix.md"), `# ADR matriz\n\n${AGULHA}\n`)

  chamar(["context", "index"], proj)
  const busca = chamar(["context", "search", AGULHA, "--json"], proj)
  return veredito("context", [
    [!buscaEncontrou(`${busca.stdout || ""}`), "search nao encontrou o documento plantado"],
  ], () => ({ indexado: true }))
}

function oraculoVerify(chamar, proj) {
  const r = chamar(["verify", "--json"], proj)
  const j = parseJson(r.stdout)
  if (!j) return falhou("verify", motivoSemJson(r))
  for (const campo of ["runId", "profile", "archetype", "status"]) {
    if (j[campo] === undefined) return falhou("verify", `campo \`${campo}\` ausente`)
  }
  const STATUS = ["ready", "ready_with_warnings", "blocked", "degraded"]
  if (!STATUS.includes(j.status)) return falhou("verify", `status fora do vocabulario: ${j.status}`)
  return ok("verify", { status: j.status, archetype: j.archetype })
}

/**
 * `proof` tem DOIS cenarios, e nenhum deles e "exit 0".
 *
 *   negativo  — diretorio sem projeto: exige JSON `gstack.proof.v1` estruturado,
 *               `ready:false` e blockers nomeados. Bloqueio estruturado e o
 *               comportamento CORRETO, nao falha.
 *   parcial   — projeto criado: exige um subcheck que passa DE VERDADE.
 *
 * `ready:true` NAO e alvo: os gates `hard` incluem `graphify-freshness` (binario
 * Python externo) e `git-tree`. Satisfaze-los exigiria instalar Graphify e Python
 * na sandbox, introduzindo variaveis que contaminam justamente o que se mede.
 * Por isso o cenario chama-se `partial_structured_execution`, e e PROIBIDO
 * reivindicar `positive proof path` a partir dele.
 */
const semBlockers = (j) => !Array.isArray(j.blockers) || j.blockers.length === 0

function oraculoProofNegativo(chamar, vazio) {
  const r = chamar(["proof", "--json"], vazio)
  const j = parseJson(r.stdout)
  if (!j) return falhou("proof-negativo", motivoSemJson(r))
  return veredito("proof-negativo", [
    [j.schemaVersion !== "gstack.proof.v1", `schema=${j.schemaVersion}`],
    [j.ready !== false, `ready=${j.ready}, esperado false`],
    [semBlockers(j), "sem blockers declarados"],
    [/\n\s+at\s/.test(r.stderr || ""), "vazou stack trace"],
  ], () => ({ blockers: j.blockers.length }))
}

const problemaDoAudit = (audit) => primeiraFalha([
  [!audit, "checks.dreamAudit ausente"],
  [audit?.ok !== true, `dreamAudit.ok=${audit?.ok} — nenhum subcheck passou`],
  [audit?.summary?.PLACEBO !== 0, `PLACEBO=${audit?.summary?.PLACEBO}`],
])

function oraculoProofParcial(chamar, proj) {
  const r = chamar(["proof", "--json"], proj)
  const j = parseJson(r.stdout)
  if (!j) return falhou("proof-parcial", motivoSemJson(r))
  const problema = problemaDoAudit(j.checks?.dreamAudit)
  if (problema) return falhou("proof-parcial", problema)
  return ok("proof-parcial", { cenario: "partial_structured_execution", dreamAuditOk: true, ready: j.ready })
}

/**
 * Backend do State Store: OBSERVADO, nunca presumido pela versao. `node:sqlite`
 * entra no 22.5 e ja foi experimental; a allowlist autoriza a degradacao pela
 * CAPACIDADE ausente, nao pelo numero da versao.
 */
function oraculoState(chamar, proj) {
  const r = chamar(["state", "--json"], proj)
  const j = parseJson(r.stdout)
  if (!j) return falhou("state", motivoSemJson(r))
  if (!["sqlite", "jsonl_fallback"].includes(j.backend)) {
    return falhou("state", `backend desconhecido: ${j.backend}`)
  }
  return ok("state", { backend: j.backend, file: path.basename(j.file || "") })
}

/**
 * O AMBIENTE resolve para o Node alvo, em todos os caminhos?
 *
 * Sem isto a matriz mede o Node errado sem avisar. O diagnostico do WIP mostrou
 * o `doctor` reportando a versao do HOST nas quatro linhas, porque
 * `src/installer/doctor.js:68` faz `execFileSync("node", ["--version"])` — le o
 * PATH, nao `process.version`. Isso e legitimo no produto (ele diagnostica o
 * ambiente do usuario) e NAO se limita ao doctor: qualquer subprocesso que
 * invoque `node`, `npm` ou `npx` herda a mesma resolucao.
 *
 * Enquanto essas tres coisas nao coincidirem, nenhum resultado da rodada diz
 * nada sobre o produto — o veredito e `test_environment_invalid`.
 */
/** Primeiro `node` que o PATH resolve, do ponto de vista do ambiente isolado. */
const nodeResolvidoNoPath = (env) => {
  const w = rodar(isWin ? "where.exe" : "which", ["node"], { env })
  return (w.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? ""
}

const mesmoDiretorio = (a, b) => Boolean(a) && Boolean(b)
  && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

function verificarAmbienteNode(nodeBin, env, versaoEsperada) {
  const processVersion = (rodar(nodeBin, ["-p", "process.version"], { env }).stdout || "").trim()
  const resolvido = nodeResolvidoNoPath(env)
  const dirAlvo = path.dirname(nodeBin)
  const pathApontaAlvo = mesmoDiretorio(resolvido ? path.dirname(resolvido) : "", dirAlvo)

  const problemas = primeiraFalha([
    [processVersion !== versaoEsperada,
      `\`${path.basename(nodeBin)} -p process.version\` = ${processVersion || "(vazio)"}, esperado ${versaoEsperada}`],
    [!pathApontaAlvo,
      `PATH resolve \`node\` para ${resolvido || "(nada)"}, esperado dentro de ${dirAlvo}`],
  ])
  return { processVersion, nodeNoPath: resolvido, pathApontaAlvo, problemas: problemas ? [problemas] : [] }
}

/** `node:sqlite` esta disponivel NESTE binario? Detecta a capacidade, nao a versao. */
function detectarSqlite(nodeBin, env) {
  const r = rodar(nodeBin, ["-e", "try{const m=process.getBuiltinModule?process.getBuiltinModule('node:sqlite'):null;process.stdout.write(m&&m.DatabaseSync?'1':'0')}catch{process.stdout.write('0')}"], { env })
  return r.stdout === "1"
}

// ── Uma versao ───────────────────────────────────────────────────────────────

function versaoDoBinario(nodeBin) {
  const r = rodar(nodeBin, ["--version"], {})
  return r.status === 0 ? (r.stdout || "").trim() : null
}

function prepararProjeto(nodeBin, sandbox, tarball, env, offline) {
  const proj = path.join(sandbox, "proj")
  mkdirSync(proj, { recursive: true })
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "matrix-host", private: true, version: "1.0.0" }))

  // `--offline` PROIBE rede; `--prefer-offline` apenas a evita quando pode. Com
  // cache seed, a instalacao precisa ser reproduzivel: se falta entrada, o certo
  // e falhar como ambiente, nao completar silenciosamente pela rede — senao a
  // matriz volta a medir disponibilidade de rede junto com o Node.
  const rede = offline ? ["--offline"] : []
  const inst = npm(nodeBin, ["install", "--no-audit", "--no-fund", "--silent", ...rede, tarball], {
    cwd: proj, env, timeout: TIMEOUT_INSTALL,
  })
  if (inst.status !== 0) {
    const causa = inst.status === null ? `timeout apos ${TIMEOUT_INSTALL / 1000}s` : `exit ${inst.status}`
    return { erro: `npm install falhou (${causa}): ${(inst.stderr || "").slice(0, 200)}` }
  }
  const entry = path.join(proj, "node_modules", "@gstack-vibehard", "installer", "src", "index.js")
  if (!existsSync(entry)) return { erro: "pacote instalado sem src/index.js" }
  return { proj, entry }
}

/** Roda os nove oraculos do produto, na ordem em que um usuario os encontraria. */
function rodarOraculos(nodeBin, env, prep, sandbox, versao, tarball) {
  const chamar = (args, cwd = prep.proj) => rodar(nodeBin, [prep.entry, ...args], { cwd, env })
  const ws = path.join(sandbox, "ws")
  const vazio = path.join(sandbox, "vazio")
  mkdirSync(ws, { recursive: true })
  mkdirSync(vazio, { recursive: true })

  return [
    ok("install", { tarball: path.basename(tarball) }),
    oraculoDoctor(chamar, versao),
    oraculoDreamAudit(chamar),
    oraculoCreate(chamar, ws),
    oraculoContexto(chamar, prep.proj),
    oraculoVerify(chamar, prep.proj),
    oraculoProofNegativo(chamar, vazio),
    oraculoProofParcial(chamar, prep.proj),
    oraculoState(chamar, prep.proj),
  ]
}

/** Monta o resultado de uma versao que chegou ate os oraculos. */
function resultadoMedido({ versao, nodeBin, env, prep, checks, amb, sqlite, backend }) {
  const falhas = checks.filter((c) => !c.ok)
  return {
    node: versao,
    npm: npm(nodeBin, ["--version"], { env, cwd: prep.proj }).stdout?.trim() ?? null,
    os: `${process.platform}/${process.arch}`,
    // Registrado no relatorio: sem isto, ninguem consegue auditar DEPOIS que a
    // rodada mediu o Node certo.
    ambiente: {
      processVersion: amb.processVersion,
      nodeNoPath: amb.nodeNoPath,
      pathApontaAlvo: amb.pathApontaAlvo,
      doctorVersion: checks.find((c) => c.nome === "doctor")?.detalhe?.node ?? null,
    },
    sqlite_available: sqlite,
    backend_observado: backend,
    degradacao_autorizada: !sqlite && backend === "jsonl_fallback",
    verdict: falhas.length === 0 ? "runtime_compatible" : "runtime_incompatible",
    checks,
    falhas: falhas.map((f) => `${f.nome}: ${f.motivo}`),
  }
}

/** Executa a medicao dentro da sandbox ja criada. */
function medirNaSandbox(nodeBin, tarball, sandbox, versao, antes, opcoes = {}) {
  const env = ambienteIsolado(sandbox, nodeBin, opcoes.cacheSeed)

  // ANTES de qualquer oraculo do produto: o ambiente resolve para o alvo? Se
  // nao, a rodada nao mede o produto — e dizer `runtime_incompatible` aqui seria
  // atribuir ao GStack um defeito do arranjo de teste.
  const amb = verificarAmbienteNode(nodeBin, env, versao)
  if (amb.problemas.length > 0) {
    return {
      node: versao,
      verdict: "test_environment_invalid",
      motivo: amb.problemas.join(" | "),
      ambiente: { processVersion: amb.processVersion, nodeNoPath: amb.nodeNoPath, pathApontaAlvo: amb.pathApontaAlvo },
    }
  }

  const prep = prepararProjeto(nodeBin, sandbox, tarball, env, Boolean(opcoes.cacheSeed))
  if (prep.erro) return { node: versao, verdict: "test_environment_unsupported", motivo: prep.erro }

  const checks = rodarOraculos(nodeBin, env, prep, sandbox, versao, tarball)
  const sqlite = detectarSqlite(nodeBin, env)
  const backend = checks.find((c) => c.nome === "state")?.detalhe?.backend ?? null

  const depois = impressaoGlobal()
  checks.push(antes === depois
    ? ok("isolamento", { escopo: CAMINHOS_VIGIADOS.length })
    : falhou("isolamento", `escrita fora da sandbox: ${antes} -> ${depois}`))

  return resultadoMedido({ versao, nodeBin, env, prep, checks, amb, sqlite, backend })
}

function medirVersao(nodeBin, tarball, opcoes = {}) {
  const versao = versaoDoBinario(nodeBin)
  if (!versao) {
    return { node: nodeBin, verdict: "test_environment_unsupported", motivo: "binario Node nao executa" }
  }
  const sandbox = mkdtempSync(path.join(tmpdir(), "gstack-rt-"))
  try {
    return medirNaSandbox(nodeBin, tarball, sandbox, versao, impressaoGlobal(), opcoes)
  } finally {
    try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* sandbox some no reboot */ }
  }
}

// ── Leituras ─────────────────────────────────────────────────────────────────

/**
 * `strict` reprova qualquer diferenca de backend entre versoes.
 * `declared_degradation` aceita a degradacao PREVISTA (sqlite ausente ->
 * jsonl_fallback), que e o design do PRD14. As duas leituras saem juntas, por
 * decisao humana: qual delas rege o contrato publico e escolha do RC.
 */
/** Vereditos que NAO falam do produto: infraestrutura ou arranjo de teste. */
const VEREDITOS_DE_AMBIENTE = new Set(["test_environment_unsupported", "test_environment_invalid"])

const nomes = (rs) => rs.map((r) => r.node).join(", ")

/** Uma leitura: `ok` quando nao ha razao contraria. Razao vazia nunca acompanha `ok:false`. */
const leitura = (razoes) => ({ ok: razoes.length === 0, motivo: razoes.join(" | ") || null })

function leituras(resultados) {
  const uteis = resultados.filter((r) => !VEREDITOS_DE_AMBIENTE.has(r.verdict))

  // Uma rodada sem NENHUMA linha util nao prova nada. Declarar `ok:true` porque
  // "nao houve incompatibilidade" seria verde por ausencia de medicao.
  if (uteis.length === 0) {
    const semMedicao = { ok: false, motivo: "nenhuma versao produziu medicao valida do produto — rodada inconclusiva" }
    return { strict: semMedicao, declared_degradation: semMedicao }
  }

  const backends = new Set(uteis.map((r) => r.backend_observado))
  const incompativeis = uteis.filter((r) => r.verdict !== "runtime_compatible")
  const naoAutorizadas = uteis.filter((r) => r.backend_observado !== "sqlite" && !r.degradacao_autorizada)

  // Todo veredito negativo carrega a razao. O diagnostico do WIP devolveu
  // `ok:false` com `motivo:null` porque a razao so cobria a degradacao e as
  // incompatibilidades ficavam mudas — veredito sem razao nao e utilizavel.
  const comuns = incompativeis.length > 0 ? [`incompativel em: ${nomes(incompativeis)}`] : []
  const doBackend = backends.size > 1 ? [`backend difere entre versoes: ${[...backends].join(", ")}`] : []
  const daDegradacao = naoAutorizadas.length > 0
    ? [`degradacao sem capacidade ausente que a autorize: ${nomes(naoAutorizadas)}`]
    : []

  return {
    strict: leitura([...comuns, ...doBackend]),
    declared_degradation: leitura([...comuns, ...daDegradacao]),
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function empacotar() {
  const saida = mkdtempSync(path.join(tmpdir(), "gstack-pack-"))
  const r = execFileSync(isWin ? "cmd.exe" : "npm", isWin ? ["/c", "npm", "pack", "--pack-destination", saida] : ["pack", "--pack-destination", saida], { cwd: repoRoot, encoding: "utf-8" })
  const nome = r.trim().split("\n").pop().trim()
  return path.join(saida, nome)
}

/**
 * Só executa quando INVOCADO, nunca quando importado.
 *
 * Sem esta guarda o script rodava (e chamava `process.exit`) ao ser importado
 * por um teste, derrubando o processo do runner de testes — um script que se
 * auto-executa ao ser importado não é testável.
 */
const executadoDiretamente = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

const MARCA = Object.freeze({
  runtime_compatible: "OK  ",
  runtime_incompatible: "FAIL",
  test_environment_unsupported: "ENV ",
  test_environment_invalid: "INVA",
})

const linhaDe = (r) =>
  `  ${MARCA[r.verdict] ?? "????"} ${String(r.node).padEnd(10)} backend=${r.backend_observado ?? "-"} sqlite=${r.sqlite_available ?? "-"} ${r.motivo ?? ""}`

const textoDaLeitura = (nome, l) => `  ${nome}: ${l.ok ? "pass" : `fail — ${l.motivo}`}`

function imprimirTexto(relatorio) {
  const linhas = [`\nmatriz de runtime — ${relatorio.os} — tarball ${relatorio.tarball.sha256.slice(0, 22)}…\n`]
  for (const r of relatorio.resultados) {
    linhas.push(linhaDe(r))
    for (const f of r.falhas ?? []) linhas.push(`        ${f}`)
  }
  linhas.push("", textoDaLeitura("strict", relatorio.leituras.strict))
  linhas.push(textoDaLeitura("declared_degradation", relatorio.leituras.declared_degradation), "")
  process.stdout.write(`${linhas.join("\n")}\n`)
}

function montarRelatorio(nodes, tarball, opcoes = {}) {
  const resultados = nodes.map((n) => medirVersao(n, tarball, opcoes))
  const relatorio = {
    schemaVersion: "gstack.runtime-matrix.v1",
    os: `${process.platform}/${process.arch}`,
    os_coverage: process.platform === "win32" ? "windows_local" : `${process.platform}_local`,
    tarball: { path: path.basename(tarball), sha256: sha256(tarball) },
    install: { offline: Boolean(opcoes.cacheSeed), cacheSeed: opcoes.cacheSeed ?? null },
    generatedAt: new Date().toISOString(),
    resultados,
    // O conjunto PEDIDO viaja no relatorio: sem ele, ninguem consegue saber
    // depois se a rodada cobriu tudo o que devia.
    completude: avaliarCompletude(resultados, resultados.map((r) => r.node)),
  }
  relatorio.leituras = leituras(resultados)
  return relatorio
}

/** Codigos de saida, com significados distintos e nao intercambiaveis. */
export const EXIT = Object.freeze({
  MEDICAO_VALIDA: 0,
  INCOMPATIVEL: 1,
  SEM_MEDICAO: 2,
})

/**
 * Traduz o relatorio em codigo de saida — funcao PURA, para ser testada sem
 * rodar a matriz inteira.
 *
 * A versao anterior so reprovava `runtime_incompatible`, e por isso uma rodada
 * INTEIRA em `test_environment_invalid` terminava com exit 0: as leituras diziam
 * "inconclusiva" e o CI passava verde sem ter medido o produto uma vez sequer.
 * Ausencia de medicao nao pode ser indistinguivel de sucesso.
 *
 *   0  mediu e o produto passou
 *   1  mediu e o produto falhou            -> defeito do PRODUTO
 *   2  nao mediu (ambiente invalido/indisponivel, ou rodada vazia) -> defeito do ARRANJO
 */
/**
 * COMPLETUDE, nao "pelo menos uma". A versao anterior devolvia 0 quando UMA
 * linha media e as outras caiam em ambiente — para uma matriz de quatro versoes,
 * isso e evidencia PARCIAL vendida como completa.
 */
const rodadaIncompleta = (relatorio) => {
  const resultados = relatorio.resultados ?? []
  return resultados.length === 0
    || resultados.some((r) => VEREDITOS_DE_AMBIENTE.has(r.verdict))
    || relatorio.completude?.ok === false
}

export function exitCodeDe(relatorio) {
  const resultados = relatorio.resultados ?? []
  if (resultados.some((r) => r.verdict === "runtime_incompatible")) return EXIT.INCOMPATIVEL
  return rodadaIncompleta(relatorio) ? EXIT.SEM_MEDICAO : EXIT.MEDICAO_VALIDA
}

/**
 * A rodada cobriu TODAS as versoes pedidas?
 *
 * `versoesEsperadas` vem da linha de comando (os binarios apontados). Sem essa
 * comparacao, uma matriz que silenciosamente mediu tres de quatro pareceria
 * completa — e o relatorio nao teria como saber o que faltou.
 */
export function avaliarCompletude(resultados, versoesEsperadas) {
  if (!versoesEsperadas || versoesEsperadas.length === 0) return null
  const medidas = new Set(resultados.filter((r) => !VEREDITOS_DE_AMBIENTE.has(r.verdict)).map((r) => r.node))
  const faltando = versoesEsperadas.filter((v) => !medidas.has(v))
  return {
    ok: faltando.length === 0,
    esperadas: [...versoesEsperadas],
    medidas: [...medidas],
    faltando,
    motivo: faltando.length === 0 ? null : `versoes solicitadas sem medicao valida: ${faltando.join(", ")}`,
  }
}

/**
 * Junta relatorios de execucoes SEPARADAS e recalcula as leituras sobre o
 * conjunto.
 *
 * No CI cada job roda UM Node, entao `strict` nunca enxergaria, na mesma
 * execucao, `jsonl_fallback` em 18/20 e `sqlite` em 22/24 — a divergencia de
 * backend so existe quando as quatro linhas sao vistas juntas. Sem agregacao, a
 * leitura `strict` de cada job passaria por vacuidade.
 *
 * Exige o MESMO tarball em todos: agregar medicoes de artefatos diferentes
 * compararia coisas distintas.
 */
/** Linhas MAIORES do Node que a matriz exige por SO. */
export const VERSOES_EXIGIDAS = Object.freeze(["18", "20", "22", "24"])

const linhaMaiorDe = (v) => String(v ?? "").replace(/^v/, "").split(".")[0]

const erroAgg = (erro) => ({ schemaVersion: "gstack.runtime-matrix-agg.v1", erro, resultados: [] })

/**
 * Toda condicao que torna o conjunto NAO agregavel.
 *
 * Sem elas, um job ausente ou duplicado viraria evidencia "agregada" verde: a
 * reproducao com UM unico relatorio devolvia `erro:null` e exit 0, anunciando
 * cobertura de quatro versoes a partir de uma.
 */
function problemaDoConjunto(relatorios) {
  const tarballs = new Set(relatorios.map((r) => r.tarball?.sha256))
  if (tarballs.size > 1) return `relatorios de tarballs diferentes: ${[...tarballs].join(", ")}`

  const sos = new Set(relatorios.map((r) => r.os))
  if (sos.size > 1) return `relatorios de SOs diferentes: ${[...sos].join(", ")} — agregacao e POR SO`

  const linhas = relatorios.flatMap((r) => r.resultados ?? []).map((r) => linhaMaiorDe(r.node))
  const duplicadas = linhas.filter((v, i) => linhas.indexOf(v) !== i)
  if (duplicadas.length > 0) return `versao duplicada no conjunto: ${[...new Set(duplicadas)].join(", ")}`

  const faltando = VERSOES_EXIGIDAS.filter((v) => !linhas.includes(v))
  if (faltando.length > 0) {
    return `conjunto incompleto: faltam Node ${faltando.join(", ")} (exigidas ${VERSOES_EXIGIDAS.join("/")})`
  }
  return null
}

export function agregar(relatorios) {
  if (relatorios.length === 0) return erroAgg("nenhum relatorio para agregar")

  const problema = problemaDoConjunto(relatorios)
  if (problema) return erroAgg(problema)

  const resultados = relatorios.flatMap((r) => r.resultados ?? [])
  return {
    schemaVersion: "gstack.runtime-matrix-agg.v1",
    tarball: relatorios[0].tarball,
    os: relatorios[0].os,
    resultados,
    completude: avaliarCompletude(resultados, resultados.map((r) => r.node)),
    leituras: leituras(resultados),
  }
}

function imprimirAgregado(agg) {
  const linhas = [`\nagregado — ${agg.resultados.length} medicao(oes) — ${agg.erro ?? agg.tarball?.sha256?.slice(0, 22) ?? ""}\n`]
  for (const r of agg.resultados) linhas.push(linhaDe(r))
  if (agg.leituras) {
    linhas.push("", textoDaLeitura("strict", agg.leituras.strict))
    linhas.push(textoDaLeitura("declared_degradation", agg.leituras.declared_degradation), "")
  }
  process.stdout.write(`${linhas.join("\n")}\n`)
}

function modoAgregacao(arquivos, json) {
  const agg = agregar(arquivos.map((f) => JSON.parse(readFileSync(f, "utf-8"))))
  if (json) process.stdout.write(`${JSON.stringify(agg, null, 2)}\n`)
  else imprimirAgregado(agg)
  process.exit(agg.erro ? EXIT.SEM_MEDICAO : exitCodeDe(agg))
}

function main() {
  const { nodes, tarball: tarballArg, json, agregarDe, cacheSeed } = parseArgs(process.argv.slice(2))
  if (agregarDe.length > 0) return modoAgregacao(agregarDe, json)
  if (nodes.length === 0) {
    process.stderr.write("uso: node scripts/test-runtime-matrix.mjs --node <path> [--node <path>...] [--tarball <tgz>] [--json]\n")
    process.stderr.write("     node scripts/test-runtime-matrix.mjs --aggregate <a.json> --aggregate <b.json> [--json]\n")
    process.exit(EXIT.SEM_MEDICAO)
  }

  // `--tarball` fornecido: NUNCA reempacota. Em CI, os 12 jobs consomem o mesmo
  // artefato do job `pack`, senao o Node deixa de ser a unica variavel.
  const relatorio = montarRelatorio(nodes, tarballArg ?? empacotar(), { cacheSeed })

  if (json) process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`)
  else imprimirTexto(relatorio)

  process.exit(exitCodeDe(relatorio))
}

if (executadoDiretamente) main()

export { parseArgs, ambienteIsolado, verificarAmbienteNode, leituras, medirVersao, VEREDITOS_DE_AMBIENTE }
