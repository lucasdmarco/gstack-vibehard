import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.1 — runtime Windows determinístico (achado 4.1).
 *
 * O bug real (reproduzido): `execFileSync("taskkill", ...)` de um PID já morto
 * NÃO lança com `code:"ESRCH"` — lança com `code:undefined`, `status:128` e
 * `stderr:"...não foi encontrado"`. O `killErrorStatus` antigo, olhando só
 * `e.code`, classificava isso como `signal_failed` (STOP_UNRESOLVED) → state
 * nunca limpo → PIDs "vivos", EBUSY, diretórios residuais.
 *
 * A correção: a AUTORIDADE final é a probe de liveness real, não o exit code do
 * taskkill. Se o processo sumiu, o status é `already_gone`/`stopped`, custe o
 * que o taskkill disser.
 */

// Formato REAL do erro do taskkill no Windows (medido).
const taskkillDeadPidError = () => Object.assign(new Error("Command failed"), {
  code: undefined, status: 128, stderr: 'ERRO: o processo "999" não foi encontrado.',
})
const taskkillAccessDenied = () => Object.assign(new Error("Command failed"), {
  code: undefined, status: 1, stderr: "ERRO: acesso negado.",
})

test("CONTROLE NEGATIVO (o bug): taskkill de PID morto (code:undefined/status:128) NÃO é signal_failed", async () => {
  const { classifyKillResult } = await imp("src/runtime/supervisor.js")
  // liveness após o kill: o processo NÃO existe mais.
  const r = classifyKillResult({ error: taskkillDeadPidError(), aliveAfter: false })
  assert.notEqual(r, "signal_failed", "o bug do 4.1: isto virava signal_failed e preservava o state")
  assert.equal(r, "already_gone", "processo sumiu -> already_gone")
})

test("liveness é a autoridade: taskkill 'falha' mas processo morreu -> stopped/already_gone", async () => {
  const { classifyKillResult } = await imp("src/runtime/supervisor.js")
  // taskkill não lançou (exit 0) e o processo morreu -> stopped
  assert.equal(classifyKillResult({ error: null, aliveAfter: false }), "stopped")
  // taskkill lançou erro de "não encontrado" e processo morreu -> already_gone
  assert.equal(classifyKillResult({ error: taskkillDeadPidError(), aliveAfter: false }), "already_gone")
})

test("access denied real (stderr) é access_denied, nunca signal_failed", async () => {
  const { classifyKillResult } = await imp("src/runtime/supervisor.js")
  const r = classifyKillResult({ error: taskkillAccessDenied(), aliveAfter: true })
  assert.equal(r, "access_denied")
})

test("CONTROLE NEGATIVO: processo AINDA vivo após kill -> still_alive (não é 'stopped' otimista)", async () => {
  const { classifyKillResult } = await imp("src/runtime/supervisor.js")
  // taskkill "sucesso" mas o processo ainda responde à probe -> still_alive
  assert.equal(classifyKillResult({ error: null, aliveAfter: true }), "still_alive")
})

test("signal_failed SÓ quando há erro desconhecido E o processo continua vivo", async () => {
  const { classifyKillResult } = await imp("src/runtime/supervisor.js")
  const unknown = Object.assign(new Error("weird"), { code: undefined, status: 5, stderr: "algo estranho" })
  assert.equal(classifyKillResult({ error: unknown, aliveAfter: true }), "signal_failed")
})

// --- o state só é limpo quando NADA ficou pendente E nada está vivo ---
test("CONTROLE NEGATIVO: state NÃO é limpo enquanto um pid continuar vivo", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  const r = stopOutcome([{ name: "web", status: "still_alive", pid: 1 }], [1])
  assert.equal(r.clearable, false, "pid vivo -> nunca limpar o state (o retry precisa dele)")
})

test("state É limpo quando tudo parou/já-sumiu e nada está vivo (idempotência)", async () => {
  const { stopOutcome } = await imp("src/runtime/supervisor.js")
  const r = stopOutcome([{ name: "web", status: "stopped", pid: 1 }, { name: "api", status: "already_gone", pid: 2 }], [])
  assert.equal(r.clearable, true, "tudo resolvido e nada vivo -> state pode ser limpo")
})

test("REGRESSÃO: o erro ESRCH-like de process.kill (POSIX) ainda vira already_gone", async () => {
  const { classifyKillResult } = await imp("src/runtime/supervisor.js")
  const esrch = Object.assign(new Error("ESRCH"), { code: "ESRCH" })
  assert.equal(classifyKillResult({ error: esrch, aliveAfter: false }), "already_gone")
})

test("stopService integra a probe: pid morto pós-kill -> already_gone mesmo com taskkill 'falhando'", async () => {
  const { stopAll } = await imp("src/runtime/supervisor.js")
  const state = [{ name: "web", pid: 999, port: 5173 }]
  const results = stopAll(state, {
    platform: "win32",
    exec: () => { throw taskkillDeadPidError() },  // taskkill "falha"
    isAlive: () => false,                            // mas o processo morreu
  })
  assert.equal(results[0].status, "already_gone", "a probe de liveness manda, não o taskkill")
})
