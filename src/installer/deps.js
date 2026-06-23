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

/**
 * Invocacao cross-platform de `npx`. No Windows, `npx` e `npx.cmd` e
 * execFileSync sem shell da ENOENT; rodamos via `cmd.exe /c npx ...` (sem
 * shell:true, evitando a deprecation de args nao-escapados do Node).
 * @returns {{ file: string, argv: string[] }}
 */
export function npxArgv(args, platform = process.platform) {
  // ComSpec = caminho ABSOLUTO do cmd.exe; não depende do PATH (que o refreshPath
  // pode ter mexido). Fallback "cmd.exe" se ComSpec não estiver setado.
  if (platform === "win32") return { file: process.env.ComSpec || "cmd.exe", argv: ["/c", "npx", ...args] }
  return { file: "npx", argv: args }
}

/**
 * Invocacao cross-platform de `npm`. Mesmo motivo do npxArgv: no Windows o binario
 * e `npm.cmd` e `execFileSync("npm", ...)` da ENOENT — rodamos via `cmd.exe /c npm`
 * usando o caminho ABSOLUTO do cmd.exe (ComSpec).
 * @returns {{ file: string, argv: string[] }}
 */
export function npmArgv(args, platform = process.platform) {
  if (platform === "win32") return { file: process.env.ComSpec || "cmd.exe", argv: ["/c", "npm", ...args] }
  return { file: "npm", argv: args }
}

/**
 * Constrói o PATH do Windows: expande `%VAR%` (o registro guarda REG_EXPAND_SZ com
 * `%SystemRoot%` etc.) e MESCLA com o PATH atual — nunca substitui, senão perde o
 * System32 (onde mora o cmd.exe) e quebra spawns subsequentes. Dedup case-insensitive.
 * Puro/testável.
 */
export function mergeWindowsPath(current, regPath, env = process.env) {
  const expand = (s) => String(s || "").replace(/%([^%]+)%/g, (m, name) => env[name] ?? env[name.toUpperCase()] ?? m)
  const parts = [...String(current || "").split(";"), ...expand(regPath).split(";")]
  const seen = new Set()
  const out = []
  for (const raw of parts) {
    const p = raw.trim()
    if (!p) continue
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.join(";")
}
