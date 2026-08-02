import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanupTmp } from "./helpers/tmp.js"
import {
  pureJsonStdout, stderrHasStandaloneJsonDocument, evaluateJsonRun,
} from "./helpers/json-purity.js"

/**
 * Contrato `--json`: stdout inteiro é UM documento JSON; stderr pode
 * diagnosticar mas NUNCA carrega o payload.
 *
 * Endurece o DOD.13, que usava `lastJsonLine` — procura a última linha
 * parseável e portanto ACEITA banner humano, progresso e ANSI antes do JSON.
 * Aquele teste provava "existe JSON na saída"; este prova "a saída É JSON".
 *
 * Usa `spawnSync`, não `execFileSync`. A 1ª versão usava `execFileSync`, que
 * devolve só stdout — stderr só chegava pelo `catch`, que NUNCA dispara quando
 * o erro sai com exit 0 (e vários saem). Resultado: todos os casos observavam
 * `stderr=""` artificialmente, e a "política de stderr" não provava nada.
 *
 * Falha de spawn, sinal e timeout REPROVAM: sem isso o teste não distingue
 * "comando cumpriu o contrato" de "comando nem rodou".
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const bin = path.join(repoRoot, "src", "index.js")

function runCli(args) {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-jsonpure-"))
  try {
    return spawnSync("node", [bin, ...args], {
      cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
    })
  } finally { cleanupTmp(cwd) }
}

/** Toda execução real passa por aqui: sem isso, harness quebrada vira "verde". */
function assertRan(r, nome) {
  assert.equal(r.spawnFailed, false, `${nome}: spawn falhou — o comando nem rodou`)
  assert.equal(r.timedOut, false, `${nome}: timeout — resultado não representa o contrato`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execução inválida`)
}

// ── Caminho de SUCESSO ────────────────────────────────────────────────────────
const SUCESSO = [
  ["doctor", ["doctor", "--json"]],
  ["prd status", ["prd", "status", "--json"]],
  ["actions ledger", ["actions", "ledger", "--json"]],
  ["policy show", ["policy", "show", "--json"]],
  ["state list", ["state", "list", "--json"]],
  ["runtime status", ["runtime", "status", "--json"]],
  ["stop", ["stop", "--json"]],
  ["worktree list", ["worktree", "list", "--json"]],
  ["skills catalog", ["skills", "catalog", "--json"]],
  ["create --dry-run", ["create", "amostra", "--dry-run", "--json"]],
  ["consult", ["consult", "um app de exemplo", "--json"]],
  ["plan", ["plan", "um app de exemplo", "--json"]],
  ["start --dry-run", ["start", "um app de exemplo", "--dry-run", "--json"]],
]

for (const [nome, args] of SUCESSO) {
  test(`SUCESSO: \`${nome} --json\` — stdout puro e payload fora do stderr`, () => {
    const r = evaluateJsonRun(runCli(args))
    assertRan(r, nome)
    assert.equal(r.pure, true, `stdout não é um documento JSON puro (motivo: ${r.reason})`)
    assert.equal(r.stderrHasStandaloneJson, false, "payload de máquina não pode sair pelo stderr")
  })
}

// ── Caminho DEGRADADO (warning) ───────────────────────────────────────────────
test("WARNING: `dev --json` sem projeto mantém stdout puro no caminho degradado", () => {
  const r = evaluateJsonRun(runCli(["dev", "--json"]))
  assertRan(r, "dev")
  assert.equal(r.pure, true, `motivo: ${r.reason}`)
  assert.equal(r.doc.status, "no_runtime", "o diagnóstico vira campo, não prosa")
  assert.ok(Array.isArray(r.doc.actions) && r.doc.actions.length > 0, "e continua acionável")
  assert.equal(r.stderrHasStandaloneJson, false)
})

test("WARNING: `actions ledger --json` sem runs mantém stdout puro", () => {
  const r = evaluateJsonRun(runCli(["actions", "ledger", "--json"]))
  assertRan(r, "actions ledger")
  assert.equal(r.pure, true, `motivo: ${r.reason}`)
  assert.equal(r.doc.reason, "no_runs")
  assert.equal(r.stderrHasStandaloneJson, false)
})

