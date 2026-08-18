import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"
import { evaluateJsonRun } from "./helpers/json-purity.js"

/**
 * CONSUMIDOR REAL de `context … --json`.
 *
 * Evidencia da declaracao de consumidor de `src/commands/context.js` na ancora
 * fina (arquivo + comando + modo). Roda o COMANDO PUBLICO por subprocesso —
 * `node src/index.js context …` —, nunca o handler direto: chamar a funcao
 * interna provaria que ela existe, nao que a superficie publica cumpre contrato.
 *
 * UM PONTO DE EMISSAO, QUATRO SUBCOMANDOS. Todo `--json` deste arquivo sai por
 * `context.js:50`:
 *
 *   const ctxJson = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")
 *
 * Nenhuma guarda envolve aquela escrita — quem esta sob `if (json)` sao os cinco
 * chamadores dela, um deles indiretamente (`explainJson`). E por isso que o
 * ponto so ganha modo `--json` pela guarda HERDADA; sem ela nenhuma declaracao
 * podia cobri-lo sem mentir sobre qual ramo prova.
 *
 * LACUNA DECLARADA, nao escondida: os dois chamadores que dependem de um indice
 * REAL (`decisionContext` e `explainJson`) nao sao exercitados aqui. Eles
 * escrevem pelo MESMO ponto, entao o contrato do canal esta provado; o que nao
 * esta e o schema especifico daqueles dois payloads. Quem cobre o motor de busca
 * por tras deles e tests/test_context_db.py.
 *
 * ACHADO DE PRODUTO CORRIGIDO (`P1.CLI-JSON-EXIT-CODE.a`, fix autorizado em
 * 2026-08-17). O posicional era lido como `args[1]` cru, entao
 * `context search --json` tratava a PROPRIA FLAG como termo de busca, e os ramos
 * de recusa (`missing query`, `missing entity`, `missing topic`, "pergunta
 * obrigatoria") eram inalcancaveis por omissao -- so um argumento vazio
 * EXPLICITO chegava neles, e nenhum consumidor real escreve isso.
 *
 * Os testes que exercitam a recusa com `""` explicito FICAM: continuam sendo
 * contrato valido, e provam que a correcao nao quebrou o caminho antigo.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

const rodar = (cwd, args) => evaluateJsonRun(spawnSync("node", [bin, "context", ...args], {
  cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000,
}))

/** Execucao invalida REPROVA: sem isso, harness quebrada vira "verde". */
function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `${nome}: spawn falhou — o comando nem rodou`)
  assert.equal(r.timedOut, false, `${nome}: timeout — o resultado nao representa o contrato`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execucao invalida`)
}

/** Um documento JSON puro em stdout, e nenhum payload vazando pelo stderr. */
function payloadDe(cwd, args, nome) {
  const r = rodar(cwd, args)
  assertRodou(r, nome)
  assert.equal(r.pure, true, `${nome}: stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, `${nome}: payload de maquina nao pode sair pelo stderr`)
  // `doc` e o documento ja parseado pelo proprio avaliador de pureza — usar o
  // stdout cru aqui reparsearia o que ele acabou de validar, e por duas vezes.
  return r.doc
}

const sandbox = (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-ctxjson-"))
  t.after(() => cleanupTmp(cwd))
  return cwd
}

// ── Os quatro subcomandos, todos pelo mesmo ponto ──────────────────────────

test("`context search \"\" --json`: recusa `missing query` serializada, por `ctxFail`", (t) => {
  const p = payloadDe(sandbox(t), ["search", "", "--json"], "search sem termo")
  assert.equal(p.error, "missing query")
})

test("`context search \"x\" --json` sem indice: recusa serializada, nao prosa", (t) => {
  const p = payloadDe(sandbox(t), ["search", "x", "--json"], "search sem indice")
  assert.equal(p.error, "no_index", "a ausencia de indice e contrato, e o consumidor precisa distinguir")
})

test("`context related \"\" --json`: documento JSON com `missing entity`", (t) => {
  const p = payloadDe(sandbox(t), ["related", "", "--json"], "related sem entidade")
  assert.equal(p.error, "missing entity")
})

test("`context explain \"\" --json`: documento JSON com `missing topic`", (t) => {
  const p = payloadDe(sandbox(t), ["explain", "", "--json"], "explain sem topico")
  assert.equal(p.error, "missing topic")
})

test("`context scout \"\" --json`: `{ ok:false, error }` por `scoutError`", (t) => {
  const p = payloadDe(sandbox(t), ["scout", "", "--json"], "scout sem pergunta")
  assert.equal(p.ok, false)
  assert.ok(p.error.length > 0)
})

/**
 * O SEGUNDO ramo de `scoutError`, e ele guarda uma decisao de produto: backend
 * remoto e opt-in explicito, nunca default. A recusa precisa chegar ao
 * consumidor de maquina como recusa, e nao como resultado vazio.
 */
test("`context scout … --backend fastcontext --json`: recusa o backend remoto", (t) => {
  const p = payloadDe(sandbox(t), ["scout", "q", "--backend", "fastcontext", "--json"], "scout fastcontext")
  assert.equal(p.ok, false)
  assert.match(p.error, /opt-in/i)
})

