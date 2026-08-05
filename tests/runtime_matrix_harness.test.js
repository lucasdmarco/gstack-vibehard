import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Trilha B2 — contrato do HARNESS da matriz de runtime.
 *
 * Estes testes protegem o instrumento, não o produto. Motivo: o diagnóstico do
 * WIP mostrou o `doctor` reportando a versão do HOST nas quatro linhas da matriz,
 * porque `src/installer/doctor.js:68` faz `execFileSync("node", ["--version"])` —
 * lê o PATH, não `process.version`. Isso é legítimo no produto, que diagnostica o
 * ambiente do usuário, e NÃO se limita ao doctor: qualquer subprocesso que
 * invoque `node`, `npm` ou `npx` herda a mesma resolução.
 *
 * Sem os guards abaixo, a matriz mediria o Node errado e concluiria
 * `runtime_incompatible` — atribuindo ao GStack um defeito do arranjo de teste,
 * e confirmando a suspeita inicial pelo motivo errado, que é o pior desfecho.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const runner = path.join(repoRoot, "scripts", "test-runtime-matrix.mjs")
const fonte = () => readFileSync(runner, "utf8")
const imp = () => import(`file:///${runner.replace(/\\/g, "/")}?t=${Date.now()}`)

// ── Isolamento do ambiente ───────────────────────────────────────────────────

test("a sandbox redireciona TODAS as variáveis de escrita", () => {
  const src = fonte()
  const OBRIGATORIAS = [
    "HOME", "USERPROFILE",
    "TEMP", "TMP", "TMPDIR",
    "APPDATA", "LOCALAPPDATA",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
    "GIT_CONFIG_GLOBAL",
    "NPM_CONFIG_CACHE", "NPM_CONFIG_PREFIX", "NPM_CONFIG_USERCONFIG",
  ]
  for (const v of OBRIGATORIAS) {
    assert.match(src, new RegExp(`\\b${v}\\s*:`), `\`${v}\` precisa ser redirecionado — basta uma esquecida para o subprocesso escrever no HOME real`)
  }
})

test("o PATH da sandbox começa pelo diretório do Node ALVO", () => {
  const src = fonte()
  assert.match(src, /PATH:\s*`\$\{path\.dirname\(nodeBin\)\}\$\{path\.delimiter\}/,
    "sem isto, `node`/`npm`/`npx` invocados por subprocesso alcançam o Node do host")
  // Windows resolve variáveis de ambiente sem diferenciar caixa, mas o objeto
  // passado ao spawn, não — daí as duas grafias.
  assert.match(src, /\bPath:\s*`\$\{path\.dirname\(nodeBin\)\}/, "grafia `Path` também, para Windows")
})

