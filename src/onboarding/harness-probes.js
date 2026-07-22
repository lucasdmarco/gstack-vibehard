/**
 * PRD48 S48.1 — probe bounded de presença de harness. Complementa `detectHarnesses()`
 * (`src/harness/detector.js`, real, já usado pelo installer/doctor) distinguindo TRÊS
 * desfechos que ele hoje colapsa em booleano: comando encontrado, comando ausente e
 * PROBE COM TIMEOUT — timeout NUNCA pode virar "não instalado" silenciosamente (DoD:
 * "probe com timeout vira degraded/unknown"). Nunca edita config, nunca dispara login.
 */
import { execFileSync } from "node:child_process"

export const PROBE_STATES = Object.freeze(["detected", "not_found", "timeout", "error"])

const wasKilledOrTimedOut = (e) => Boolean(e && (e.killed === true || e.signal))
const wasNotFound = (e) => Boolean(e && e.code === "ENOENT")

function classifyProbeError(e) {
  if (wasKilledOrTimedOut(e)) return "timeout"
  if (wasNotFound(e)) return "not_found"
  return "error"
}

/** Classifica o desfecho de UM probe `--version`-like. Nunca lança. */
export function probeCommand(cmd, args = ["--version"], { timeoutMs = 3000 } = {}) {
  try {
    execFileSync(cmd, args, { stdio: "pipe", timeout: timeoutMs })
    return { state: "detected", cmd }
  } catch (e) {
    return { state: classifyProbeError(e), cmd }
  }
}