/**
 * O ACHADO CORRIGIDO (`P1.CLI-JSON-EXIT-CODE.a`, fix autorizado em 2026-08-17).
 *
 * Este teste FIXAVA o defeito: `--json` virava o proprio termo de busca, porque
 * os handlers liam `args[1]` cru. Pior que o resultado errado, os ramos de
 * recusa por omissao eram INALCANCAVEIS -- so um argumento vazio EXPLICITO
 * chegava neles, e nenhum consumidor real escreve isso.
 *
 * Agora `posicional()` pula flags, e a flag deixa de ser confundida com dado.
 */
test("sem posicional, a flag NAO vira argumento: a recusa por omissao e alcancada", (t) => {
  const p = payloadDe(sandbox(t), ["scout", "--json"], "scout sem pergunta e sem posicional")
  assert.equal(p.ok, false, "sem pergunta, a resposta e recusa")
  assert.match(p.error, /pergunta obrigat/i)
  assert.notEqual(p.question, "--json", "a flag nunca pode ser lida como a pergunta")
})

/** Os quatro subcomandos, sem posicional algum: todos recusam. */
for (const [sub, campo, esperado] of [
  ["search", "error", "missing query"],
  ["related", "error", "missing entity"],
  ["explain", "error", "missing topic"],
]) {
  test(`\`context ${sub} --json\` (sem posicional) recusa com \`${esperado}\``, (t) => {
    const p = payloadDe(sandbox(t), [sub, "--json"], `${sub} sem posicional`)
    assert.equal(p[campo], esperado)
  })
}

/**
 * A PORTA DAS FLAGS COM VALOR. Sem ela, `--source docs` faria `docs` virar o
 * termo de busca -- trocaria um bug de parsing por outro, mais dificil de ver
 * porque produziria um resultado plausivel em vez de um erro.
 */
test("flag com VALOR nao e confundida com o posicional", (t) => {
  const cwd = sandbox(t)
  const p = payloadDe(cwd, ["search", "--source", "docs", "--json"], "search so com filtro")
  assert.equal(p.error, "missing query",
    "`docs` e valor de `--source`, nunca o termo de busca")
})

test("com filtro ANTES do termo, o termo continua sendo o termo", (t) => {
  const cwd = sandbox(t)
  const r = rodar(cwd, ["search", "--source", "docs", "termo-real", "--json"])
  assertRodou(r, "search com filtro antes do termo")
  assert.notEqual(r.doc.error, "missing query", "o posicional depois do filtro precisa ser encontrado")
  assert.equal(r.doc.error, "no_index", "sem indice, a recusa e outra -- e e a certa")
})

// ── Exit code: a metade do P1 que este arquivo controla ────────────────────

/**
 * `P1.CLI-JSON-EXIT-CODE`, a raiz. O documento de erro saia com exit 0, e quem
 * checa `$?` lia falha como sucesso -- o pior modo de falhar, porque e silencioso.
 *
 * Vale nos DOIS modos: sem `--json` tambem precisa sair != 0, senao a automacao
 * que nao usa a flag continuaria enganada.
 */
for (const args of [["search", "--json"], ["related", "--json"], ["explain", "--json"], ["scout", "--json"]]) {
  test(`\`context ${args.join(" ")}\`: recusa sai com exit != 0`, (t) => {
    const r = rodar(sandbox(t), args)
    assert.notEqual(r.exitCode, 0, "erro com exit 0 engana quem decide por status do processo")
    assert.equal(r.pure, true, "e continua sendo documento JSON puro")
  })
}

test("CONTROLE POSITIVO: sucesso continua saindo com 0", (t) => {
  const r = rodar(sandbox(t), ["scout", "como funciona o gate", "--json"])
  assert.equal(r.exitCode, 0, "sem isto, o exit code nao distinguiria nada")
  assert.equal(r.pure, true)
})

test("o modo HUMANO tambem sai != 0 na recusa", (t) => {
  const r = rodar(sandbox(t), ["search"])
  assert.notEqual(r.exitCode, 0, "quem nao usa `--json` merece o mesmo contrato de status")
})

/**
 * O CAMINHO FELIZ, e o unico que emite payload de dados em vez de recusa. O
 * scout e local-first: roda sem indice, degradando a camada de docs.
 */
test("`context scout \"…\" --json`: relatorio completo, com o schema minimo", (t) => {
  const p = payloadDe(sandbox(t), ["scout", "como funciona o gate", "--json"], "scout com pergunta")
  assert.ok(Array.isArray(p.results), "consumidor precisa de `results`")
  assert.ok(Array.isArray(p.keywords))
  assert.ok(Array.isArray(p.backendsUsed))
  assert.equal(p.tokenAccounting.isEstimate, true,
    "a contabilidade e HONESTA: heuristica, e o payload diz isso")
})

// ── CONTROLE NEGATIVO: sem a flag, o canal e outro ─────────────────────────

/**
 * Sem `--json` o mesmo subcomando escreve para humano. Sem este controle, um
 * comando que emitisse JSON SEMPRE passaria nos testes acima e a declaracao de
 * consumidor cobriria um ramo que nao existe.
 */
test("CONTROLE NEGATIVO: sem `--json`, a saida NAO e documento JSON", (t) => {
  const cwd = sandbox(t)
  const r = rodar(cwd, ["scout", "como funciona o gate"])
  assertRodou(r, "scout sem --json")
  assert.equal(r.pure, false, "no ramo humano o stdout nao pode ser um documento JSON puro")
})

test("CONTROLE NEGATIVO: `search` sem `--json` recusa em prosa, nao em JSON", (t) => {
  const cwd = sandbox(t)
  const r = rodar(cwd, ["search"])
  assertRodou(r, "search sem --json")
  assert.equal(r.pure, false)
})