// ── Caminho de ERRO ───────────────────────────────────────────────────────────
const ERRO = [
  ["prd bogus", ["prd", "bogus", "--json"], (d) => assert.ok(d.error, "erro declarado no payload")],
  ["plan sem objetivo", ["plan", "--json"], (d) => assert.equal(d.error, "missing objective")],
  ["plan run inexistente", ["plan", "run", "plan_inexistente", "--json", "--yes"], (d) => assert.equal(d.error, "not_found")],
  ["start sem objetivo", ["start", "--dry-run", "--json"], (d) => assert.equal(d.ok, false)],
]

for (const [nome, args, checa] of ERRO) {
  test(`ERRO: \`${nome}\` — stdout puro, erro NO payload, stderr sem payload`, () => {
    const r = evaluateJsonRun(runCli(args))
    assertRan(r, nome)
    assert.equal(r.pure, true, `motivo: ${r.reason}`)
    checa(r.doc)
    assert.equal(r.stderrHasStandaloneJson, false, "erro não pode duplicar o payload no stderr")
  })
}

// ── Política de stderr — agora com dente ──────────────────────────────────────
test("POLÍTICA: stderr com DIAGNÓSTICO humano é permitido", () => {
  assert.equal(stderrHasStandaloneJsonDocument("aviso: ferramenta X ausente\n"), false)
  assert.equal(stderrHasStandaloneJsonDocument(""), false, "stderr vazio é válido")
  assert.equal(stderrHasStandaloneJsonDocument("  \n "), false)
})

test("CONTROLE NEGATIVO: documento JSON em stderr REPROVA (payload no canal errado)", () => {
  assert.equal(stderrHasStandaloneJsonDocument('{"ok":true}'), true)
  assert.equal(stderrHasStandaloneJsonDocument('{"error":"x"}\n'), true)
  assert.equal(stderrHasStandaloneJsonDocument("[1,2]"), true)
})

test("CONTROLE NEGATIVO: payload DESLOCADO — diagnóstico + JSON no stderr REPROVA", () => {
  assert.equal(stderrHasStandaloneJsonDocument('aviso: algo\n{"status":"ok"}\n'), true,
    "misturar diagnóstico com payload continua sendo payload no canal errado")
})

test("CONTROLE NEGATIVO: payload DUPLICADO (mesmo doc em stdout e stderr) REPROVA", () => {
  const doc = '{"status":"ok"}'
  const r = evaluateJsonRun({ stdout: doc, stderr: doc, status: 0 })
  assert.equal(r.pure, true, "stdout continua puro")
  assert.equal(r.stderrHasStandaloneJson, true, "mas a duplicação é detectada")
})

test("stderr que MENCIONA chaves sem ser documento NÃO reprova (evita falso positivo)", () => {
  assert.equal(stderrHasStandaloneJsonDocument('use o campo "status" para checar\n'), false)
  assert.equal(stderrHasStandaloneJsonDocument("erro em {arquivo}\n"), false)
})

// ── Harness: execução inválida REPROVA ────────────────────────────────────────
test("CONTROLE NEGATIVO: falha de spawn REPROVA (não é contrato cumprido)", () => {
  const r = evaluateJsonRun({ error: new Error("ENOENT"), stdout: "", stderr: "" })
  assert.equal(r.spawnFailed, true)
  assert.equal(r.ran, false)
})

test("CONTROLE NEGATIVO: timeout REPROVA e é distinguido de falha de spawn", () => {
  const r = evaluateJsonRun({ error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), stdout: "" })
  assert.equal(r.timedOut, true)
  assert.equal(r.spawnFailed, false, "timeout não é falha de spawn — a correção difere")
})

test("CONTROLE NEGATIVO: morte por SINAL REPROVA", () => {
  const r = evaluateJsonRun({ stdout: '{"ok":true}', signal: "SIGKILL", status: null })
  assert.equal(r.ran, false, "stdout puro não salva execução morta por sinal")
})

