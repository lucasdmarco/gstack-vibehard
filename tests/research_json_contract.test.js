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
 * ACHADO DE PRODUTO, fixado e NAO corrigido aqui: os ramos de ERRO DE USO
 * (`validate` sem claim, `skills audit` sem `--path`/`--repo`) ignoram `--json` e
 * escrevem prosa colorida. Um consumidor de maquina que chame errado recebe
 * texto ANSI onde esperava um documento. E a mesma classe de defeito do
 * posicional de `context`, e esta em `tests/context_json_contract.test.js`.
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

/**
 * O ACHADO, FIXADO COMO ESTA. O ramo de erro de uso ignora `--json`. O teste NAO
 * afirma que isso esta certo: fixa o comportamento observado para que a correcao
 * futura seja deliberada e visivel.
 */
test("ACHADO: erro de USO ignora `--json` e responde em prosa", (t) => {
  const r = rodar(sandbox(t), ["skills", "audit", "--json"])
  assertRodou(r, "audit sem --path nem --repo")
  assert.equal(r.pure, false,
    "comportamento ATUAL, nao desejado: quem chama errado com `--json` recebe texto, nao documento")
})
