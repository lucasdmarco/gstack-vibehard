import { join } from "path"
import { stripBom } from "../../util/json.js"
import { readMcpSource, toServers } from "./shared.js"

/**
 * Leitor MCP do PROJETO atual: `<cwd>/.mcp.json` (`mcpServers`) — inclui os
 * pp-* registrados por `tools mcp enable`.
 */
export function readProjectMcp({ cwd }) {
  const read = readMcpSource(join(cwd, ".mcp.json"), (t) => JSON.parse(stripBom(t)), (cfg) => cfg.mcpServers)
  return { harness: "project", sources: [read.src], servers: toServers("project", read) }
}
readProjectMcp.harnessId = "project"
