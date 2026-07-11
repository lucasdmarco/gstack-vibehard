import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { spawn, execFileSync } from "child_process"
import { createConnection } from "net"

/**
 * Headroom Proxy Lifecycle (PRD35 C1). O routing (headroom-route.js) apontava um
 * ENV para 127.0.0.1:8787, mas NINGUÉM subia o proxy nessa porta — por isso o
 * readiness ficava `callable_not_routed` para sempre. Aqui o GStack GERENCIA o
 * processo do proxy, project-scoped:
 *
 *  - sobe `headroom proxy --host 127.0.0.1 --port <p>` (LOOPBACK — nunca 0.0.0.0);
 *  - aguarda a porta aceitar conexão (readiness real, não `sleep`);
 *  - grava o PID+porta OWNED em `.gstack/headroom/proxy.json`;
 *  - `stop` encerra SÓ o PID que ELE subiu (nunca um processo foreign na porta).
 *
 * Invariantes (as mesmas do headroom-route): NUNCA `headroom wrap`, NUNCA MCP
 * global, NUNCA editar config de harness. Só o binário local do venv do projeto.
 * PURO/testável: spawn/connect/kill/clock injetáveis.
 */

export const HEADROOM_PROXY_SCHEMA = "gstack.headroom.proxy.v1"
export const DEFAULT_PROXY_HOST = "127.0.0.1"
export const DEFAULT_PROXY_PORT = 8787

const manifestPath = (cwd) => join(cwd, ".gstack", "headroom", "proxy.json")

/** Caminho do headroom.exe do venv do projeto (nunca assume global). */
export function projectHeadroomExe(cwd, platform = process.platform) {
  const rel = platform === "win32"
    ? [".gstack", "tools", "headroom-venv", "Scripts", "headroom.exe"]
    : [".gstack", "tools", "headroom-venv", "bin", "headroom"]
  return join(cwd, ...rel)
}

// Readiness REAL: a porta aceita conexão TCP? (loopback). Nunca `sleep` cego.
function tcpProbe(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port })
    const done = (ok) => { try { sock.destroy() } catch { /* noop */ } resolve(ok) }
    sock.setTimeout(timeoutMs)
    sock.once("connect", () => done(true))
    sock.once("timeout", () => done(false))
    sock.once("error", () => done(false))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Cold start do uvicorn do headroom é lento (~15-20s medido): janela ampla mas
// bounded. Sai ASSIM QUE a porta abre — nunca espera o total à toa.
const READY_ATTEMPTS = 60
const READY_INTERVAL_MS = 500

/** Aguarda a porta abrir (bounded). @returns true se ficou pronta a tempo. */
export async function waitPortReady({ host, port, probe = tcpProbe, attempts = READY_ATTEMPTS, intervalMs = READY_INTERVAL_MS } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await probe(host, port)) return true
    await sleep(intervalMs)
  }
  return false
}

// Encerra a ÁRVORE do processo (o headroom launcher spawna worker uvicorn filho —
// matar só o launcher orfanaria o worker que segura a porta). win: taskkill /T;
// posix: mata o process group (o spawn é detached → grupo liderado pelo pid).
function killTree(pid, platform = process.platform) {
  try {
    if (platform === "win32") execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" })
    else process.kill(-pid, "SIGTERM")
    return true
  } catch {
    try { process.kill(pid, "SIGTERM"); return true } catch { return false }
  }
}

const defaultIo = Object.freeze({
  exists: existsSync,
  readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } },
  write: (p, s) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s) },
  remove: (p) => { try { rmSync(p, { force: true }) } catch { /* noop */ } },
  // detached: o proxy é um DAEMON — precisa sobreviver ao processo do CLI que sai
  // logo após startProxy. stdio ignorado (loopback-only, sem inbound token).
  spawnProc: (exe, argv) => spawn(exe, argv, { detached: true, stdio: "ignore" }),
  kill: (pid) => killTree(pid),
  alive: (pid) => { try { process.kill(pid, 0); return true } catch { return false } },
})

