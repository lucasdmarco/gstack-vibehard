import { spawnSync, execFileSync } from "child_process"
import { killTreeCommand } from "../runtime/supervisor.js"

/**
 * Exec de UMA etapa de gate com timeout POR ETAPA e cleanup de árvore (PRD20 Sprint
 * 20.1). Síncrono (o verify é síncrono), captura stdout/stderr resumidos e distingue
 * TIMEOUT de falha. No estouro, mata a árvore reusando `killTreeCommand` — melhor
 * esforço (POSIX mata o grupo; Windows é best-effort pós-morte do pai). O ganho
 * garantido é o timeout limitado: o release nunca mais fica mudo por 10 min.
 */

const TAIL = 800

/** Cauda resumida de um buffer (nunca o dump inteiro). */
export function summarizeOutput(buf) {
  const s = (buf == null ? "" : String(buf)).trim()
  return s.length > TAIL ? "…" + s.slice(-TAIL) : s
}

/** Mata a árvore do PID (best-effort, nunca lança). `run` injetável p/ teste. */
export function killTree(pid, opts = {}) {
  if (!pid) return false
  const platform = opts.platform || process.platform
  const run = opts.run || ((file, args) => execFileSync(file, args, { stdio: "ignore", timeout: 10000 }))
  const { file, args } = killTreeCommand(pid, platform)
  try { run(file, args); return true } catch { return false }
}

/** Foi timeout? (spawnSync sinaliza via killSignal/ETIMEDOUT). */
function isTimeout(r, killSignal) {
  return !!(r.signal === killSignal || (r.error && r.error.code === "ETIMEDOUT"))
}

/** Normaliza o retorno do spawn em { code, timedOut, stdout, stderr, durationMs, pid, signal }. */
function stepResult(r, timedOut, started) {
  return {
    code: typeof r.status === "number" ? r.status : (timedOut ? null : 1),
    timedOut,
    stdout: summarizeOutput(r.stdout),
    stderr: summarizeOutput(r.stderr),
    durationMs: Date.now() - started,
    pid: r.pid || null,
    signal: r.signal || null,
  }
}

/**
 * Roda `file args` com timeout. @returns
 * { code, timedOut, stdout, stderr, durationMs, pid, signal }.
 * `spawn`/`killer` injetáveis para teste (sem processo real).
 */
export function runStepProcess(file, args = [], opts = {}) {
  const { cwd, timeoutMs = 300000, env, platform = process.platform } = opts
  const spawn = opts.spawn || spawnSync
  const started = Date.now()
  // POSIX: detached → filho vira líder de grupo (killTreeCommand mata o grupo).
  const r = spawn(file, args, {
    cwd, env, encoding: "utf-8", timeout: timeoutMs, killSignal: "SIGKILL",
    detached: platform !== "win32", windowsHide: true,
  }) || {}
  const timedOut = isTimeout(r, "SIGKILL")
  if (timedOut && r.pid) killTree(r.pid, { platform, run: opts.killer })
  return stepResult(r, timedOut, started)
}
