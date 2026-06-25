import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "fs"
import { join } from "path"
import { allocatePort } from "./ports.js"

/**
 * Supervisor de runtime (PRD 12 PR4): consome o Runtime Manifest V2 e sobe/derruba
 * os serviços. Lógica PURA e injetável (allocatePort/exec/httpGet/sleep) — o spawn
 * real fica no comando. Spawn SEM shell (argv do manifest), port allocation sem
 * race, kill da ÁRVORE por plataforma, state em `.gstack/runtime/`.
 */

export function runtimeDir(projectDir) { return join(projectDir, ".gstack", "runtime") }
export function logsDir(projectDir) { return join(runtimeDir(projectDir), "logs") }

/** Resolve portas e constrói o plano de spawn (argv array + env com as portas). */
export async function planStart(manifest, opts = {}) {
  const baseEnv = opts.env || {}
  const allocate = opts.allocatePort || ((p) => allocatePort(p))
  const plans = []
  for (const s of manifest.services || []) {
    const env = { ...baseEnv }
    let port = null
    if (s.port) {
      port = s.port.autoAllocate ? await allocate(s.port.preferred) : s.port.preferred
      if (s.port.env) env[s.port.env] = String(port)
    }
    plans.push({
      name: s.name,
      file: s.command[0],
      args: s.command.slice(1),
      cwd: s.cwd || ".",
      env,
      port,
      readinessPath: s.health && s.health.readiness && s.health.readiness.path,
      readinessTimeout: (s.health && s.health.readiness && s.health.readiness.timeoutSeconds) || 60,
    })
  }
  return plans
}

/** Comando de KILL da ÁRVORE por plataforma (sem shell). { file, args }. */
export function killTreeCommand(pid, platform = process.platform) {
  if (platform === "win32") return { file: "taskkill", args: ["/PID", String(pid), "/T", "/F"] }
  // POSIX: o supervisor spawna `detached` → pid é líder do grupo; mata o GRUPO.
  return { file: "kill", args: ["-TERM", `-${pid}`] }
}

/**
 * Encerra todos os PIDs do state. Idempotente. `exec`/`kill`/`platform` injetáveis.
 * POSIX: caminho NATIVO `process.kill(-pid, SIGTERM)` (mata o GRUPO via syscall) —
 * NÃO usa o binário `kill`, porque o `kill` do util-linux (Linux) sai 0 sem matar
 * quando recebe `-<pid>` como grupo (só o BSD `kill` do macOS aceitava). Windows:
 * `taskkill /T /F` (árvore) via `exec`. `exec` só é injetado no Windows real.
 */
export function stopAll(state, opts = {}) {
  const exec = opts.exec
  const kill = opts.kill || ((pid, sig) => process.kill(pid, sig))
  const platform = opts.platform || process.platform
  const results = []
  for (const svc of state || []) {
    if (!svc || !svc.pid) { results.push({ name: svc && svc.name, status: "no-pid" }); continue }
    try {
      if (exec) { const { file, args } = killTreeCommand(svc.pid, platform); exec(file, args) }
      else kill(platform === "win32" ? svc.pid : -svc.pid, "SIGTERM")
      results.push({ name: svc.name, status: "stopped", pid: svc.pid })
    } catch (e) {
      results.push({ name: svc.name, status: "already-gone", pid: svc.pid, detail: e.message })
    }
  }
  return results
}

/** Poll de readiness HTTP. `httpGet(url)`→`{status}`|throw. `sleep`/`now` injetáveis. */
export async function pollReadiness(url, opts = {}) {
  const httpGet = opts.httpGet
  const timeoutMs = (opts.timeoutSeconds || 60) * 1000
  const intervalMs = opts.intervalMs || 500
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const now = opts.now || (() => Date.now())
  const start = now()
  while (now() - start < timeoutMs) {
    try {
      const res = await httpGet(url)
      if (res && res.status >= 200 && res.status < 500) return { ok: true, status: res.status }
    } catch { /* serviço ainda subindo */ }
    await sleep(intervalMs)
  }
  return { ok: false, status: null, timedOut: true }
}

/** State por serviço em `.gstack/runtime/<name>.json`. */
export function writeServiceState(projectDir, name, obj) {
  const dir = runtimeDir(projectDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(obj, null, 2) + "\n")
}
export function readAllState(projectDir) {
  const dir = runtimeDir(projectDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf-8")) } catch { return null } })
    .filter(Boolean)
}
export function clearState(projectDir) {
  try { rmSync(runtimeDir(projectDir), { recursive: true, force: true }) } catch { /* ignore */ }
}
