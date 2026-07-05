import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

/**
 * MCP Scope & Runtime-Injected Pattern (PRD24 Sprint 24.5). Adapta a ideia de "MCP sob
 * demanda" do oh-my-openagent SEM MCP global: um MCP/tool project-scoped é registrado
 * SOMENTE no run context do GStack (`.gstack/mcp/runtime.json`) — nunca em `~/.mcp.json`
 * nem em config global de harness. O `tool-readiness`/doctor então distinguem
 * `runtime_injected` × `project_local` × `global`.
 *
 * Invariantes (§9/§10):
 *  - NUNCA escreve fora do projeto (só `.gstack/mcp/runtime.json`).
 *  - Deny-default: servidor/tool destrutivo exige allow explícito.
 *  - Runtime-injected NÃO aparece em `opencode mcp list` (é do run context, não da config).
 */

export const RUNTIME_MANIFEST = join(".gstack", "mcp", "runtime.json")
export const RUNTIME_SCHEMA = "gstack.mcp.runtime.v1"

// Deny-default: nomes que sugerem ação destrutiva exigem allowDestructive.
const DESTRUCTIVE = /(^|[-_])(rm|delete|del|drop|destroy|wipe|format|shutdown|kill|exec|shell|sudo)([-_]|$)/i
export function isDestructive(name) {
  return DESTRUCTIVE.test(String(name || ""))
}

const norm = (p) => String(p || "").replace(/\\/g, "/")

/** Escopo de um server pela fonte (path): runtime_injected | project_local | global | unknown. */
export function classifyScope(source, opts = {}) {
  const s = norm(source)
  if (!s) return "unknown"
  if (s.endsWith(".gstack/mcp/runtime.json")) return "runtime_injected"
  if (s.startsWith(norm(opts.cwd || process.cwd()))) return "project_local"
  return "global" // qualquer fonte fora do projeto (home/global config) = global
}

function readRuntime(cwd) {
  const file = join(cwd, RUNTIME_MANIFEST)
  if (!existsSync(file)) return { schemaVersion: RUNTIME_SCHEMA, servers: {} }
  try { return JSON.parse(readFileSync(file, "utf-8")) } catch { return { schemaVersion: RUNTIME_SCHEMA, servers: {} } }
}

/**
 * Registra um MCP runtime-injected PROJECT-SCOPED. Recusa destrutivo por padrão e
 * NUNCA escreve global. `write:false` = dry-run.
 */
export function registerRuntimeMcp(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const name = opts.name
  if (!name) return { registered: false, refused: true, reason: "nome do server é obrigatório" }
  if (isDestructive(name) && opts.allowDestructive !== true) {
    return { registered: false, refused: true, reason: `server destrutivo '${name}' negado por padrão (use --allow-destructive)` }
  }
  const file = join(cwd, RUNTIME_MANIFEST)
  if (opts.write === false) return { registered: false, dryRun: true, name, file }
  const manifest = readRuntime(cwd)
  manifest.schemaVersion = RUNTIME_SCHEMA
  manifest.servers = { ...manifest.servers, [name]: { ...(opts.server || {}), scope: "runtime_injected" } }
  mkdirSync(join(cwd, ".gstack", "mcp"), { recursive: true })
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
  return {
    registered: true, name, file, scope: "runtime_injected",
    note: "MCP runtime-injected PROJECT-SCOPED; NÃO escreve em ~/.mcp.json nem config global; não aparece em `opencode mcp list`.",
  }
}

/** Remove um MCP runtime-injected do run context (reversível). */
export function unregisterRuntimeMcp(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const file = join(cwd, RUNTIME_MANIFEST)
  if (!existsSync(file)) return { unregistered: false, reason: "nenhum MCP runtime project-scoped ativo" }
  const manifest = readRuntime(cwd)
  if (!manifest.servers || !manifest.servers[opts.name]) return { unregistered: false, reason: `server '${opts.name}' não registrado` }
  delete manifest.servers[opts.name]
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
  return { unregistered: true, name: opts.name }
}

/** Leitor compatível com o MCP Inventory: expõe os servers do run context. */
export function readRuntimeMcp({ cwd }) {
  const file = join(cwd, RUNTIME_MANIFEST)
  const exists = existsSync(file)
  const manifest = exists ? readRuntime(cwd) : { servers: {} }
  const servers = Object.entries(manifest.servers || {}).map(([name, raw]) => ({ name, harness: "gstack-runtime", source: file, raw }))
  return { harness: "gstack-runtime", sources: [{ path: file, exists, valid: true }], servers }
}
readRuntimeMcp.harnessId = "gstack-runtime"

/** Sumário por escopo (para readiness/doctor). */
export function summarizeScopes(servers, opts = {}) {
  const byScope = { global: 0, project_local: 0, runtime_injected: 0, unknown: 0 }
  for (const s of servers || []) byScope[classifyScope(s.source, opts)] += 1
  return { byScope, total: (servers || []).length, hasRuntimeInjected: byScope.runtime_injected > 0 }
}