function writeManifest(cwd, data, io) {
  const p = manifestPath(cwd)
  io.write(p, JSON.stringify({ schemaVersion: HEADROOM_PROXY_SCHEMA, ...data }, null, 2) + "\n")
  return p
}

/** Lê o manifest do proxy owned (ou null). */
export function readProxyManifest(cwd, io = defaultIo) {
  const p = manifestPath(cwd)
  return io.exists(p) ? io.readJson(p) : null
}

/**
 * Sobe o proxy Headroom project-scoped em loopback e aguarda readiness real.
 * → { started, host, port, pid, ready, manifest } | { started:false, reason }.
 * Recusa se o binário do venv não existir (honesto: não há proxy p/ subir).
 */
// Se já há um proxy owned vivo, devolve o resultado alreadyRunning (senão null).
function alreadyRunningResult(cwd, io) {
  const existing = readProxyManifest(cwd, io)
  if (existing && io.alive(existing.pid)) {
    return { started: false, alreadyRunning: true, host: existing.host, port: existing.port, pid: existing.pid, ready: true }
  }
  return null
}

// Spawna o proxy detached e devolve o pid (ou null se falhou).
function spawnProxyPid(exe, host, port, io) {
  const child = io.spawnProc(exe, ["proxy", "--host", host, "--port", String(port)])
  if (!child || !child.pid) return null
  if (typeof child.unref === "function") child.unref()
  return child.pid
}

export async function startProxy({ cwd = process.cwd(), host = DEFAULT_PROXY_HOST, port = DEFAULT_PROXY_PORT, platform, io = defaultIo, wait = waitPortReady } = {}) {
  const running = alreadyRunningResult(cwd, io)
  if (running) return running
  const exe = projectHeadroomExe(cwd, platform)
  if (!io.exists(exe)) return { started: false, reason: `headroom não instalado no venv do projeto (${exe})` }

  const pid = spawnProxyPid(exe, host, port, io)
  if (!pid) return { started: false, reason: "falha ao iniciar o processo do proxy" }

  const ready = await wait({ host, port })
  const manifest = writeManifest(cwd, { host, port, pid, startedAt: new Date().toISOString(), ready }, io)
  const base = { started: true, ready, host, port, pid, manifest }
  return ready ? base : { ...base, reason: "proxy iniciou mas a porta não respondeu no tempo — verifique o headroom" }
}

/**
 * Encerra SÓ o proxy owned (o PID gravado no manifest). NUNCA mata processo
 * foreign na porta — se o PID do manifest não está vivo, apenas limpa o manifest.
 */
export function stopProxy({ cwd = process.cwd(), io = defaultIo } = {}) {
  const m = readProxyManifest(cwd, io)
  if (!m) return { stopped: false, reason: "nenhum proxy owned (sem manifest)" }
  const wasAlive = io.alive(m.pid)
  const killed = wasAlive ? io.kill(m.pid) : false
  io.remove(manifestPath(cwd))
  return { stopped: killed, pid: m.pid, wasAlive, manifestRemoved: true }
}

/** Estado do proxy owned: running (PID vivo) / stale (manifest sem PID vivo) / none. */
export async function proxyStatus({ cwd = process.cwd(), io = defaultIo, probe = tcpProbe } = {}) {
  const m = readProxyManifest(cwd, io)
  if (!m) return { state: "none", schemaVersion: HEADROOM_PROXY_SCHEMA }
  const alive = io.alive(m.pid)
  const portOpen = alive ? await probe(m.host, m.port) : false
  return {
    schemaVersion: HEADROOM_PROXY_SCHEMA,
    state: alive ? (portOpen ? "running" : "starting_or_stuck") : "stale",
    host: m.host, port: m.port, pid: m.pid, alive, portOpen, startedAt: m.startedAt,
  }
}