test("o CLI é iniciado pelo node.exe ABSOLUTO do alvo, nunca por `node` do PATH", () => {
  const src = fonte()
  assert.match(src, /const chamar = \(args, cwd = prep\.proj\) => rodar\(nodeBin, \[prep\.entry/,
    "o binário alvo é o executor; o PATH é reforço, não o mecanismo")
  assert.ok(!/rodar\("node",/.test(src), "nenhuma chamada resolve `node` pelo PATH")
})

// ── Verificação tripla da identidade do Node ─────────────────────────────────

test("o harness exige as TRÊS provas de identidade antes de medir o produto", () => {
  const src = fonte()
  assert.match(src, /-p", "process\.version/, "1) process.version do binário alvo")
  assert.match(src, /isWin \? "where\.exe" : "which"/, "2) where/which resolve para o alvo")
  assert.match(src, /versions\?\.node !== versaoEsperada/, "3) doctor.versions.node bate com o alvo")

  // A verificação vem ANTES de instalar e de rodar qualquer oráculo. Comparar as
  // CHAMADAS, não as definições — a definição de `prepararProjeto` aparece antes
  // no arquivo e inverteria a ordem sem que nada estivesse errado.
  const iAmbiente = src.indexOf("const amb = verificarAmbienteNode(")
  const iPreparar = src.indexOf("const prep = prepararProjeto(")
  assert.ok(iAmbiente > 0, "a chamada de verificação precisa existir")
  assert.ok(iPreparar > 0, "a chamada de preparação precisa existir")
  assert.ok(iAmbiente < iPreparar,
    "medir o produto num ambiente não verificado produziria veredito sobre o Node errado")
})

/**
 * COMPORTAMENTAL, não textual. A primeira versão destes testes procurava strings
 * no fonte e nem chegava a chamar `verificarAmbienteNode` — a afirmação
 * "controle negativo reprovando" estava acima da prova.
 */
test("CONTROLE NEGATIVO: PATH resolvendo OUTRO Node é detectado de fato", async () => {
  const { verificarAmbienteNode } = await imp()
  const nodeAlvo = process.execPath
  const versao = process.version

  // Diretório falso ANTES do alvo no PATH: `where`/`which` resolve para lá.
  const falso = mkdtempSync(path.join(tmpdir(), "gstack-pathfalso-"))
  try {
    const nomeExe = process.platform === "win32" ? "node.exe" : "node"
    writeFileSync(path.join(falso, nomeExe), "#!/bin/sh\necho v0.0.0\n", { mode: 0o755 })

    const env = { ...process.env, PATH: `${falso}${path.delimiter}${process.env.PATH}`, Path: `${falso}${path.delimiter}${process.env.PATH}` }
    const r = verificarAmbienteNode(nodeAlvo, env, versao)

    assert.equal(r.pathApontaAlvo, false, "o PATH resolve para o diretório falso")
    assert.equal(r.problemas.length, 1, "o problema precisa ser reportado")
    assert.match(r.problemas[0], /PATH resolve `node` para/, "a razão nomeia o que foi resolvido")
    assert.ok(r.problemas[0].includes(falso), "e mostra o caminho errado encontrado")
  } finally { cleanupTmp(falso) }
})

test("CONTROLE POSITIVO: PATH apontando para o alvo é aceito", async () => {
  const { verificarAmbienteNode } = await imp()
  const nodeAlvo = process.execPath
  const dir = path.dirname(nodeAlvo)
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, Path: `${dir}${path.delimiter}${process.env.PATH}` }

  const r = verificarAmbienteNode(nodeAlvo, env, process.version)
  assert.equal(r.pathApontaAlvo, true)
  assert.deepEqual(r.problemas, [], "ambiente correto não pode produzir problema")
  assert.equal(r.processVersion, process.version)
})

test("CONTROLE NEGATIVO: process.version divergente do esperado é detectado", async () => {
  const { verificarAmbienteNode } = await imp()
  const dir = path.dirname(process.execPath)
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, Path: `${dir}${path.delimiter}${process.env.PATH}` }

  const r = verificarAmbienteNode(process.execPath, env, "v99.99.99")
  assert.equal(r.problemas.length, 1)
  assert.match(r.problemas[0], /process\.version` = v\d+\.\d+\.\d+, esperado v99\.99\.99/,
    "a divergência precisa mostrar os DOIS valores")
})

// ── Leituras: comportamento, não texto ───────────────────────────────────────

const linha = (node, verdict, backend, sqlite) => ({
  node, verdict, backend_observado: backend, sqlite_available: sqlite,
  degradacao_autorizada: !sqlite && backend === "jsonl_fallback",
})

test("vereditos de AMBIENTE são excluídos das leituras — não viram evidência do produto", async () => {
  const { leituras } = await imp()
  // Duas linhas compatíveis + uma inválida por ambiente: a inválida não pode
  // reprovar nem aprovar nada sobre o produto.
  const r = leituras([
    linha("v22.21.1", "runtime_compatible", "sqlite", true),
    linha("v24.14.0", "runtime_compatible", "sqlite", true),
    { node: "v20.19.5", verdict: "test_environment_invalid", motivo: "PATH errado" },
  ])
  assert.equal(r.strict.ok, true, "a linha de ambiente não entra no cálculo")
  assert.equal(r.declared_degradation.ok, true)
})

test("rodada SEM nenhuma medição válida é INCONCLUSIVA, nunca aprovada", async () => {
  const { leituras } = await imp()
  const r = leituras([
    { node: "v18.20.8", verdict: "test_environment_invalid", motivo: "PATH errado" },
    { node: "v20.19.5", verdict: "test_environment_unsupported", motivo: "npm falhou" },
  ])
  assert.equal(r.strict.ok, false, "aprovar aqui seria verde por ausência de medição")
  assert.equal(r.declared_degradation.ok, false)
  assert.match(r.strict.motivo, /inconclusiva/)
})

test("`strict` reprova backend divergente; `declared_degradation` aceita a degradação prevista", async () => {
  const { leituras } = await imp()
  // O caso REAL da matriz: 18/20 sem sqlite, 22/24 com.
  const r = leituras([
    linha("v18.20.8", "runtime_compatible", "jsonl_fallback", false),
    linha("v20.19.5", "runtime_compatible", "jsonl_fallback", false),
    linha("v22.21.1", "runtime_compatible", "sqlite", true),
    linha("v24.14.0", "runtime_compatible", "sqlite", true),
  ])
  assert.equal(r.strict.ok, false, "backend difere entre versões")
  assert.match(r.strict.motivo, /backend difere entre versoes/)
  assert.equal(r.declared_degradation.ok, true,
    "a degradação é autorizada pela capacidade ausente — é o design do PRD14")
})

test("degradação SEM capacidade ausente que a autorize reprova as duas leituras", async () => {
  const { leituras } = await imp()
  // `jsonl_fallback` com `sqlite` DISPONÍVEL: o produto degradou sem motivo.
  const r = leituras([linha("v24.14.0", "runtime_compatible", "jsonl_fallback", true)])
  assert.equal(r.declared_degradation.ok, false)
  assert.match(r.declared_degradation.motivo, /sem capacidade ausente que a autorize/)
})

test("toda leitura reprovada carrega razão — nunca `ok:false` com `motivo:null`", async () => {
  const { leituras } = await imp()
  const casos = [
    [linha("v18.20.8", "runtime_incompatible", "sqlite", true)],
    [linha("v18.20.8", "runtime_compatible", "jsonl_fallback", true)],
    [{ node: "v18.20.8", verdict: "test_environment_invalid" }],
  ]
  for (const c of casos) {
    const r = leituras(c)
    for (const [nome, l] of Object.entries(r)) {
      if (!l.ok) assert.ok(l.motivo && l.motivo.length > 5, `${nome} reprovou sem razão utilizável`)
    }
  }
})

// ── Exit code: ausência de medição ≠ sucesso ─────────────────────────────────

test("exit 2 quando NÃO houve medição — o CI não pode passar verde sem medir", async () => {
  const { exitCodeDe, EXIT } = await imp()

  assert.equal(exitCodeDe({ resultados: [] }), EXIT.SEM_MEDICAO, "rodada vazia")
  assert.equal(exitCodeDe({
    resultados: [
      { verdict: "test_environment_invalid" },
      { verdict: "test_environment_unsupported" },
    ],
  }), EXIT.SEM_MEDICAO, "só ambiente: nada foi medido sobre o produto")
})

test("exit 1 para incompatibilidade do PRODUTO, mesmo com linhas de ambiente junto", async () => {
  const { exitCodeDe, EXIT } = await imp()
  assert.equal(exitCodeDe({
    resultados: [
      { verdict: "test_environment_invalid" },
      { verdict: "runtime_incompatible" },
      { verdict: "runtime_compatible" },
    ],
  }), EXIT.INCOMPATIVEL)
})

/**
 * A versão anterior deste teste afirmava que "uma linha medida basta" — e era
 * justamente a regra frouxa que deixava evidência parcial passar como completa.
 * Agora exit 0 exige que TODAS as linhas tenham sido medidas.
 */
test("exit 0 SÓ quando TODAS as linhas foram medidas e o produto passou", async () => {
  const { exitCodeDe, EXIT } = await imp()
  assert.equal(exitCodeDe({ resultados: [{ verdict: "runtime_compatible" }] }), EXIT.MEDICAO_VALIDA)
  assert.equal(exitCodeDe({
    resultados: [{ verdict: "runtime_compatible" }, { verdict: "runtime_compatible" }],
  }), EXIT.MEDICAO_VALIDA)

  assert.equal(exitCodeDe({
    resultados: [{ verdict: "runtime_compatible" }, { verdict: "test_environment_unsupported" }],
  }), EXIT.SEM_MEDICAO, "uma linha sem medição já torna a rodada incompleta")
})

test("os três códigos são DISTINTOS — significados não intercambiáveis", async () => {
  const { EXIT } = await imp()
  const vals = Object.values(EXIT)
  assert.equal(new Set(vals).size, vals.length)
  assert.deepEqual(EXIT, { MEDICAO_VALIDA: 0, INCOMPATIVEL: 1, SEM_MEDICAO: 2 })
})

// ── Agregação entre jobs ─────────────────────────────────────────────────────

test("AGREGAÇÃO: a divergência de backend só aparece com os quatro Nodes juntos", async () => {
  const { agregar, leituras } = await imp()
  const tarball = { path: "x.tgz", sha256: "sha256:abc" }
  // Como no CI: cada job roda UM Node e produz seu relatório.
  const porJob = [
    { tarball, os: "linux/x64", resultados: [linha("v18.20.8", "runtime_compatible", "jsonl_fallback", false)] },
    { tarball, os: "linux/x64", resultados: [linha("v20.19.5", "runtime_compatible", "jsonl_fallback", false)] },
    { tarball, os: "linux/x64", resultados: [linha("v22.21.1", "runtime_compatible", "sqlite", true)] },
    { tarball, os: "linux/x64", resultados: [linha("v24.14.0", "runtime_compatible", "sqlite", true)] },
  ]

  // Isoladamente, cada job vê UM backend e `strict` passa por vacuidade.
  for (const j of porJob) assert.equal(leituras(j.resultados).strict.ok, true)

  const agg = agregar(porJob)
  assert.equal(agg.resultados.length, 4)
  assert.equal(agg.leituras.strict.ok, false, "junto, a divergência aparece")
  assert.match(agg.leituras.strict.motivo, /backend difere entre versoes/)
  assert.equal(agg.leituras.declared_degradation.ok, true)
})

test("AGREGAÇÃO recusa relatórios de TARBALLS diferentes", async () => {
  const { agregar } = await imp()
  const agg = agregar([
    { tarball: { sha256: "sha256:aaa" }, os: "linux/x64", resultados: [] },
    { tarball: { sha256: "sha256:bbb" }, os: "linux/x64", resultados: [] },
  ])
  assert.match(agg.erro, /tarballs diferentes/, "agregar artefatos distintos compararia coisas diferentes")
  assert.deepEqual(agg.resultados, [])
})

/**
 * Um único relatório produzia `erro:null`, uma medição e exit 0 — anunciando
 * cobertura de quatro versões a partir de uma. Job ausente virava evidência
 * "agregada" verde.
 */
test("NEGATIVO: AGREGAÇÃO com conjunto INCOMPLETO é recusada", async () => {
  const { agregar, exitCodeDe, EXIT } = await imp()
  const tarball = { sha256: "sha256:abc" }
  const um = { tarball, os: "linux/x64", resultados: [linha("v24.14.0", "runtime_compatible", "sqlite", true)] }

  const agg = agregar([um])
  assert.match(agg.erro, /conjunto incompleto: faltam Node 18, 20, 22/)
  assert.deepEqual(agg.resultados, [], "nada é agregado a partir de conjunto incompleto")
  assert.equal(exitCodeDe(agg), EXIT.SEM_MEDICAO)
})

test("NEGATIVO: AGREGAÇÃO com versão DUPLICADA é recusada", async () => {
  const { agregar } = await imp()
  const tarball = { sha256: "sha256:abc" }
  const rel = (v, b, s) => ({ tarball, os: "linux/x64", resultados: [linha(v, "runtime_compatible", b, s)] })
  const agg = agregar([
    rel("v18.20.8", "jsonl_fallback", false),
    rel("v18.20.8", "jsonl_fallback", false),
    rel("v22.21.1", "sqlite", true),
    rel("v24.14.0", "sqlite", true),
  ])
  assert.match(agg.erro, /versao duplicada no conjunto: 18/, "duplicata mascararia a versão faltante")
})

test("NEGATIVO: AGREGAÇÃO com SOs DIFERENTES é recusada — a agregação é POR SO", async () => {
  const { agregar } = await imp()
  const tarball = { sha256: "sha256:abc" }
  const rel = (v, b, s, os) => ({ tarball, os, resultados: [linha(v, "runtime_compatible", b, s)] })
  const agg = agregar([
    rel("v18.20.8", "jsonl_fallback", false, "linux/x64"),
    rel("v20.19.5", "jsonl_fallback", false, "win32/x64"),
    rel("v22.21.1", "sqlite", true, "linux/x64"),
    rel("v24.14.0", "sqlite", true, "linux/x64"),
  ])
  assert.match(agg.erro, /SOs diferentes/)
})

test("POSITIVO: conjunto COMPLETO das quatro versões, mesmo SO e tarball, agrega", async () => {
  const { agregar, exitCodeDe, EXIT } = await imp()
  const tarball = { sha256: "sha256:abc" }
  const rel = (v, b, s) => ({ tarball, os: "linux/x64", resultados: [linha(v, "runtime_compatible", b, s)] })
  const agg = agregar([
    rel("v18.20.8", "jsonl_fallback", false),
    rel("v20.19.5", "jsonl_fallback", false),
    rel("v22.21.1", "sqlite", true),
    rel("v24.14.0", "sqlite", true),
  ])
  assert.equal(agg.erro, undefined, "o caminho legítimo continua funcionando")
  assert.equal(agg.resultados.length, 4)
  assert.equal(agg.completude.ok, true)
  assert.equal(exitCodeDe(agg), EXIT.MEDICAO_VALIDA)
})

// ── Completude: medição parcial não é sucesso ────────────────────────────────

/**
 * Reprodução do achado: `runtime_compatible` no 24 junto de
 * `test_environment_unsupported` no 18 devolvia exit 0. Para uma matriz de
 * quatro versões, uma linha útil é evidência PARCIAL vendida como completa.
 */
test("P0: QUALQUER versão sem medição torna a rodada incompleta (exit 2)", async () => {
  const { exitCodeDe, EXIT } = await imp()
  assert.equal(exitCodeDe({
    resultados: [
      { node: "v24.14.0", verdict: "runtime_compatible" },
      { node: "v18.20.8", verdict: "test_environment_unsupported" },
    ],
  }), EXIT.SEM_MEDICAO, "3 de 4 medidas não é sucesso")

  assert.equal(exitCodeDe({
    resultados: [
      { node: "v24.14.0", verdict: "runtime_compatible" },
      { node: "v18.20.8", verdict: "test_environment_invalid" },
    ],
  }), EXIT.SEM_MEDICAO)
})

test("`avaliarCompletude` nomeia exatamente quais versões ficaram sem medição", async () => {
  const { avaliarCompletude } = await imp()
  const r = avaliarCompletude([
    { node: "v18.20.8", verdict: "test_environment_invalid" },
    { node: "v20.19.5", verdict: "runtime_compatible" },
    { node: "v22.21.1", verdict: "runtime_compatible" },
    { node: "v24.14.0", verdict: "test_environment_unsupported" },
  ], ["v18.20.8", "v20.19.5", "v22.21.1", "v24.14.0"])

  assert.equal(r.ok, false)
  assert.deepEqual(r.faltando, ["v18.20.8", "v24.14.0"])
  assert.deepEqual(r.medidas, ["v20.19.5", "v22.21.1"])
  assert.match(r.motivo, /sem medicao valida: v18\.20\.8, v24\.14\.0/)
})

test("completude reprovada derruba o exit code mesmo sem linha de ambiente", async () => {
  const { exitCodeDe, EXIT } = await imp()
  assert.equal(exitCodeDe({
    resultados: [{ node: "v24.14.0", verdict: "runtime_compatible" }],
    completude: { ok: false, faltando: ["v18.20.8"], motivo: "faltou 18" },
  }), EXIT.SEM_MEDICAO)
})

// ── Cache seed: instalação offline de verdade ────────────────────────────────

test("NEGATIVO: sem `--cache-seed` a sandbox usa cache PRÓPRIO e vazio", async () => {
  const { ambienteIsolado } = await imp()
  const sandbox = mkdtempSync(path.join(tmpdir(), "gstack-semseed-"))
  try {
    const env = ambienteIsolado(sandbox, process.execPath)
    assert.ok(env.NPM_CONFIG_CACHE.startsWith(sandbox), "o cache vive DENTRO da sandbox")
    assert.equal(readdirSync(env.NPM_CONFIG_CACHE).length, 0, "e nasce vazio")
  } finally { cleanupTmp(sandbox) }
})

/**
 * O workflow definia `NPM_CONFIG_CACHE` apontando ao cache comum, e
 * `ambienteIsolado` o SOBRESCREVIA com um vazio: o cache verificado nunca
 * chegava ao `npm install`, e cada linha resolvia pela rede.
 */
test("POSITIVO: `--cache-seed` COPIA o cache verificado para dentro da sandbox", async () => {
  const { ambienteIsolado } = await imp()
  const seed = mkdtempSync(path.join(tmpdir(), "gstack-seed-"))
  const sandbox = mkdtempSync(path.join(tmpdir(), "gstack-comseed-"))
  try {
    mkdirSync(path.join(seed, "_cacache"), { recursive: true })
    writeFileSync(path.join(seed, "_cacache", "marcador.txt"), "entrada verificada")

    const env = ambienteIsolado(sandbox, process.execPath, seed)
    assert.ok(env.NPM_CONFIG_CACHE.startsWith(sandbox), "o isolamento é preservado — é CÓPIA, não referência")
    assert.ok(existsSync(path.join(env.NPM_CONFIG_CACHE, "_cacache", "marcador.txt")),
      "o conteúdo do seed chegou ao cache que o npm vai usar")
  } finally { cleanupTmp(seed); cleanupTmp(sandbox) }
})

test("`--cache-seed` liga a instalação OFFLINE, registrada no relatório", async () => {
  const src = codigoDoRunner()
  assert.match(src, /const rede = offline \? \["--offline"\] : \[\]/,
    "`--prefer-offline` ainda permite rede; `--offline` proíbe")
  assert.match(src, /install: \{ offline: Boolean\(opcoes\.cacheSeed\), cacheSeed/,
    "o relatório declara se a instalação foi offline")
})

test("`--cache-seed` é reconhecido pelo parser", async () => {
  const { parseArgs } = await imp()
  const a = parseArgs(["--node", "n", "--cache-seed", "/tmp/c", "--tarball", "t.tgz"])
  assert.equal(a.cacheSeed, "/tmp/c")
  assert.deepEqual(a.nodes, ["n"])
})

/**
 * GUARD DE PROPAGAÇÃO. O `cacheSeed` atravessa quatro funções até chegar ao
 * `npm install`, e uma delas ficou sem o parâmetro — `medirNaSandbox` não o
 * declarava e o runner morria com `ReferenceError: opcoes is not defined`.
 * Testes de unidade das pontas não pegam isso: o parser aceitava a flag e
 * `ambienteIsolado` sabia usá-la, mas o meio da cadeia estava roto.
 */
test("a cadeia inteira propaga `cacheSeed` — nenhum elo perde o parâmetro", () => {
  const src = codigoDoRunner()
  const elos = [
    [/function ambienteIsolado\(sandbox, nodeBin, cacheSeed = null\)/, "ambienteIsolado recebe"],
    [/function prepararProjeto\(nodeBin, sandbox, tarball, env, offline\)/, "prepararProjeto recebe `offline`"],
    [/function medirNaSandbox\([^)]*opcoes = \{\}\)/, "medirNaSandbox recebe `opcoes`"],
    [/function medirVersao\(nodeBin, tarball, opcoes = \{\}\)/, "medirVersao recebe `opcoes`"],
    [/function montarRelatorio\(nodes, tarball, opcoes = \{\}\)/, "montarRelatorio recebe `opcoes`"],
    [/ambienteIsolado\(sandbox, nodeBin, opcoes\.cacheSeed\)/, "medirNaSandbox REPASSA ao ambiente"],
    [/medirNaSandbox\([^)]*impressaoGlobal\(\), opcoes\)/, "medirVersao REPASSA"],
    [/medirVersao\(n, tarball, opcoes\)/, "montarRelatorio REPASSA"],
    [/montarRelatorio\(nodes, tarballArg \?\? empacotar\(\), \{ cacheSeed \}\)/, "main REPASSA"],
  ]
  for (const [re, oque] of elos) assert.match(src, re, `elo quebrado: ${oque}`)
})

test("o runner carrega e executa com `--cache-seed` sem ReferenceError", async () => {
  const { medirVersao } = await imp()
  // Binário inexistente: para antes de instalar, mas ATRAVESSA a assinatura com
  // `opcoes` — que era exatamente onde o elo estava roto.
  const r = medirVersao(path.join(tmpdir(), "node-que-nao-existe"), "x.tgz", { cacheSeed: "/tmp/seed" })
  assert.equal(r.verdict, "test_environment_unsupported")
  assert.match(r.motivo, /binario Node nao executa/)
})

test("AGREGAÇÃO sem relatórios devolve erro, não aprovação", async () => {
  const { agregar, exitCodeDe, EXIT } = await imp()
  const agg = agregar([])
  assert.match(agg.erro, /nenhum relatorio/)
  assert.equal(exitCodeDe(agg), EXIT.SEM_MEDICAO)
})

// ── Oráculos semânticos, não exit code ───────────────────────────────────────

test("nenhum oráculo aprova por exit code", () => {
  const src = fonte()
  assert.ok(!/\.status === 0\s*\)\s*return ok\(/.test(src),
    "`context stats` não existe e sai 0 imprimindo help — exit code não é oráculo")
  // Cada oráculo verifica conteúdo ou efeito persistido.
  assert.match(src, /versions\?\.node !== versaoEsperada/)
  assert.match(src, /j\?\.mode !== "lite"/)
  assert.match(src, /search nao encontrou o documento plantado/)
  assert.match(src, /schemaVersion !== "gstack\.proof\.v1"/)
})

/** Linhas de CÓDIGO do runner — comentários explicam antipadrões e não devem casar. */
const codigoDoRunner = () => fonte().split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n")

test("`dream audit` usa INVARIANTES, não snapshot de contagem", () => {
  const src = codigoDoRunner()
  assert.match(src, /s\.PLACEBO !== 0/, "invariante estável")
  assert.match(src, /s\.REAL <= 0/, "invariante estável")
  // Filtra comentários: o próprio runner EXPLICA por que não fixa `REAL === 24`,
  // e a explicação fazia este teste reprovar o texto que o documenta.
  assert.ok(!/REAL\s*[!=]==\s*24/.test(src),
    "fixar REAL===24 quebraria ao adicionar capacidade legítima")
})

test("o backend é OBSERVADO e cruzado com a capacidade, nunca inferido da versão", () => {
  const src = codigoDoRunner()
  assert.match(src, /getBuiltinModule\('node:sqlite'\)/, "detecta a capacidade no binário")
  assert.match(src, /!sqlite && backend === "jsonl_fallback"/,
    "a degradação é autorizada pela capacidade ausente, não por `versão < 22.5`")
  // Filtra comentários: o runner EXPLICA que `node:sqlite` entra no 22.5, e a
  // explicação fazia este teste reprovar o texto que documenta a decisão.
  assert.ok(!/22\.5|versao\s*[<>]=?\s*22/.test(src),
    "nenhuma decisão de código pode derivar do NÚMERO da versão")
})

// ── Tarball único ────────────────────────────────────────────────────────────

test("`--tarball` nunca reempacota — o Node precisa ser a única variável", () => {
  const src = fonte()
  assert.match(src, /tarballArg \?\? empacotar\(\)/,
    "com `--tarball` o script usa o artefato dado; sem ele, empacota uma vez só")
  assert.match(src, /sha256\(tarball\)/, "o relatório carrega o hash do artefato medido")
})
