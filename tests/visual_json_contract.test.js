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
 * CONSUMIDOR REAL de `visual --json`.
 *
 * Evidencia da declaracao de consumidor de `src/commands/visual.js` na ancora
 * fina (arquivo + comando + modo). Roda o COMANDO PUBLICO por subprocesso,
 * nunca `visualCommand()` direto: chamar a funcao interna provaria que a funcao
 * existe, nao que a superficie publica cumpre o contrato de maquina.
 *
 * `visual.js` tem eleven pontos de saida de maquina espalhados por CINCO
 * subcomandos. A ancora fina cobre o par (`visual`, `--json`) inteiro, entao
 * provar um subcomando e declarar os onze seria a mesma cobertura acidental que
 * `machineProtocolAudit` existe para impedir. Por isso cada ramo abaixo e
 * exercitado de verdade.
 *
 * O QUE FICA DE FORA, dito aqui e no fim do arquivo: `emitCancelled`
 * (`visual.js:138`) so roda quando o usuario responde NAO a um confirm
 * interativo. Sem TTY o fluxo para antes, em `hooksInstallRefused` — que ESTE
 * arquivo prova. Nao ha como exercita-lo por subprocesso sem fabricar um TTY, e
 * fabricar nao provaria o contrato do canal.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

const DESIGN_SYSTEM = {
  schemaVersion: "gstack.design-system.v2",
  status: "complete",
  engine: "custom",
  path: "ds/",
  direction: "Dark minimal",
  tokens: { colors: { p: "#000" }, typography: { b: "Inter" } },
}

const ELEMENTS = {
  elements: [{ selector: ".a", color: "#777777", backgroundColor: "#ffffff", fontSize: 16 }],
}

/** Sandbox isolado. `comDesignSystem` separa os dois ramos de `visual context`. */
function sandbox({ comDesignSystem = false } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-visual-json-"))
  writeFileSync(path.join(cwd, "elements.json"), JSON.stringify(ELEMENTS))
  if (comDesignSystem) {
    mkdirSync(path.join(cwd, ".gstack"), { recursive: true })
    writeFileSync(path.join(cwd, ".gstack", "design-system.json"), JSON.stringify(DESIGN_SYSTEM))
  }
  return cwd
}

const rodar = (cwd, args) => evaluateJsonRun(spawnSync("node", [bin, "visual", ...args, "--json"], {
  cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
}))

/** Execucao invalida REPROVA: sem isto, harness quebrada vira "verde". */
function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `${nome}: spawn falhou — o comando nem rodou`)
  assert.equal(r.timedOut, false, `${nome}: timeout — resultado nao representa o contrato`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execucao invalida`)
}

/** Contrato do CANAL, identico em todo ramo: stdout e UM documento JSON. */
function assertCanal(r, nome) {
  assertRodou(r, nome)
  assert.equal(r.pure, true, `${nome}: stdout nao e documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, `${nome}: payload de maquina nao pode sair pelo stderr`)
}

// ── Um ramo por ponto de saida ──────────────────────────────────────────────

test("`visual doctor --json` (visual.js:61)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["doctor"])
  assertCanal(r, "doctor")
  assert.equal(typeof r.doc.counts.active, "number", "o consumidor conta regras ativas")
  assert.ok(Array.isArray(r.doc.activeRules))
})

test("`visual detect <elements> --json` (visual.js:83)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["detect", "elements.json"])
  assertCanal(r, "detect")
  assert.ok(Array.isArray(r.doc.findings), "`findings` e sempre lista")
  assert.ok(r.doc.counts, "`counts` distingue checado de ignorado")
})

test("`visual explain <regra> --json` (visual.js:94)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["explain", "impeccable-color-contrast-wcag"])
  assertCanal(r, "explain")
  assert.equal(r.doc.ruleId, "impeccable-color-contrast-wcag", "o payload amarra a regra pedida")
  assert.equal(typeof r.doc.status, "string")
})

