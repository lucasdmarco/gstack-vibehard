import { join } from "path"
import { parse as parseToml } from "smol-toml"
import { readMcpSource, toServers } from "./shared.js"

/**
 * Leitor MCP do Codex: `~/.codex/config.toml`, tabelas `[mcp_servers.<nome>]`.
 */
export function readCodexMcp({ home }) {
  const read = readMcpSource(join(home, ".codex", "config.toml"), parseToml, (cfg) => cfg.mcp_servers)
  return { harness: "codex", sources: [read.src], servers: toServers("codex", read) }
}
readCodexMcp.harnessId = "codex"
