/**
 * Adapter Capability Matrix (PRD 13 §8.4 / PR13.3). Declaração HONESTA do nível de
 * enforcement de cada adapter gerado — distinta do `trustLevel` de runtime
 * (capabilities.js). NENHUM harness instrucional pode ser descrito como Zero-Trust
 * ou enforcement: o adapter instrui, o bloqueio real vem de hooks quando existem.
 *
 * enforcement:
 *   real_hooks      = o adapter aciona hooks reais que BLOQUEIAM (quando instalados).
 *   partial         = hook best-effort (sem garantia de bloqueio pré-ação).
 *   rules_only      = regras/instruções carregadas pelo editor; não bloqueiam.
 *   instructional   = só texto de convenção; o agente pode ignorar.
 *   detection_only  = só detectado/declarado; sem formato de adapter próprio ainda.
 */

export const ENFORCEMENT_LEVELS = Object.freeze(["real_hooks", "partial", "rules_only", "instructional", "detection_only"])

export const ADAPTER_MATRIX = Object.freeze({
  claude: { target: "SKILL.md por agente", enforcement: "real_hooks", generated: true },
  codex: { target: "TOML por agente", enforcement: "partial", generated: true },
  cursor: { target: ".mdc rules + AGENTS.md", enforcement: "rules_only", generated: true },
  opencode: { target: "compat Cursor (declarado)", enforcement: "rules_only", generated: false },
  copilot: { target: ".github/copilot-instructions.md", enforcement: "instructional", generated: true },
  gemini: { target: "GEMINI.md", enforcement: "instructional", generated: true },
  hermes: { target: "~/.hermes/skills + AGENTS.md + MCP", enforcement: "partial", generated: false },
  windsurf: { target: "doc por harness", enforcement: "instructional", generated: false },
  kiro: { target: "doc por harness", enforcement: "detection_only", generated: false },
})

export function getAdapterInfo(id) {
  return ADAPTER_MATRIX[id] || { target: "(desconhecido)", enforcement: "detection_only", generated: false }
}

/** É instrucional (NÃO pode ser rotulado enforcement/Zero-Trust)? */
export function isInstructional(id) {
  const e = getAdapterInfo(id).enforcement
  return e === "instructional" || e === "detection_only"
}

/** Os harnesses que o compilador deve GERAR adapter (matriz). */
export function generatedHarnesses() {
  return Object.entries(ADAPTER_MATRIX).filter(([, v]) => v.generated).map(([id]) => id)
}
