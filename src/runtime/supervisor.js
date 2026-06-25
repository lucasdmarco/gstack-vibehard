import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "fs"
import { join, resolve, relative, isAbsolute } from "path"
import { allocatePort } from "./ports.js"

/**
 * Supervisor de runtime (PRD 12 PR4): consome o Runtime Manifest V2 e sobe/derruba
 * os serviços. Lógica PURA e injetável (allocatePort/exec/kill/httpGet/sleep) — o
 * spawn real fica no comando. Spawn SEM shell (argv do manifest), port allocation
 * sem race, kill da ÁRVORE por plataforma, state em `.gstack/runtime/`.
 *
 * Endurecimento (v3.7.2): env por ALLOWLIST (nunca process.env inteiro), state file
 * por WHITELIST de campos (nunca env/segredo em disco), nome de serviço validado +
 * caminho contido no runtime dir (anti path-traversal), readiness só 2xx/3xx, e
 * validação de DONO do PID no stop (anti pid-reuse/state adulterado).
 */

export function runtimeDir(projectDir) { return join(projectDir, ".gstack", "runtime") }
export function logsDir(projectDir) { return join(runtimeDir(projectDir), "logs") }

/** Nome de serviço seguro: sem separador de path, sem `..`. Vira nome de arquivo. */
export function isValidServiceName(name) {
  return typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name) && !name.includes("..")
}

/** Garante que `target` está DENTRO de `baseDir` (anti path-traversal). Lança se não. */
export function assertWithin(baseDir, target) {
  const rel = relative(resolve(baseDir), resolve(target))
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`caminho fora do runtime dir: ${target}`)
  }
  return target
}

// Vars de ambiente OS-essenciais para um processo RODAR (node/pnpm). Tudo que NÃO
// está aqui (e não é segredo declarado em secretRefs) NUNCA chega ao serviço.
const SAFE_ENV_KEYS = Object.freeze([
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR",
  "ComSpec", "COMSPEC", "TEMP", "TMP", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL", "LC_CTYPE",
  "TZ", "NODE_PATH", "USER", "USERNAME", "LOGNAME", "SHELL",
])

/** Base de env SEGURA: só as chaves OS-essenciais presentes na fonte. */
export function safeBaseEnv(source = {}) {
  const out = {}
  for (const k of SAFE_ENV_KEYS) if (source[k] != null) out[k] = String(source[k])
  return out
}

/** Whitelist de campos do state file — env/segredo NUNCA são gravados em disco. */
const STATE_KEYS = Object.freeze(["name", "pid", "ppid", "port", "status", "url", "log", "startedAt", "command", "detail"])
export function pickState(obj = {}) {
  const out = {}
  for (const k of STATE_KEYS) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

/**
 * Resolve portas e constrói o plano de spawn (argv array + env SEGURO). O env do
 * processo = base OS-essencial + porta alocada + APENAS os segredos declarados em
 * `secretRefs` (lidos de `opts.envSource`). Nunca o process.env inteiro.
 */
export async function planStart(manifest, opts = {}) {
  const source = opts.envSource || opts.env || {}
  const allocate = opts.allocatePort || ((p) => allocatePort(p))
  const plans = []
  for (const s of manifest.services || []) {
    const env = safeBaseEnv(source)
    let port = null
    if (s.port) {
      port = s.port.autoAllocate ? await allocate(s.port.preferred) : s.port.preferred
      if (s.port.env) env[s.port.env] = String(port)
    }
    // só os segredos DECLARADOS chegam ao processo (allowlist explícita)
    for (const ref of s.secretRefs || []) {
      if (Object.prototype.hasOwnProperty.call(source, ref) && source[ref] != null) env[ref] = String(source[ref])
    }
    plans.push({
      name: s.name,
      file: s.command[0],
      args: s.command.slice(1),
      cwd: s.cwd || ".",
      env,
      port,
      command: [s.command[0], ...s.command.slice(1)].join(" "),
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

/** PID está vivo? (signal 0 não mata, só checa existência). */
export function isAlive(pid, opts = {}) {
  if (!pid) return false
  const kill = opts.kill || ((p, s) => process.kill(p, s))
  try { kill(pid, 0); return true } catch (e) { return e && e.code === "EPERM" }
}

/**
 * O processo do PID ainda é o NOSSO? Compara a idade real do processo (segundos,
 * tz-free) com a idade esperada pelo `startedAt` registrado. PID reusado seria bem
 * mais novo → diverge → não é nosso. Sem baseline ou sem leitura → procede (honesto).
 */
export function isProcessOurs(svc, liveAgeSec, nowMs = Date.now(), tolSec = 10) {
  if (!svc || !svc.startedAt) return true
  if (liveAgeSec == null) return true
  const recorded = Date.parse(svc.startedAt)
  if (Number.isNaN(recorded)) return true
  const expectedAgeSec = (nowMs - recorded) / 1000
  return Math.abs(liveAgeSec - expectedAgeSec) <= tolSec
}

/**
 * Encerra todos os PIDs do state. Idempotente. `exec`/`kill`/`getAgeSec`/`platform`
 * injetáveis. POSIX: caminho NATIVO `process.kill(-pid, SIGTERM)` (mata o GRUPO via
 * syscall) — NÃO usa o binário `kill` (o `kill` do util-linux sai 0 sem matar com
 * `-<pid>`). Windows: `taskkill /T /F` via `exec`. Antes de matar, valida o DONO do
 * PID (se `getAgeSec` fornecido): pid reusado/foreign é PULADO, não morto.
 */
export function stopAll(state, opts = {}) {
  const exec = opts.exec
  const kill = opts.kill || ((pid, sig) => process.kill(pid, sig))
  const getAgeSec = opts.getAgeSec
  const platform = opts.platform || process.platform
  const results = []
  for (const svc of state || []) {
    if (!svc || !svc.pid) { results.push({ name: svc && svc.name, status: "no-pid" }); continue }
    if (getAgeSec && !isProcessOurs(svc, getAgeSec(svc.pid))) {
      results.push({ name: svc.name, status: "skipped-foreign", pid: svc.pid })
      continue
    }
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

/** Poll de readiness HTTP. `httpGet(url)`→`{status}`|throw. 2xx/3xx = pronto. */
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
      // só 2xx/3xx = saudável. 4xx/5xx = NÃO pronto (404 na rota de health não é "de pé").
      if (res && res.status >= 200 && res.status < 400) return { ok: true, status: res.status }
    } catch { /* serviço ainda subindo */ }
    await sleep(intervalMs)
  }
  return { ok: false, status: null, timedOut: true }
}

/** State por serviço em `.gstack/runtime/<name>.json`. Nome validado + path contido + WHITELIST. */
export function writeServiceState(projectDir, name, obj) {
  if (!isValidServiceName(name)) throw new Error(`nome de serviço inválido (anti path-traversal): ${name}`)
  const dir = runtimeDir(projectDir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.json`)
  assertWithin(dir, file)
  writeFileSync(file, JSON.stringify(pickState(obj), null, 2) + "\n")
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
