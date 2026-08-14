import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"
import { evaluateJsonRun } from "./helpers/json-purity.js"

/**
 * CONSUMIDOR REAL de `orchestrate --json`.
 *
 * Evidencia da declaracao de consumidor de `src/commands/orchestrate.js` na
 * ancora fina (arquivo + comando + modo). Roda o COMANDO PUBLICO por
 * subprocesso — `node src/index.js orchestrate ... --json` —, nunca
 * `orchestrateCommand()` direto: chamar a funcao interna provaria que a funcao
 * existe, nao que a superficie publica cumpre o contrato de maquina.
 *
 * Cobre os DOIS pontos de saida de maquina do arquivo, que sao ramos
 * DIFERENTES do mesmo comando:
 *
 *   orchestrate.js:47   `{"error":"plan_not_found"}`        — recusa
 *   orchestrate.js:172  `JSON.stringify({ planId, ...res })` — resultado
 *
 * Provar so o resultado deixaria a recusa sem consumidor, e e justamente a
 * recusa que um orquestrador externo precisa distinguir de "rodou e nao fez
 * nada" — os dois sairiam pelo mesmo canal.
 *
 * O PLANO SEM PASSOS e deliberado, nao um atalho. O contrato sob prova e o do
 * CANAL (stdout e UM documento JSON, com os campos que o consumidor le), nao o
 * da execucao de passos: executar passo real dispara worktree e comando de
 * verdade, e o que isso provaria a mais nao e o contrato de maquina. O que fica
 * FORA esta dito no fim do arquivo, nao escondido.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "ignore" })

/**
 * Repo git REAL: `preflightOrchestrate` recusa fora de repo, e uma pasta
 * qualquer faria o teste medir o preflight em vez do contrato de `--json`.
 */
function sandbox(plano) {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-orch-json-"))
  git(cwd, "init", "-q", ".")
  git(cwd, "config", "user.email", "test@example.invalid")
  git(cwd, "config", "user.name", "test")
  if (plano) {
    const dir = path.join(cwd, ".gstack", "tasks", plano.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "task.json"), JSON.stringify(plano))
  }
  return cwd
}

function rodar(cwd, args) {
  return evaluateJsonRun(spawnSync("node", [bin, "orchestrate", ...args, "--json"], {
    cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
  }))
}

/** Execucao invalida REPROVA: sem isso, harness quebrada vira "verde". */
function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `${nome}: spawn falhou — o comando nem rodou`)
  assert.equal(r.timedOut, false, `${nome}: timeout — resultado nao representa o contrato`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execucao invalida`)
}

// ── orchestrate.js:47 — a RECUSA ────────────────────────────────────────────

test("`orchestrate <inexistente> --json`: stdout e UM documento JSON com a recusa", (t) => {
  const cwd = sandbox(null)
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["plano-que-nao-existe"])

  assertRodou(r, "orchestrate recusa")
  assert.equal(r.pure, true, `stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, "payload de maquina nao pode sair pelo stderr")
  assert.deepEqual(r.doc, { error: "plan_not_found" },
    "a recusa e um documento fechado: o consumidor decide por `error`, nao por texto")
})

/**
 * O invariante que o consumidor realmente usa: recusa e resultado se distinguem
 * pelo DOCUMENTO, nao pelo canal nem pelo codigo de saida.
 *
 * Nao ha assercao sobre `exitCode` aqui de proposito. `evaluateJsonRun` registra
 * o codigo e explicitamente NAO o asserta, porque o produto e inconsistente
 * (alguns caminhos de erro saem 0 com `{"error":...}`, outros chamam
 * `process.exit(1)`) e a politica esta em aberto como achado P1. Fixa-la neste
 * teste decidiria por baixo um contrato que o projeto deixou por decidir.
 */
test("recusa e resultado sao distinguiveis pelo DOCUMENTO, nao pelo canal", (t) => {
  const cwdRecusa = sandbox(null)
  const cwdOk = sandbox(PLANO_VAZIO)
  t.after(() => { cleanupTmp(cwdRecusa); cleanupTmp(cwdOk) })

  const recusa = rodar(cwdRecusa, ["plano-que-nao-existe"])
  const ok = rodar(cwdOk, [PLANO_VAZIO.id, "--yes"])
  assertRodou(recusa, "orchestrate recusa")
  assertRodou(ok, "orchestrate resultado")

  assert.ok("error" in recusa.doc && !("planId" in recusa.doc), "a recusa nao carrega `planId`")
  assert.ok("planId" in ok.doc && !("error" in ok.doc), "o resultado nao carrega `error`")
})

// ── orchestrate.js:172 — o RESULTADO ────────────────────────────────────────

const PLANO_VAZIO = { id: "p1", objective: "contrato de maquina", steps: [] }

test("`orchestrate <plano> --yes --json`: stdout e UM documento JSON com o schema do resultado", (t) => {
  const cwd = sandbox(PLANO_VAZIO)
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, [PLANO_VAZIO.id, "--yes"])

  assertRodou(r, "orchestrate resultado")
  assert.equal(r.pure, true, `stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, "payload de maquina nao pode sair pelo stderr")

  const j = r.doc
  assert.equal(j.planId, PLANO_VAZIO.id, "`planId` amarra o payload ao plano pedido")
  assert.equal(typeof j.status, "string")
  assert.ok(Array.isArray(j.steps), "`steps` e sempre lista — ausencia e lista vazia, nao campo ausente")
  assert.ok(Array.isArray(j.limits), "`limits` e o que o comando declara NAO fazer; sumir com ele esconderia o limite")
  assert.ok("handoff" in j, "`handoff` presente mesmo nulo: o consumidor distingue null de ausente")
  assert.equal(typeof j.reviewerCoverage, "string")
})

/**
 * CONTROLE NEGATIVO DO PROPRIO TESTE. Sem `--json` o mesmo comando escreve
 * relatorio humano, e stdout deixa de ser documento JSON. Se este teste passasse
 * nas duas formas, ele nao estaria medindo o ramo `--json` — estaria medindo
 * "o comando roda".
 */
test("CONTROLE: sem `--json` o mesmo comando NAO emite documento de maquina", (t) => {
  const cwd = sandbox(PLANO_VAZIO)
  t.after(() => cleanupTmp(cwd))
  const r = evaluateJsonRun(spawnSync("node", [bin, "orchestrate", PLANO_VAZIO.id, "--yes"], {
    cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
  }))

  assertRodou(r, "orchestrate humano")
  assert.equal(r.pure, false,
    "o ramo humano nao pode satisfazer o contrato de maquina: sao canais diferentes")
})

/**
 * O QUE ESTA PROVA NAO COBRE, dito por extenso para nao ser lido como mais do
 * que e:
 *
 *   - execucao de passo real (worktree, comando, gate) — o plano e vazio;
 *   - o ramo `status === "handoff"`, que em `orchestrate.js:172` faz
 *     `process.exitCode = 1`. Alcanca-lo exige passo que falhe de verdade, e
 *     fabricar essa falha nao provaria o contrato do canal.
 *
 * Ambos sao contrato de EXECUCAO, nao de maquina. A declaracao de consumidor
 * afirma exatamente o que estes quatro testes exercem: que sob `--json` os dois
 * pontos de saida emitem um documento JSON fechado em stdout, e nada mais.
 */
