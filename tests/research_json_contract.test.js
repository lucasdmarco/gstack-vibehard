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
 * CONSUMIDOR REAL de `research … --json`.
 *
 * Evidencia da declaracao de consumidor de `src/commands/research.js` na ancora
 * fina (arquivo + comando + modo). Roda o COMANDO PUBLICO por subprocesso, nunca
 * o handler direto.
 *
 * CINCO pontos de maquina, um por familia de subcomando, e cada um e uma funcao
 * diferente — nao ha helper unico como em `context.js`:
 *
 *   :134  `repoRefused`      recusa por falta de consentimento de rede
 *   :168  `emitAudit`        resultado da auditoria de skills externas
 *   :198  `emitNotebookLm`   payload do conector (doctor / connect / query / import)
 *   :310  `validateCmd`      revisao epistemica
 *   :129  `emitCancelled`    NAO COBERTO — ver a lacuna declarada abaixo
 *
 * LACUNA DECLARADA, nao presumida: `emitCancelled` so roda quando o usuario
 * responde NAO a um confirm INTERATIVO. Sem TTY o fluxo para antes, em
 * `repoRefused`, que esta coberto. Mesma forma da lacuna de `visual.js:138`.
 *
 * ACHADO DE PRODUTO CORRIGIDO (`P1.CLI-JSON-EXIT-CODE.b`, 2026-08-17): os ramos
 * de ERRO DE USO ignoravam `--json` e respondiam em prosa ANSI. Hoje emitem
 * documento puro com codigo estavel e exit code proprio, e o modo humano segue
 * identico. Ver a secao "Erro de USO" abaixo.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

const rodar = (cwd, args) => evaluateJsonRun(spawnSync("node", [bin, "research", ...args], {
  cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
}))

/** Execucao invalida REPROVA: sem isso, harness quebrada vira "verde". */
function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `${nome}: spawn falhou — o comando nem rodou`)
  assert.equal(r.timedOut, false, `${nome}: timeout — o resultado nao representa o contrato`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execucao invalida`)
}

function payloadDe(cwd, args, nome) {
  const r = rodar(cwd, args)
  assertRodou(r, nome)
  assert.equal(r.pure, true, `${nome}: stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, `${nome}: payload de maquina nao pode sair pelo stderr`)
  return r.doc
}

const sandbox = (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-resjson-"))
  t.after(() => cleanupTmp(cwd))
  return cwd
}

// ── `notebooklm` — o ponto `:198` ──────────────────────────────────────────

test("`research notebooklm doctor --json`: documento com schema e status do conector", (t) => {
  const p = payloadDe(sandbox(t), ["notebooklm", "doctor", "--json"], "notebooklm doctor")
  assert.equal(p.schemaVersion, "gstack.notebooklm-adapter.v1")
  assert.equal(typeof p.status, "string")
})

/**
 * O MESMO PONTO, servindo a frase cuja ORIGEM foi ancorada. A decisao de
 * provenance de `p.message` aponta para `src/tools/notebooklm.js`; aqui se prova
 * que o payload que carrega aquela frase chega mesmo ao consumidor de maquina.
 */
test("`research notebooklm connect --json`: payload carrega `mode` e `message`", (t) => {
  const p = payloadDe(sandbox(t), ["notebooklm", "connect", "--json"], "notebooklm connect")
  assert.equal(p.schemaVersion, "gstack.notebooklm-adapter.v1")
  assert.equal(p.mode, "interactive_required")
  assert.match(p.message, /interativo/i, "a frase vem do modulo do conector, nao do callsite")
})

// ── `skills audit` — os pontos `:134` e `:168` ─────────────────────────────

/**
 * RECUSA POR CONSENTIMENTO, e ela precisa chegar como RECUSA. `--repo` tem
 * efeito de rede; sem `--yes` e sem TTY o comando nao clona nada. Um consumidor
 * que lesse isso como "auditoria vazia" tomaria a decisao errada.
 */
test("`research skills audit --repo … --json` sem `--yes`: recusa serializada", (t) => {
  const p = payloadDe(sandbox(t),
    ["skills", "audit", "--repo", "https://example.invalid/x.git", "--json"], "audit --repo sem --yes")
  assert.equal(p.error, "needs_confirmation")
  assert.equal(p.hint, "use --yes")
})

test("`research skills audit --path … --json`: auditoria read-only com guardrails no payload", (t) => {
  const cwd = sandbox(t)
  const skills = path.join(cwd, "skills", "demo")
  mkdirSync(skills, { recursive: true })
  writeFileSync(path.join(skills, "SKILL.md"), "---\nname: demo\n---\n# Demo\n")

  const p = payloadDe(cwd, ["skills", "audit", "--path", path.join(cwd, "skills"), "--json"], "audit --path")
  assert.equal(p.schemaVersion, "gstack.external-skills-audit.v1")
  assert.equal(p.mode, "read_only_snapshot_no_external_scripts")
  assert.equal(p.guardrails.noExternalScriptsExecuted, true,
    "o consumidor precisa poder verificar que nada foi executado")
  assert.equal(p.guardrails.noInstall, true)
  assert.equal(p.provenance.auditedFiles, 1)
})

// ── `validate` — o ponto `:310` ────────────────────────────────────────────

test("`research validate \"…\" --json`: revisao epistemica com claims tipados", (t) => {
  const p = payloadDe(sandbox(t), ["validate", "cache reduz latencia", "--json"], "validate")
  assert.equal(p.schemaVersion, "gstack.epistemic-review.v1")
  assert.equal(p.question, "cache reduz latencia")
  assert.ok(Array.isArray(p.claims) && p.claims.length > 0)
  assert.equal(typeof p.claims[0].kind, "string", "claim tipado — fato/inferencia/hipotese")
})

