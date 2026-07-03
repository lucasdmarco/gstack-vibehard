import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync } from "child_process"

/**
 * Ruflo (PRD16 conservador, PRD18 Sprint 7): adapter OPCIONAL, nunca plataforma
 * instalada por default. Ruflo é EXECUTOR, não fonte de verdade. `full init` NUNCA
 * é chamado automaticamente — o modo suportado é plugin-lite, project-scoped, e o
 * usuário escolhe canais. MCP com DEFAULT-DENY: só recursos explicitamente seguros.
 */

export const RUFLO = Object.freeze({
  id: "ruflo",
  label: "Ruflo",
  role: "executor",
  enforcement: "candidate_adapter",
  pluginLite: true,
  fullInitRecommended: false,
  autoInstall: false,
  notes: Object.freeze([
    "Ruflo é EXECUTOR — o GStack continua fonte de verdade de agents/policy.",
    "full init não é recomendado nem automático; use plugin-lite project-scoped.",
    "MCP default-deny: tools perigosas (terminal/system/spawn/…) negadas por padrão.",
  ]),
})

// Tools MCP negadas por DEFAULT (perigosas). Nunca liberadas sem opt-in explícito.
export const RUFLO_MCP_DENY = Object.freeze([
  "terminal", "system", "agent_spawn", "swarm_init",
  "workflow_delete", "autopilot", "memory_store", "federation",
])
// Allowlist EXPLÍCITA de recursos seguros (read-only/inócuos).
export const RUFLO_MCP_ALLOW = Object.freeze([
  "status", "health", "list_agents", "list_workflows", "read_docs", "describe",
])

// Canais/plugins do wizard (plugin-lite). Só `core` é default; o resto é opt-in.
export const RUFLO_CHANNELS = Object.freeze([
  Object.freeze({ id: "core", label: "Core (status/list, read-only)", safe: true, default: true }),
  Object.freeze({ id: "workflows", label: "Workflows (read/describe)", safe: true, default: false }),
  Object.freeze({ id: "agents", label: "Agents executor", safe: false, default: false }),
  Object.freeze({ id: "federation", label: "Federation (rede/multi-node)", safe: false, default: false }),
])

/** Detecção READ-ONLY (config/binário). Fail-open — ausência nunca quebra o GStack. */
export function detectRuflo() {
  if (existsSync(join(homedir(), ".ruflo"))) return true
  try { execFileSync("ruflo", ["--version"], { stdio: "pipe", timeout: 3000 }); return true } catch { return false }
}

/**
 * Decisão MCP: deny explícito > allow explícito > DEFAULT-DENY. Substring de tool
 * perigosa também nega (ex.: `system_exec` contém `system`).
 */
export function rufloMcpDecision(tool) {
  const name = String(tool || "").toLowerCase()
  if (RUFLO_MCP_DENY.some((d) => name === d || name.includes(d))) return { decision: "deny", reason: "tool perigosa negada por default" }
  if (RUFLO_MCP_ALLOW.includes(name)) return { decision: "allow", reason: "recurso seguro (allowlist explícita)" }
  return { decision: "deny", reason: "default-deny: fora da allowlist explícita" }
}

/** Canais que o wizard marcaria por default (apenas os safe+default). */
export function defaultRufloChannels() {
  return RUFLO_CHANNELS.filter((c) => c.default).map((c) => c.id)
}

/** Relatório READ-ONLY do Ruflo — presente/ausente, plugin-lite, canais, MCP policy. */
export function buildRufloReport() {
  return {
    schemaVersion: "gstack.ruflo.v1",
    present: detectRuflo(),
    role: "executor",
    pluginLiteAvailable: RUFLO.pluginLite,
    fullInitRecommended: false,
    autoInstall: false,
    channels: RUFLO_CHANNELS.map((c) => ({ ...c })),
    defaultChannels: defaultRufloChannels(),
    mcpPolicy: { allow: [...RUFLO_MCP_ALLOW], deny: [...RUFLO_MCP_DENY], default: "deny" },
  }
}
