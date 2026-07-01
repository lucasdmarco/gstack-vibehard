import { join } from "path"
import { stripBom } from "../../util/json.js"
import { readMcpSource, toServers } from "./shared.js"

/**
 * Remove comentários `//` e `/* *\/` de JSONC de forma tolerante, preservando
 * conteúdo dentro de strings. Suficiente para INVENTÁRIO read-only (nunca é
 * usado para reescrever a config do usuário — política opencode-config.js).
 * State machine — complexidade inerente ao parser, coberta por teste dedicado.
 */
// fallow-ignore-next-line complexity
export function stripJsonComments(text) {
  let out = ""
  let inStr = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inLine) { if (c === "\n") { inLine = false; out += c } continue }
    if (inBlock) { if (c === "*" && next === "/") { inBlock = false; i++ } continue }
    if (inStr) { out += c; if (c === "\\") { out += next ?? ""; i++ } else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === "/" && next === "/") { inLine = true; i++; continue }
    if (c === "/" && next === "*") { inBlock = true; i++; continue }
    out += c
  }
  return out
}

const parseJsonc = (t) => JSON.parse(stripJsonComments(stripBom(t)))
const mcpEntries = (cfg) => ({ ...(cfg.mcp || {}), ...(cfg.mcpServers || {}) })

/**
 * Leitor MCP do OpenCode: `~/.config/opencode/opencode.json` e/ou `.jsonc`
 * (chave `mcp` no schema oficial; `mcpServers` aceito como fallback).
 */
export function readOpenCodeMcp({ home }) {
  const dir = join(home, ".config", "opencode")
  const reads = [join(dir, "opencode.json"), join(dir, "opencode.jsonc")]
    .map((f) => readMcpSource(f, parseJsonc, mcpEntries))
  return {
    harness: "opencode",
    sources: reads.map((r) => r.src),
    servers: reads.flatMap((r) => toServers("opencode", r)),
  }
}
readOpenCodeMcp.harnessId = "opencode"
