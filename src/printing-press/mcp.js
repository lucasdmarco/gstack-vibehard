import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

/**
 * MCP opt-in, PROJECT-SCOPED. Registra o MCP companion de uma ferramenta
 * Printing Press no `.mcp.json` do PROJETO (nao na config global do usuario).
 *
 * - servidores nomeados `pp-<tool>` para nunca colidir com servidores do usuario
 * - merge NAO-DESTRUTIVO: usuario vence se ja customizou aquele nome
 * - disable remove apenas o `pp-<tool>` criado pelo gstack
 */

const SAFE_TOOL = /^[a-zA-Z0-9._-]+$/

function mcpPath(projectDir) {
  return join(projectDir, ".mcp.json")
}

function readMcp(projectDir) {
  const p = mcpPath(projectDir)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, "utf-8")) || {}
  } catch {
    return {}
  }
}

function writeMcp(projectDir, cfg) {
  writeFileSync(mcpPath(projectDir), JSON.stringify(cfg, null, 2) + "\n")
}

function ppServerName(tool) {
  return `pp-${tool}`
}

/** Comando padrao do MCP companion gerado pelo Printing Press. */
function defaultPpMcp(tool) {
  return { command: `${tool}-pp-mcp`, args: [] }
}

export function enableMcp(projectDir, tool) {
  if (!tool || !SAFE_TOOL.test(tool)) return { status: "invalid_tool" }
  const cfg = readMcp(projectDir)
  cfg.mcpServers = cfg.mcpServers || {}
  const name = ppServerName(tool)
  // Usuario vence: se ja existe um servidor com esse nome, nao sobrescreve.
  if (name in cfg.mcpServers) {
    return { status: "exists", name }
  }
  cfg.mcpServers[name] = defaultPpMcp(tool)
  writeMcp(projectDir, cfg)
  return { status: "enabled", name }
}

export function disableMcp(projectDir, tool) {
  if (!tool || !SAFE_TOOL.test(tool)) return { status: "invalid_tool" }
  const cfg = readMcp(projectDir)
  const name = ppServerName(tool)
  if (!cfg.mcpServers || !(name in cfg.mcpServers)) {
    return { status: "not_found", name }
  }
  delete cfg.mcpServers[name]
  writeMcp(projectDir, cfg)
  return { status: "disabled", name }
}

export function listMcp(projectDir) {
  const cfg = readMcp(projectDir)
  return Object.keys(cfg.mcpServers || {}).filter((n) => n.startsWith("pp-"))
}
