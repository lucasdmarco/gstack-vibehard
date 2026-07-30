import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.9.3 — `logs --follow` REAL (§51.9 ação 5).
 *
 * Estado anterior: o help anunciava `logs [serviço] [--follow]` e a flag só
 * imprimia "(--follow contínuo chega no refinamento; por ora mostra o
 * acumulado.)". Flag anunciada e inerte — o tipo de promessa sem entrega que
 * este programa vem eliminando. Decisão do PRD: implementar OU remover do
 * help. Implementado.
 */

const tmpLog = (conteudo = "") => {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-follow-"))
  const log = path.join(dir, "svc.log")
  writeFileSync(log, conteudo)
  return { dir, log }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test("followLog captura APENAS os bytes novos escritos depois do início", async () => {
  const { followLog } = await imp("src/commands/runtime-supervisor.js")
  const { dir, log } = tmpLog("linha antiga\n")
  try {
    let capturado = ""
    const seguindo = followLog(log, {
      fromOffset: Buffer.byteLength("linha antiga\n"),
      intervalMs: 20, maxMs: 700, write: (s) => { capturado += s },
    })
    await sleep(80)
    appendFileSync(log, "linha nova 1\n")
    await sleep(80)
    appendFileSync(log, "linha nova 2\n")
    const r = await seguindo
    assert.equal(r.reason, "timeout")
    assert.match(capturado, /linha nova 1/)
    assert.match(capturado, /linha nova 2/)
    assert.ok(!capturado.includes("linha antiga"), "não reimprime o que já havia sido mostrado")
  } finally { cleanupTmp(dir) }
})

test("followLog com fromOffset 0 lê o arquivo inteiro (inclusive o que já existia)", async () => {
  const { followLog } = await imp("src/commands/runtime-supervisor.js")
  const { dir, log } = tmpLog("conteudo previo\n")
  try {
    let capturado = ""
    const r = await followLog(log, { fromOffset: 0, intervalMs: 20, maxMs: 150, write: (s) => { capturado += s } })
    assert.equal(r.reason, "timeout")
    assert.match(capturado, /conteudo previo/)
  } finally { cleanupTmp(dir) }
})

test("followLog: log TRUNCADO/rotado relê do começo em vez de calcular offset negativo", async () => {
  const { followLog } = await imp("src/commands/runtime-supervisor.js")
  const { dir, log } = tmpLog("aaaaaaaaaaaaaaaaaaaa\n")
  try {
    let capturado = ""
    const seguindo = followLog(log, {
      fromOffset: Buffer.byteLength("aaaaaaaaaaaaaaaaaaaa\n"),
      intervalMs: 20, maxMs: 700, write: (s) => { capturado += s },
    })
    await sleep(80)
    writeFileSync(log, "curto\n") // rotação: arquivo ENCOLHEU
    await sleep(200)
    await seguindo
    assert.match(capturado, /curto/, "após truncar, lê do início — não quebra nem perde o conteúdo novo")
  } finally { cleanupTmp(dir) }
})

test("followLog: arquivo REMOVIDO encerra honestamente com `log_gone` (não fica girando)", async () => {
  const { followLog } = await imp("src/commands/runtime-supervisor.js")
  const { dir, log } = tmpLog("x\n")
  try {
    const seguindo = followLog(log, { fromOffset: 2, intervalMs: 20, maxMs: 3000, write: () => {} })
    await sleep(60)
    rmSync(log, { force: true })
    const r = await seguindo
    assert.equal(r.reason, "log_gone")
  } finally { cleanupTmp(dir) }
})

test("followLog devolve o offset final (retomável, sem duplicar nem perder byte)", async () => {
  const { followLog } = await imp("src/commands/runtime-supervisor.js")
  const { dir, log } = tmpLog("")
  try {
    appendFileSync(log, "abc\n")
    const r = await followLog(log, { fromOffset: 0, intervalMs: 20, maxMs: 120, write: () => {} })
    assert.equal(r.offset, Buffer.byteLength(readFileSync(log, "utf-8")))
  } finally { cleanupTmp(dir) }
})

// Wiring real no comando.
function stateWith(logPath) {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-logs-cmd-"))
  const stateDir = path.join(dir, ".gstack", "runtime")
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, "web.json"), JSON.stringify({ name: "web", pid: 1, log: logPath }))
  return dir
}

test("WIRING REAL: `logs` sem --follow imprime o acumulado e RETORNA (não fica seguindo)", async () => {
  const { logsCommand } = await imp("src/commands/runtime-supervisor.js")
  const { dir: logDir, log } = tmpLog("acumulado aqui\n")
  const cwd = stateWith(log)
  // Sem sequestrar `process.stdout.write` global: fazer isso engole a saída do
  // PRÓPRIO test runner e some com testes do placar (aconteceu aqui — 2 testes
  // desapareceram da contagem). Por isso `logsCommand` ganhou o seam `write`.
  let out = ""
  try {
    const r = await logsCommand([], { cwd, write: (s) => { out += String(s) } })
    assert.equal(r, undefined, "sem --follow o comando termina")
  } finally { cleanupTmp(cwd); cleanupTmp(logDir) }
  assert.match(out, /acumulado aqui/)
})

test("WIRING REAL: `logs --follow` segue o arquivo e capta linha escrita DEPOIS", async () => {
  const { logsCommand } = await imp("src/commands/runtime-supervisor.js")
  const { dir: logDir, log } = tmpLog("inicial\n")
  const cwd = stateWith(log)
  let seguido = ""
  try {
    const p = logsCommand(["--follow"], { cwd, write: () => {}, followIntervalMs: 20, followMaxMs: 600, followWrite: (s) => { seguido += s } })
    await sleep(120)
    appendFileSync(log, "apareceu depois\n")
    const r = await p
    assert.equal(r.reason, "timeout")
  } finally { cleanupTmp(cwd); cleanupTmp(logDir) }
  assert.match(seguido, /apareceu depois/)
  assert.ok(!seguido.includes("inicial"), "o acumulado já saiu antes — --follow não duplica")
})

test("CONTROLE NEGATIVO: sem serviço/log, `--follow` NÃO fica pendurado — avisa e sai", async () => {
  const { logsCommand } = await imp("src/commands/runtime-supervisor.js")
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-logs-vazio-"))
  try {
    const r = await logsCommand(["--follow"], { cwd, followMaxMs: 50 })
    assert.equal(r, undefined, "sem log não entra em modo follow")
  } finally { cleanupTmp(cwd) }
})

// A flag deixou de ser promessa vazia — guarda contra regressão do texto.
test("o help deixou de anunciar --follow como pendência e o código não tem mais o aviso de 'refinamento'", () => {
  const cli = readFileSync(path.join(repoRoot, "src", "cli", "index.js"), "utf-8")
  const sup = readFileSync(path.join(repoRoot, "src", "commands", "runtime-supervisor.js"), "utf-8")
  assert.match(cli, /--follow segue o arquivo em tempo real/, "o help descreve o comportamento REAL")
  // A guarda é sobre o CAMINHO DE CÓDIGO inerte, não sobre a frase: o comentário
  // do módulo cita o texto antigo de propósito, pra registrar o que era.
  assert.ok(!/info\([^)]*chega no refinamento/.test(sup), "não há mais `info(...)` avisando que a flag é inerte")
  assert.match(sup, /export function followLog/, "existe implementação de verdade")
  assert.match(sup, /export async function logsCommand/, "o comando virou async pra poder seguir de verdade")
})