// ── CONTROLE NEGATIVO de stdout (fixtures — sem sujar produção) ───────────────
test("CONTROLE NEGATIVO: banner humano ANTES do JSON REPROVA", () => {
  const r = pureJsonStdout('  -- doctor --\n{"ok":true}\n')
  assert.equal(r.pure, false, "é exatamente o caso que lastJsonLine aceitava")
  assert.equal(r.reason, "human_text_around_json")
})

test("CONTROLE NEGATIVO: texto humano DEPOIS do JSON REPROVA", () => {
  const r = pureJsonStdout('{"ok":true}\nConcluido com sucesso.\n')
  assert.equal(r.pure, false)
  assert.equal(r.reason, "human_text_around_json")
})

test("CONTROLE NEGATIVO: codigo ANSI no stdout REPROVA", () => {
  const r = pureJsonStdout("[36m{\"ok\":true}[0m")
  assert.equal(r.pure, false)
  assert.equal(r.reason, "ansi_escape_in_stdout")
})

// FALSO POSITIVO que a 1a versao produzia: o regex ANSI nao exigia ESC, entao
// casava colchete+digitos+letra em qualquer lugar — inclusive DENTRO de uma
// string JSON legitima. Um validador que rejeita entrada valida e pior que
// nenhum, porque ensina a ignora-lo.
test("CONTROLE NEGATIVO do FALSO POSITIVO: `[31m` como CONTEUDO de JSON valido PASSA", () => {
  const r = pureJsonStdout('{"text":"[31m"}')
  assert.equal(r.pure, true, "sem ESC nao e sequencia ANSI — e texto comum")
  assert.equal(r.doc.text, "[31m")
})

test("CONTROLE NEGATIVO: dois documentos JSON REPROVAM (ndjson exige modo declarado)", () => {
  const r = pureJsonStdout('{"a":1}\n{"b":2}\n')
  assert.equal(r.pure, false)
  assert.equal(r.reason, "multiple_json_documents")
})

test("CONTROLE NEGATIVO: stdout vazio REPROVA — ausencia nao e contrato cumprido", () => {
  assert.equal(pureJsonStdout("").reason, "empty_stdout")
  assert.equal(pureJsonStdout("   \n ").reason, "empty_stdout")
})

test("CONTROLE NEGATIVO: escalar parseavel NAO e documento de contrato", () => {
  assert.equal(pureJsonStdout("3").reason, "not_an_object_document")
  assert.equal(pureJsonStdout('"pronto"').reason, "not_an_object_document")
  assert.equal(pureJsonStdout("null").reason, "not_an_object_document")
})

test("CONTROLE POSITIVO: JSON puro (objeto e array) passa — o gate e alcancavel", () => {
  assert.equal(pureJsonStdout('{"ok":true}').pure, true)
  assert.equal(pureJsonStdout('  {"ok":true}\n').pure, true, "whitespace ao redor e tolerado")
  assert.equal(pureJsonStdout("[1,2]").pure, true, "array e documento valido")
})

// ── Observacao registrada, NAO asserida ───────────────────────────────────────
// ACHADO P1 SEPARADO (nao corrigido aqui): o produto e inconsistente no exit
// code. `prd bogus --json` e `plan --json` saem 0 com `{"error":…}`, enquanto
// outros caminhos chamam `process.exit(1)` (cli/index.js:306,394; init.js;
// sprint.js). Causa: `src/index.js` chama `runCLI(...)` e DESCARTA o retorno.
// Consumidor de maquina nao distingue sucesso de erro pelo exit code.
// Registrado como DADO ate haver decisao humana de politica.
test("OBSERVACAO: exit code e CAPTURADO para auditoria, nao asserido", () => {
  const r = evaluateJsonRun(runCli(["prd", "bogus", "--json"]))
  assertRan(r, "prd bogus")
  assert.equal(r.pure, true, "o que ESTA no contrato — stdout puro — vale mesmo em erro")
  assert.equal(typeof r.exitCode, "number", "exit code capturado para quando a politica for decidida")
})
