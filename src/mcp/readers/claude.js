import { join } from "path"
import { stripBom } from "../../util/json.js"
import { readMcpSource, toServers } from "./shared.js"

const parseJson = (t) => JSON.parse(stripBom(t))
const mcpServers = (cfg) => cfg.mcpServers

/**
 * Leitor MCP do Claude Code: `~/.mcp.json` E `~/.claude.json` (o Claude lê os
 * servidores globais do top-level `mcpServers` de `~/.claude.json`; o gstack
 * também escreve `~/.mcp.json` — as duas fontes contam para duplicidade).
 */
export function readClaudeMcp({ home }) {
  const reads = [join(home, ".mcp.json"), join(home, ".claude.json")]
    .map((f) => readMcpSource(f, parseJson, mcpServers))
  return {
    harness: "claude",
    sources: reads.map((r) => r.src),
    servers: reads.flatMap((r) => toServers("claude", r)),
  }
}
readClaudeMcp.harnessId = "claude"
