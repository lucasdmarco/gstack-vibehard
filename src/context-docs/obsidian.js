import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"

/**
 * Obsidian como fonte do Document Graph — OPT-IN e READ-ONLY.
 *
 * Apenas registra/lê o caminho de uma pasta Obsidian em .gstack/context.json.
 * NÃO abre o app, NÃO cria cofre, NÃO escreve no cofre. A indexação (read-only)
 * só ocorre se este caminho estiver configurado explicitamente pelo usuário.
 */

function contextPath(cwd) {
  return join(cwd, ".gstack", "context.json")
}

function readContext(cwd) {
  const p = contextPath(cwd)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null }
}

/** Grava obsidian.path no context.json (opt-in). */
export function setObsidianPath(cwd, folder) {
  const p = contextPath(cwd)
  mkdirSync(dirname(p), { recursive: true })
  const reg = readContext(cwd) || { schemaVersion: 1, sources: {}, sessionStart: { injectMode: "summary-only" } }
  reg.obsidian = { path: folder }
  writeFileSync(p, JSON.stringify(reg, null, 2) + "\n")
  return reg.obsidian
}

/** Lê o caminho Obsidian configurado (ou null). */
export function getObsidianPath(cwd) {
  const reg = readContext(cwd)
  return reg?.obsidian?.path || null
}
