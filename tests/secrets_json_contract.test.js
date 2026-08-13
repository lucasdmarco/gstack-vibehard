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
 * CONSUMIDOR REAL de `secrets --json`.
 *
 * Existe para ser a evidencia da declaracao de consumidor de
 * `src/commands/secrets.js` na ancora fina (arquivo + comando + modo). Roda o
 * COMANDO PUBLICO por subprocesso — `node src/index.js secrets <sub> --json` —,
 * nunca `secretsCommand()` direto: chamar a funcao interna provaria que a funcao
 * existe, nao que a superficie publica cumpre o contrato de maquina.
 *
 * Cobre os DOIS pontos de saida de maquina do arquivo, que sao subcomandos
 * DIFERENTES do mesmo comando:
 *
 *   secrets.js:67  `JSON.stringify(report)`      — `secrets doctor --json`
 *   secrets.js:74  `JSON.stringify({ names })`   — `secrets list --json`
 *
 * Provar so um cobriria o arquivo alegando prova de um caminho so — a mesma
 * omissao que `qa_json_contract` evita cobrindo veredito E recusa.
 *
 * POR QUE O SCHEMA E POR TIPO, NAO POR VALOR: `provider` e `available` dependem
 * do keychain do SO (windows-dpapi, keychain do macOS, libsecret, ou nenhum), e
 * o CI roda nos tres. Assertar `provider === "windows-dpapi"` transformaria uma
 * diferenca legitima de plataforma em falha. O que o consumidor de maquina
 * precisa e que os CAMPOS existam com os tipos certos.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

function runSecrets(sub) {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-secrets-json-"))
  try {
    return evaluateJsonRun(spawnSync("node", [bin, "secrets", sub, "--json"], {
      cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
    }))
  } finally { cleanupTmp(cwd) }
}

/** Execucao invalida REPROVA: sem isso, harness quebrada vira "verde". */
function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `${nome}: spawn falhou — o comando nem rodou`)
  assert.equal(r.timedOut, false, `${nome}: timeout — resultado nao representa o contrato`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execucao invalida`)
}

test("`secrets doctor --json`: stdout e UM documento JSON puro, com o schema minimo do relatorio", () => {
  const r = runSecrets("doctor")
  assertRodou(r, "secrets doctor")
  assert.equal(r.pure, true, `stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, "payload de maquina nao pode sair pelo stderr")

  // Schema MINIMO: os campos que um consumidor precisa para decidir.
  for (const campo of ["provider", "available", "required", "stored", "missing", "ok"]) {
    assert.ok(campo in r.doc, `o relatorio precisa carregar \`${campo}\``)
  }
  assert.equal(typeof r.doc.available, "boolean", "`available` e fato sobre o keychain — booleano")
  assert.equal(typeof r.doc.ok, "boolean", "`ok` e a decisao — precisa ser booleano")
  for (const campo of ["required", "stored", "missing"]) {
    assert.ok(Array.isArray(r.doc[campo]), `\`${campo}\` e lista, mesmo vazia`)
  }
})

test("`secrets list --json`: o segundo ponto de maquina do arquivo tambem e payload puro", () => {
  const r = runSecrets("list")
  assertRodou(r, "secrets list")
  assert.equal(r.pure, true, `stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, "payload de maquina nao pode sair pelo stderr")
  assert.ok(Array.isArray(r.doc.names), "`names` e lista, mesmo sem nenhum segredo guardado")
})

/**
 * O VALOR nunca sai — nem no modo de maquina. `listSecrets` monta `{ names }` a
 * partir de `listSecretNames`, que le o INDICE, nao o keychain; o comentario
 * "NUNCA o valor" no ramo humano (secrets.js:77) descreve a mesma intencao.
 * Sem este controle, o contrato de `--json` estaria provado como "parseia" e
 * calado sobre a unica coisa que torna este comando sensivel.
 */
test("CONTROLE: nenhum dos dois payloads carrega campo de VALOR de segredo", () => {
  for (const [sub, doc] of [["doctor", runSecrets("doctor").doc], ["list", runSecrets("list").doc]]) {
    const texto = JSON.stringify(doc)
    for (const proibido of ["value", "secret", "password", "token"]) {
      assert.equal(texto.includes(`"${proibido}"`), false,
        `\`secrets ${sub} --json\` nao pode expor campo \`${proibido}\` no payload`)
    }
  }
})
