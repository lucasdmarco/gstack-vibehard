import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync, execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"
import { evaluateJsonRun } from "./helpers/json-purity.js"

/**
 * CONSUMIDOR REAL de `qa --json`.
 *
 * Existe para ser a evidencia da declaracao de consumidor de `src/commands/qa.js`
 * na ancora fina (arquivo + comando + modo). Por isso roda o COMANDO PUBLICO por
 * subprocesso — `node src/index.js qa --json` —, nunca `qaCommand()` direto:
 * chamar a funcao interna provaria que a funcao existe, nao que a superficie
 * publica cumpre o contrato de maquina.
 *
 * Cobre os DOIS ramos de `--json`, que sao dois pontos de saida distintos:
 *
 *   qa.js:44  `JSON.stringify({...gate, findings})`   — veredito
 *   qa.js:29  `'{"error":"not_a_git_repo"}'`          — recusa, literal ja serializado
 *
 * Sem o segundo, o ramo de erro ficaria sem consumidor e a declaracao mentiria
 * por omissao: cobriria o arquivo alegando uma prova que so exercita um caminho.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

function runQa(cwd) {
  return evaluateJsonRun(spawnSync("node", [bin, "qa", "--json"], {
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

const tmpDir = (prefix) => mkdtempSync(path.join(tmpdir(), prefix))

test("`qa --json` num repo git: stdout e UM documento JSON puro, com o schema minimo do veredito", (t) => {
  const cwd = tmpDir("gstack-qa-git-")
  t.after(() => cleanupTmp(cwd))
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" })
  writeFileSync(path.join(cwd, "a.js"), "export const x = 1\n")
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" })

  const r = runQa(cwd)
  assertRodou(r, "qa em repo git")
  assert.equal(r.pure, true, `stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, "payload de maquina nao pode sair pelo stderr")

  // Schema MINIMO: os campos que um consumidor precisa para decidir.
  for (const campo of ["verdict", "blocked", "findings", "byLens"]) {
    assert.ok(campo in r.doc, `o veredito precisa carregar \`${campo}\``)
  }
  assert.equal(typeof r.doc.blocked, "boolean", "`blocked` e a decisao — precisa ser booleano")
  assert.ok(Array.isArray(r.doc.findings), "`findings` e lista, mesmo vazia")
})

test("`qa --json` FORA de repo git: a recusa tambem e payload puro, com `error` no documento", (t) => {
  const cwd = tmpDir("gstack-qa-nogit-")
  t.after(() => cleanupTmp(cwd))

  const r = runQa(cwd)
  assertRodou(r, "qa fora de repo git")
  assert.equal(r.pure, true, `a recusa tambem precisa ser JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, "a recusa nao pode duplicar payload no stderr")
  assert.equal(r.doc.error, "not_a_git_repo", "o erro vira CAMPO do documento, nao prosa no stderr")
})
