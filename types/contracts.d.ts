/**
 * Tipos dos CONTRATOS canônicos do gstack (PRD 12 B3 / PR10). Declarações `.d.ts`
 * para os dados que mais importam (onde os P0 aconteceram): Runtime Manifest V2,
 * Secrets Schema V2, Agent Manifest V2 e Attestation Receipt. Dão tipos a editores e
 * consumidores sem migrar o código para TypeScript (ESM puro + checkJs).
 */

// ── Runtime Manifest V2 (src/runtime/manifest.js) ──
export interface RuntimeHealthCheck {
  type: "http" | "process"
  path?: string
  timeoutSeconds?: number
}
export interface RuntimeService {
  name: string
  command: string[] // SEMPRE array (sem shell string)
  cwd?: string
  dependsOn?: string[]
  port?: { preferred: number; env?: string; autoAllocate?: boolean } | null
  health?: { readiness?: RuntimeHealthCheck; liveness?: RuntimeHealthCheck }
  restart?: { policy: "always" | "on-failure" | "never"; maxAttempts?: number; backoffSeconds?: number[] }
  secretRefs?: string[]
}
export interface RuntimeManifest {
  schemaVersion: 2
  services: RuntimeService[]
}

// ── Secrets Schema V2 (src/secrets/schema.js) — nomes/metadados, NUNCA valores ──
export interface RequiredSecret {
  name: string
  scope: "runtime" | string
  services: string[]
  sensitive: boolean
}
export interface SecretsSchema {
  schemaVersion: 2
  provider: string
  required: RequiredSecret[]
  optional: string[]
}

// ── Agent Manifest V2 (src/agents/factory.js) ──
export interface AdapterEntry {
  version: number
  status: "generated" | "compat_cursor" | "native" | "absent"
  files: string[]
}
export interface AgentManifestV2 {
  schemaVersion: 2
  generatedBy: string
  compilerVersion: string
  agents: number
  source: { coreHash: string; knowledgeHash: string; agentsHash: string }
  adapters: Record<string, AdapterEntry>
  security: { scanner: string; verdict: "pass" | "fail"; critical: number; high: number }
}

// ── VFA Attestation Receipt (src/vfa/attestation.js) ──
export interface AttestationReceipt {
  schemaVersion: 1
  actionId: string
  runId: string
  parentActionId: string | null
  actor: { harness?: string; agent?: string; trustLevel?: string }
  intent: string
  target: { kind?: "file" | "command" | "mcp" | "secret" | "network" | string; pathOrName?: string; scope?: string }
  inputHash: string
  outputHash: string
  policy: { decision: "allow" | "deny" | "challenge" | "redact"; rules: string[] }
  timestamp: string
  previousHash: string
  receiptHash: string
  signature?: string
}
