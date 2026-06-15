import { execFileSync as defaultExecFileSync } from "child_process"
import { join } from "path"

/**
 * Helpers puros e testaveis para resolucao de binarios de dependencias.
 * Extraidos de installDeps() para reduzir complexidade e permitir cobertura
 * sem executar instalacoes reais (exec injetavel).
 */

/**
 * Retorna o primeiro candidato cujo `--version` responde com sucesso, ou "".
 * @param {string[]} candidates caminhos/nomes de binario a testar em ordem
 * @param {object} [opts]
 * @param {Function} [opts.exec] implementacao de execFileSync (injetavel em teste)
 * @param {number} [opts.timeout]
 */
export function findWorkingBinary(candidates, opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  const timeout = opts.timeout || 5000
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      exec(candidate, ["--version"], { stdio: "pipe", timeout })
      return candidate
    } catch { /* candidato indisponivel — tenta o proximo */ }
  }
  return ""
}

/** Candidatos do binario `uv` por OS (alem do nome no PATH). */
export function getUvCandidates(home, isWin) {
  return isWin
    ? [join(home, ".local", "bin", "uv.exe"), join(home, "AppData", "Local", "uv", "uv.exe"), "uv"]
    : [join(home, ".local", "bin", "uv"), join(home, ".cargo", "bin", "uv"), "/usr/local/bin/uv", "uv"]
}

/** Candidatos do binario `bun` por OS (alem do nome no PATH). */
export function getBunCandidates(home, isWin) {
  return isWin
    ? [join(home, ".bun", "bin", "bun.exe"), "bun"]
    : [join(home, ".bun", "bin", "bun"), "bun"]
}

/** True se o binario responde a `--version`. */
export function isBinaryAvailable(bin, opts = {}) {
  return findWorkingBinary([bin], opts) !== ""
}
