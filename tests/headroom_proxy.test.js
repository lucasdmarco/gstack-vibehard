import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD35 C1 — lifecycle do proxy Headroom project-scoped: sobe em loopback, aguarda
// readiness REAL, grava PID owned, encerra SÓ o owned (nunca foreign na porta).

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// io fake: controla spawn/alive/kill/probe. Cria o exe do venv por padrão.
function fakeIo({ pid = 4321, alivePids = new Set([4321]), exeExists = true } = {}) {
  const files = new Map()
  const killed = []
  return {
    io: {
      exists: (p) => (p.includes("headroom-venv") ? exeExists : files.has(p)),
      readJson: (p) => (files.has(p) ? JSON.parse(files.get(p)) : null),
      write: (p, s) => files.set(p, s),
      remove: (p) => files.delete(p),
      spawnProc: () => ({ pid, unref() {} }),
      kill: (target) => { killed.push(target); alivePids.delete(target); return true },
      alive: (target) => alivePids.has(target),
    },
    killed, files, alivePids,
  }
}
const readyWait = async () => true
const notReadyWait = async () => false

test("startProxy: sobe em loopback, aguarda readiness e grava manifest OWNED", async () => {
  const { startProxy, readProxyManifest } = await imp("src/tools/headroom-proxy.js")
  const { io } = fakeIo({ pid: 999, alivePids: new Set([999]) })
  const cwd = "/proj"
  const r = await startProxy({ cwd, io, wait: readyWait, platform: "linux" })
  assert.equal(r.started, true)
  assert.equal(r.ready, true)
  assert.equal(r.host, "127.0.0.1", "SEMPRE loopback")
  assert.equal(r.pid, 999)
  const m = readProxyManifest(cwd, io)
  assert.equal(m.schemaVersion, "gstack.headroom.proxy.v1")
  assert.equal(m.pid, 999)
})

test("startProxy: sem venv do projeto → recusa honesta (não há proxy p/ subir)", async () => {
  const { startProxy } = await imp("src/tools/headroom-proxy.js")
  const { io } = fakeIo({ exeExists: false })
  const r = await startProxy({ cwd: "/proj", io, wait: readyWait, platform: "linux" })
  assert.equal(r.started, false)
  assert.match(r.reason, /não instalado/)
})

test("startProxy: proxy iniciou mas porta não respondeu → started:true, ready:false (honesto)", async () => {
  const { startProxy } = await imp("src/tools/headroom-proxy.js")
  const { io } = fakeIo({ pid: 111, alivePids: new Set([111]) })
  const r = await startProxy({ cwd: "/proj", io, wait: notReadyWait, platform: "linux" })
  assert.equal(r.started, true)
  assert.equal(r.ready, false)
  assert.match(r.reason, /porta não respondeu/)
})

test("startProxy: já rodando (PID vivo) → não sobe outro, reporta alreadyRunning", async () => {
  const { startProxy } = await imp("src/tools/headroom-proxy.js")
  const { io } = fakeIo({ pid: 777, alivePids: new Set([777]) })
  const cwd = "/proj"
  await startProxy({ cwd, io, wait: readyWait, platform: "linux" }) // sobe uma vez
  let spawned = 0
  const io2 = { ...io, spawnProc: () => { spawned++; return { pid: 888, unref() {} } } }
  const r = await startProxy({ cwd, io: io2, wait: readyWait, platform: "linux" })
  assert.equal(r.alreadyRunning, true)
  assert.equal(spawned, 0, "não sobe um segundo proxy")
})

test("stopProxy: encerra SÓ o PID owned; sem manifest → não faz nada", async () => {
  const { startProxy, stopProxy } = await imp("src/tools/headroom-proxy.js")
  const state = fakeIo({ pid: 555, alivePids: new Set([555]) })
  const cwd = "/proj"
  await startProxy({ cwd, io: state.io, wait: readyWait, platform: "linux" })
  const r = stopProxy({ cwd, io: state.io })
  assert.equal(r.stopped, true)
  assert.deepEqual(state.killed, [555], "matou exatamente o PID owned")
  // segunda chamada: manifest já removido
  const again = stopProxy({ cwd, io: state.io })
  assert.equal(again.stopped, false)
  assert.match(again.reason, /nenhum proxy owned/)
})

test("stopProxy: NUNCA mata processo foreign — PID do manifest morto → só limpa, sem kill", async () => {
  const { startProxy, stopProxy } = await imp("src/tools/headroom-proxy.js")
  // sobe com pid 42, depois o processo "morre" (sai do alivePids) e um foreign reusa a porta
  const state = fakeIo({ pid: 42, alivePids: new Set([42]) })
  const cwd = "/proj"
  await startProxy({ cwd, io: state.io, wait: readyWait, platform: "linux" })
  state.alivePids.delete(42) // o proxy owned morreu
  const r = stopProxy({ cwd, io: state.io })
  assert.equal(r.wasAlive, false)
  assert.deepEqual(state.killed, [], "não mata NENHUM PID quando o owned já morreu (foreign fica intacto)")
  assert.equal(r.manifestRemoved, true)
})

test("proxyStatus: running (PID vivo + porta aberta) / stale (PID morto) / none", async () => {
  const { startProxy, proxyStatus } = await imp("src/tools/headroom-proxy.js")
  const state = fakeIo({ pid: 321, alivePids: new Set([321]) })
  const cwd = "/proj"
  assert.equal((await proxyStatus({ cwd, io: state.io, probe: async () => true })).state, "none")
  await startProxy({ cwd, io: state.io, wait: readyWait, platform: "linux" })
  assert.equal((await proxyStatus({ cwd, io: state.io, probe: async () => true })).state, "running")
  state.alivePids.delete(321)
  assert.equal((await proxyStatus({ cwd, io: state.io, probe: async () => true })).state, "stale")
})

test("waitPortReady: retorna true assim que o probe abre; false se nunca abre (bounded)", async () => {
  const { waitPortReady } = await imp("src/tools/headroom-proxy.js")
  let calls = 0
  const opening = async () => (++calls >= 3)
  assert.equal(await waitPortReady({ host: "127.0.0.1", port: 8787, probe: opening, attempts: 5, intervalMs: 1 }), true)
  assert.equal(await waitPortReady({ host: "127.0.0.1", port: 8787, probe: async () => false, attempts: 3, intervalMs: 1 }), false)
})

test("CLI tools headroom start --json: sem venv → started:false honesto (dir temp real)", async () => {
  const { toolsCommand } = await imp("src/commands/tools.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-hproxy-"))
  const prevExit = process.exitCode
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await toolsCommand(["headroom", "start", "--json"], { cwd }) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.started, false, "dir sem venv não sobe proxy")
  process.exitCode = prevExit
  await rm(cwd, { recursive: true, force: true })
})
