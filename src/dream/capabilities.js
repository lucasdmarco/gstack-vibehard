/**
 * Matriz de capacidades REAIS por harness (PRD Fase 3 §5). Usada pelo `dream audit`,
 * pelo `verify` (reduced_trust) e pelo `doctor`.
 *
 * `supportsPreOutputInterception` (PRD25 25.3): `true` = existe rota REAL de
 * pre-render, mas SEMPRE OPT-IN via o proxy de redaction (`gstack_vibehard proxy`,
 * src/security/redact-proxy.js) apontado por base-URL custom (ANTHROPIC_BASE_URL /
 * OPENAI_BASE_URL / provider.baseURL) — matriz honesta em
 * src/security/guard-status.js (interceptionMatrix). NÃO é default nem universal:
 * harness sem base-URL custom (cursor/instrucionais) segue só auditoria pós-resposta.
 *
 * trustLevel:
 *   strong      = hooks/API reais (pre-tool-use + stop) que o GStack controla.
 *   partial     = hooks best-effort (ex.: Codex sem API de hooks restritiva).
 *   best_effort = só instrução em arquivo de convenção (pode ignorar os gates).
 */

const CAP = (o) => ({
  supportsPreOutputInterception: false, // default: sem base-URL custom → só pós-resposta
  supportsPreToolUse: false,
  supportsStopHook: false,
  supportsNativeImproveLoop: false,
  supportsWorktree: true, // git worktree é do GStack, não do harness
  ...o,
})

export const HARNESS_CAPABILITIES = Object.freeze({
  claude: CAP({ id: "claude", mode: "hooked", supportsPreToolUse: true, supportsStopHook: true, supportsPreOutputInterception: true, trustLevel: "strong" }),
  cursor: CAP({ id: "cursor", mode: "hooked", supportsPreToolUse: true, supportsStopHook: true, trustLevel: "strong" }),
  opencode: CAP({ id: "opencode", mode: "native", supportsPreToolUse: true, supportsStopHook: true, supportsPreOutputInterception: true, trustLevel: "strong" }),
  codex: CAP({ id: "codex", mode: "hooked", supportsPreToolUse: false, supportsStopHook: true, supportsPreOutputInterception: true, trustLevel: "partial" }),
  hermes: CAP({ id: "hermes", mode: "instructional", trustLevel: "best_effort" }),
  gemini: CAP({ id: "gemini", mode: "instructional", trustLevel: "best_effort" }),
  windsurf: CAP({ id: "windsurf", mode: "instructional", trustLevel: "best_effort" }),
  kiro: CAP({ id: "kiro", mode: "instructional", trustLevel: "best_effort" }),
  copilot: CAP({ id: "copilot", mode: "instructional", trustLevel: "best_effort" }),
  droid: CAP({ id: "droid", mode: "instructional", trustLevel: "best_effort" }),
  kilocode: CAP({ id: "kilocode", mode: "instructional", trustLevel: "best_effort" }),
  kimi: CAP({ id: "kimi", mode: "instructional", trustLevel: "best_effort" }),
  zed: CAP({ id: "zed", mode: "detection", supportsWorktree: true, trustLevel: "best_effort" }),
  vscode: CAP({ id: "vscode", mode: "detection", trustLevel: "best_effort" }),
})

const UNKNOWN = CAP({ id: "unknown", mode: "detection", trustLevel: "best_effort" })

export function getCapability(id) {
  return HARNESS_CAPABILITIES[id] || { ...UNKNOWN, id: id || "unknown" }
}

/** trustLevel forte exige hooks reais (pre-tool-use OU stop) controlados pelo GStack. */
export function isStrongTrust(id) {
  return getCapability(id).trustLevel === "strong"
}