// ── CONTROLES NEGATIVOS ────────────────────────────────────────────────────

test("CONTROLE NEGATIVO: sem `--json`, `notebooklm doctor` NAO emite documento", (t) => {
  const r = rodar(sandbox(t), ["notebooklm", "doctor"])
  assertRodou(r, "notebooklm doctor sem --json")
  assert.equal(r.pure, false, "no ramo humano o stdout nao pode ser um documento JSON puro")
})

test("CONTROLE NEGATIVO: sem `--json`, `validate` NAO emite documento", (t) => {
  const r = rodar(sandbox(t), ["validate", "cache reduz latencia"])
  assertRodou(r, "validate sem --json")
  assert.equal(r.pure, false)
})

// ── Erro de USO sob `--json`: documento, nunca prosa ──────────────────────

/**
 * O ACHADO CORRIGIDO (`P1.CLI-JSON-EXIT-CODE.b`, fix autorizado em 2026-08-17).
 *
 * Os ramos de erro de uso escreviam pelo canal HUMANO mesmo sob `--json`, com
 * escapes ANSI. Quem chamava errado recebia texto colorido onde esperava
 * documento -- e o consumidor de maquina nao tinha como distinguir erro de USO
 * de payload malformado: as duas coisas chegavam como "isto nao parseia".
 *
 * SEIS pontos, cobertos um a um. O ultimo -- o dispatcher sem subcomando -- e o
 * mais provavel de um consumidor encontrar, e era o mesmo defeito na porta de
 * entrada.
 */
for (const [nome, args, code, exit] of [
  ["audit sem fonte", ["skills", "audit", "--json"], "missing_source", 1],
  ["validate sem claim", ["validate", "--json"], "missing_claim", 2],
  ["notebooklm query sem args", ["notebooklm", "query", "--json"], "missing_notebook_or_question", 1],
  ["notebooklm import sem args", ["notebooklm", "import", "--json"], "missing_result_or_target", 1],
  ["notebooklm subcomando invalido", ["notebooklm", "xyz", "--json"], "unknown_subcommand", 1],
  ["dispatcher sem subcomando", ["--json"], "unknown_subcommand", 1],
]) {
  test(`USO: ${nome} responde documento puro, com codigo e exit proprios`, (t) => {
    const r = rodar(sandbox(t), args)
    assertRodou(r, nome)
    assert.equal(r.pure, true, `${nome}: stdout precisa ser documento JSON puro (motivo: ${r.reason})`)
    assert.equal(r.stderrHasStandaloneJson, false, "o payload nunca sai pelo stderr")
    assert.equal(r.doc.ok, false)
    assert.equal(r.doc.error, code, "o codigo e estavel e legivel por maquina")
    // O documento carrega o CODIGO, nao a prosa: consumidor de maquina decide
    // por codigo, nunca parseando frase. E o mesmo contrato de `ctxFail`.
    assert.equal("detail" in r.doc, false, "prosa no payload convidaria o consumidor a parsea-la")
    assert.equal(r.exitCode, exit, "erro de uso com exit 0 engana quem decide por status")
  })
}

/**
 * `validate` sai com 2 e nao 1, e isso e PRESERVADO de proposito: era o codigo
 * deste erro de uso antes da correcao, e muda-lo quebraria automacao que ja o
 * distingue de falha de VEREDITO (que tambem sai != 0, por outro caminho).
 */
/**
 * `research` SOZINHO e AJUDA, e ajuda nao e erro: sai com 0, como `--help`. Sob
 * `--json` e outra coisa -- uma maquina pediu documento e a chamada estava
 * malformada --, e ai o status precisa dizer isso. A assimetria e deliberada.
 */
test("HUMANO: `research` sem subcomando imprime o usage e sai com 0", (t) => {
  const r = rodar(sandbox(t), [])
  assertRodou(r, "usage humano")
  assert.equal(r.pure, false)
  assert.equal(r.exitCode, 0, "ajuda nao e erro")
})

test("USO: `validate` mantem o exit 2 que ja tinha", (t) => {
  const r = rodar(sandbox(t), ["validate", "--json"])
  assert.equal(r.exitCode, 2, "codigo de uso preservado — a correcao muda o CANAL, nao o contrato")
})

/**
 * NENHUM ESCAPE ANSI no documento. Era o sintoma exato do achado: texto colorido
 * chegando onde se esperava JSON.
 */
test("USO: o documento nao carrega escape ANSI algum", (t) => {
  const r = rodar(sandbox(t), ["skills", "audit", "--json"])
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(r.stdout ?? JSON.stringify(r.doc), /\u001b\[/, "ANSI no payload de maquina")
})

// ── O modo humano nao muda ────────────────────────────────────────────────

/**
 * A correcao troca o CANAL sob `--json`, e mais nada. Sem `--json` a mensagem
 * continua sendo a mesma prosa, no mesmo lugar -- se mudasse, seria uma segunda
 * mudanca de comportamento publico escondida dentro da primeira.
 */
for (const [nome, args] of [
  ["audit sem fonte", ["skills", "audit"]],
  ["validate sem claim", ["validate"]],
]) {
  test(`HUMANO: ${nome} continua em prosa, e NAO vira documento`, (t) => {
    const r = rodar(sandbox(t), args)
    assertRodou(r, nome)
    assert.equal(r.pure, false, "sem `--json`, a saida humana nao pode virar JSON")
  })
}