test("`visual check --url --json` sem navegador (visual.js:37)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  // Porta 1 nao responde de proposito: o ramo sob prova e o de AUSENCIA de
  // driver, que o help promete ("nunca finge verde"), nao o de app rodando.
  const r = rodar(cwd, ["check", "--url", "http://127.0.0.1:1"])
  assertCanal(r, "check")
  assert.equal(r.doc.driverAvailable, false)
  assert.equal(r.doc.blocked, true, "sem navegador o gate BLOQUEIA — verde falso seria o defeito")
  assert.ok(Array.isArray(r.doc.problems))
})

test("`visual hooks status --json` (visual.js:105)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["hooks", "status"])
  assertCanal(r, "hooks status")
  assert.ok(Array.isArray(r.doc.results))
})

test("`visual hooks install --json` SEM --yes recusa (visual.js:121)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["hooks", "install"])
  assertCanal(r, "hooks install recusa")
  assert.deepEqual(r.doc, { error: "needs_confirmation", hint: "use --yes" },
    "sem consentimento nao escreve, e diz por que — recusa e documento fechado")
})

test("`visual hooks install --json --yes` aplica (visual.js:144)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["hooks", "install", "--yes"])
  assertCanal(r, "hooks install aplicado")
  assert.ok(Array.isArray(r.doc.results), "o consumidor le o resultado por harness")
})

test("`visual context status --json` SEM design system explica (visual.js:193)", (t) => {
  const cwd = sandbox()
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["context", "status"])
  assertCanal(r, "context sem ds")
  assert.equal(r.doc.error, "no_design_system")
  assert.equal(typeof r.doc.hint, "string", "a recusa diz o que fazer, sem virar texto humano solto")
})

test("`visual context status --json` COM design system (visual.js:201)", (t) => {
  const cwd = sandbox({ comDesignSystem: true })
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["context", "status"])
  assertCanal(r, "context com ds")
  assert.equal(typeof r.doc.status, "string", "drift e o que o consumidor le")
  assert.ok(String(r.doc.sourceHash).startsWith("sha256:"))
})

test("`visual context sync --json --yes` COM design system (visual.js:210)", (t) => {
  const cwd = sandbox({ comDesignSystem: true })
  t.after(() => cleanupTmp(cwd))
  const r = rodar(cwd, ["context", "sync", "--yes"])
  assertCanal(r, "context sync")
  assert.equal(r.doc.applied, true)
  assert.ok(Array.isArray(r.doc.plans), "`plans` diz o que foi escrito, arquivo a arquivo")
})

// ── CONTROLE NEGATIVO DO PROPRIO ARQUIVO ────────────────────────────────────

/**
 * Sem `--json` o mesmo comando escreve relatorio humano com cor. Se os testes
 * acima passassem nas duas formas, eles nao estariam medindo o ramo de maquina —
 * estariam medindo "o comando roda".
 */
test("CONTROLE: sem `--json` nenhum destes ramos satisfaz o contrato de maquina", (t) => {
  const cwd = sandbox({ comDesignSystem: true })
  t.after(() => cleanupTmp(cwd))
  for (const args of [["doctor"], ["hooks", "status"], ["context", "status"]]) {
    const r = evaluateJsonRun(spawnSync("node", [bin, "visual", ...args], {
      cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
    }))
    assertRodou(r, `humano ${args.join(" ")}`)
    assert.equal(r.pure, false, `${args.join(" ")}: o ramo humano nao pode satisfazer o contrato de maquina`)
  }
})

/**
 * O QUE ESTA PROVA NAO COBRE, por extenso:
 *
 *   `visual.js:138` (`emitCancelled`) — so alcancavel quando o usuario responde
 *   NAO a um confirm INTERATIVO. Sem TTY o fluxo para antes, em
 *   `hooksInstallRefused`, que este arquivo prova. Fabricar um TTY para
 *   atravessar o confirm nao provaria o contrato do canal, provaria o mock.
 *
 * Os outros dez pontos de maquina do arquivo estao exercitados acima, um a um.
 */
