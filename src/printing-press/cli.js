import { execFileSync as defaultExecFileSync } from "child_process"
import { npxArgv } from "../installer/deps.js"

/**
 * Wrapper seguro para o catalogo Printing Press (@mvanhorn/printing-press-library).
 *
 * - versao PINADA (reprodutibilidade + sem surpresa de supply-chain)
 * - args em ARRAY com shell:false (sem injecao de shell)
 * - exec injetavel para testes hermes (sem rede)
 * - degradacao graciosa: erro/sem-rede nunca lanca para o chamador decidir
 */

export const PP_PKG = "@mvanhorn/printing-press-library@0.1.16"

// search <query> validado por allowlist — nada de $(), backtick, ;, etc.
const SAFE_QUERY = /^[a-zA-Z0-9 ._-]+$/

export class PrintingPressError extends Error {}

/**
 * Executa um subcomando do printing-press-library.
 * @param {string[]} args ex.: ["search", "stripe", "--json"]
 * @param {object} [opts]
 * @param {Function} [opts.exec] execFileSync injetavel
 * @param {number} [opts.timeout] ms (default 60000)
 * @returns {{ ok: boolean, stdout: string, error?: string }}
 */
export function runPrintingPress(args, opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  const timeout = opts.timeout || 60000
  // Cross-platform via helper compartilhado (cmd.exe /c npx no Windows).
  const { file, argv } = npxArgv(["-y", PP_PKG, ...args], opts.platform)
  try {
    const out = exec(file, argv, {
      stdio: "pipe", timeout, shell: false, encoding: "utf-8",
    })
    return { ok: true, stdout: (out || "").toString() }
  } catch (e) {
    return { ok: false, stdout: "", error: e.message || String(e) }
  }
}

/** Lista o catalogo (--json). Retorna array (vazio se indisponivel). */
export function ppList(opts = {}) {
  const args = ["list", "--json"]
  if (opts.category) {
    if (!SAFE_QUERY.test(opts.category)) throw new PrintingPressError("categoria invalida")
    args.push("--category", opts.category)
  }
  const res = runPrintingPress(args, opts)
  return parseJsonArray(res)
}

/** Busca no catalogo (--json). Retorna array (vazio se indisponivel). */
export function ppSearch(query, opts = {}) {
  if (!query || !SAFE_QUERY.test(query)) {
    throw new PrintingPressError("query invalida (use letras, numeros, espaco, . _ -)")
  }
  const res = runPrintingPress(["search", query, "--json"], opts)
  return parseJsonArray(res)
}

function parseJsonArray(res) {
  if (!res.ok || !res.stdout.trim()) {
    return { available: false, items: [], error: res.error || "sem saida" }
  }
  try {
    const data = JSON.parse(res.stdout)
    const items = Array.isArray(data) ? data : (data.items || data.results || data.tools || [])
    return { available: true, items }
  } catch {
    return { available: false, items: [], error: "saida nao e JSON valido" }
  }
}
