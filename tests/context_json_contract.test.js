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
 * ACHADO DE PRODUTO, encontrado ao escrever esta prova e NAO corrigido aqui
 * (mudar parsing de argumento e mudanca de comportamento publico, nao
 * classificacao): o posicional e lido como `args[1]` cru, entao
 * `context search --json` trata a PROPRIA FLAG como termo de busca. Os ramos de
 * recusa (`missing query`, `missing entity`, `missing topic`, "pergunta
 * obrigatoria") sao inalcancaveis por omissao — so um argumento vazio EXPLICITO
 * chega neles, e e assim que os testes abaixo os exercitam. Em `context scout`
 * o efeito e mais visivel: `scout --json` responde como se `--json` fosse a
 * pergunta.
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
 * O ACHADO DE PRODUTO, FIXADO COMO ESTA. `--json` vira o proprio termo de busca
 * quando nao ha posicional. Nao esta certo, e o teste NAO afirma que esta: fixa
 * o comportamento observado para que uma correcao futura seja uma mudanca
 * DELIBERADA e visivel, e nao um efeito colateral silencioso.
 */
test("ACHADO: sem posicional, a propria flag vira o argumento do subcomando", (t) => {
  const p = payloadDe(sandbox(t), ["scout", "--json"], "scout sem pergunta e sem posicional")
  assert.equal(p.question, "--json",
    "comportamento ATUAL, nao desejado: o parsing le `args[1]` cru e engole a flag")
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
