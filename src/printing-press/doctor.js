import { execFileSync as defaultExecFileSync } from "child_process"

/**
 * QG determinístico para ferramentas Printing Press instaladas.
 *
 * Probe PROGRESSIVO baseado em capacidades: nem todo CLI tem `auth doctor` ou
 * `--json`. `--version` e o unico requerido; o resto e best-effort com fallback.
 *  - status "error" só se o binario nao responde a --version (ausente)
 *  - status "warning" p/ auth faltando ou MCP nao habilitado
 *  - status "ok" quando binario+version e (auth ok ou nao aplicavel)
 */

function probe(bin, args, exec, timeout = 8000) {
  try {
    exec(bin, args, { stdio: "pipe", timeout, encoding: "utf-8" })
    return true
  } catch {
    return false
  }
}

/**
 * @param {object} tool entrada do registry { name, cli, ... }
 * @param {object} [opts] { exec, mcpEnabled }
 */
export function doctorTool(tool, opts = {}) {
  const exec = opts.exec || defaultExecFileSync
  const bin = tool.cli || tool.name
  const result = {
    tool: tool.name,
    binary: false,
    version: false,
    help: false,
    auth: "unknown",
    mcp: opts.mcpEnabled ? "enabled" : "not_enabled",
    provenance: Boolean(tool.provenance),
    status: "error",
  }

  result.binary = probe(bin, ["--version"], exec)
  result.version = result.binary
  if (!result.binary) {
    result.status = "error" // binario ausente
    return result
  }

  result.help = probe(bin, ["--help"], exec)

  // auth doctor e opcional — ausencia nao e erro
  if (probe(bin, ["auth", "doctor"], exec)) {
    result.auth = "ok"
  } else {
    // pode nao existir o subcomando OU faltar credencial — tratamos como warning
    result.auth = "missing_or_unsupported"
  }

  const warn = result.auth !== "ok" || result.mcp !== "enabled"
  result.status = warn ? "warning" : "ok"
  return result
}

/** Roda o doctor para todas as ferramentas instaladas no registry. */
export function doctorAll(registry, opts = {}) {
  const installed = registry?.printingPress?.installed || []
  const mcpServers = registry?.printingPress?.mcp || []
  return installed.map((t) =>
    doctorTool(t, { ...opts, mcpEnabled: mcpServers.includes(`pp-${t.name}`) }),
  )
}
