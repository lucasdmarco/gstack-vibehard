import { existsSync, readFileSync } from "fs"

/**
 * Lê UMA fonte de config MCP de forma tolerante (contrato dos leitores):
 * ausente → `exists:false`; parse falhou → `valid:false` + erro resumido.
 * Nunca lança — inventário é read-only e não pode quebrar por config alheia.
 *
 * @param {string} file caminho da config
 * @param {(text: string) => object} parse parser do formato (JSON/TOML/JSONC)
 * @param {(cfg: object) => object} extract extrai o mapa nome→server do cfg
 * @returns {{ src: {path, exists, valid, error?}, entries: object }}
 */
export function readMcpSource(file, parse, extract) {
  const src = { path: file, exists: existsSync(file), valid: true }
  if (!src.exists) return { src, entries: {} }
  try {
    return { src, entries: extract(parse(readFileSync(file, "utf-8")) || {}) || {} }
  } catch (e) {
    src.valid = false
    src.error = String(e.message || e).slice(0, 160)
    return { src, entries: {} }
  }
}

/** Converte o resultado de readMcpSource em servers crus (shape do inventário). */
export function toServers(harness, { src, entries }) {
  return Object.entries(entries).map(([name, raw]) => ({ name, harness, source: src.path, raw }))
}
