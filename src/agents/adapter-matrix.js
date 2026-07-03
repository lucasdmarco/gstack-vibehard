/**
 * Adapter Capability Matrix V2 (PRD 13 §8.4 + PRD 14 §4.1). Declaração HONESTA do
 * suporte por harness — scorecard completo, distinto do `trustLevel` de runtime.
 * NENHUM harness instrucional pode ser descrito como Zero-Trust ou enforcement:
 * o adapter instrui, o bloqueio real vem de hooks quando existem.
 *
 * enforcement (o que BLOQUEIA):
 *   real_hooks      = o adapter aciona hooks reais que BLOQUEIAM (quando instalados).
 *   partial         = hook best-effort (sem garantia de bloqueio pré-ação).
 *   rules_only      = regras/instruções carregadas pelo editor; não bloqueiam.
 *   instructional   = só texto de convenção; o agente pode ignorar.
 *   detection_only  = só detectado/declarado; sem formato de adapter próprio ainda.
 *
 * state (COMO o suporte é entregue — eixo do scorecard V2):
 *   native             = formato de primeira classe do harness + hooks reais.
 *   adapter_backed     = adapter gerado/instalado pelo gstack.
 *   instruction_backed = só arquivo de orientação no convention do harness.
 *   reference_only     = documentado/detectado; nada é gerado.
 *   unsupported        = fora da matriz.
 */

export const ENFORCEMENT_LEVELS = Object.freeze(["real_hooks", "partial", "rules_only", "instructional", "detection_only"])
export const CAPABILITY_STATES = Object.freeze(["native", "adapter_backed", "instruction_backed", "reference_only", "unsupported"])

// Atualize ao reverificar a matriz (ritual de release — CONTRIBUTING.md).
const VERIFIED_AT = "2026-07-02"
const OWNER = "gstack-core"

const VERIFY_BASE = ["gstack_vibehard agents doctor --json"]

function row(def) {
  return Object.freeze({
    riskNotes: [], unsupportedSurfaces: [], verificationCommands: VERIFY_BASE,
    lastVerifiedAt: VERIFIED_AT, owner: OWNER, ...def,
  })
}

export const ADAPTER_MATRIX = Object.freeze({
  claude: row({
    target: "SKILL.md por agente", enforcement: "real_hooks", generated: true, state: "native",
    supportedAssets: ["agents", "skills", "hooks", "rules", "mcp", "challenge-pretool"],
    unsupportedSurfaces: [],
    installOrOnramp: "gstack_vibehard install --harness claude",
    verificationCommands: [...VERIFY_BASE, "gstack_vibehard doctor --json"],
    riskNotes: ["hooks precisam estar instalados (install) para bloquear de fato"],
  }),
  codex: row({
    target: "TOML por agente", enforcement: "partial", generated: true, state: "adapter_backed",
    supportedAssets: ["agents", "mcp", "instructional-gates"],
    unsupportedSurfaces: ["pre-tool blocking garantido"],
    installOrOnramp: "gstack_vibehard install --harness codex",
    riskNotes: ["hook best-effort — sem garantia de bloqueio pré-ação"],
  }),
  cursor: row({
    target: ".mdc rules + AGENTS.md", enforcement: "rules_only", generated: true, state: "adapter_backed",
    supportedAssets: ["agents", "rules", "hooks (beforeShellExecution)"],
    unsupportedSurfaces: ["base-URL custom (output guard em trânsito)"],
    installOrOnramp: "gstack_vibehard install --harness cursor",
    riskNotes: ["rules não bloqueiam; bloqueio real só via hooks.json instalado"],
  }),
  opencode: row({
    target: "compat Cursor (declarado) + plugins manifest-owned", enforcement: "rules_only", generated: false, state: "adapter_backed",
    supportedAssets: ["plugins (tool.execute.before)", "skills"],
    unsupportedSurfaces: ["adapter de agente gerado (usa compat)"],
    installOrOnramp: "gstack_vibehard install --harness opencode",
    riskNotes: ["kill switch: GSTACK_OPENCODE_DISABLE=1", "config .jsonc nunca é reescrita"],
  }),
  copilot: row({
    target: ".github/copilot-instructions.md", enforcement: "instructional", generated: true, state: "instruction_backed",
    supportedAssets: ["instructions combinadas"],
    unsupportedSurfaces: ["hooks", "bloqueio pré-ação", "MCP gerenciado"],
    installOrOnramp: "gstack_vibehard agents build",
    riskNotes: ["o agente pode ignorar o texto — não é enforcement"],
  }),
  gemini: row({
    target: "GEMINI.md", enforcement: "instructional", generated: true, state: "instruction_backed",
    supportedAssets: ["instructions combinadas"],
    unsupportedSurfaces: ["hooks", "bloqueio pré-ação"],
    installOrOnramp: "gstack_vibehard agents build",
    riskNotes: ["o agente pode ignorar o texto — não é enforcement"],
  }),
  hermes: row({
    target: "~/.hermes/skills + AGENTS.md + MCP", enforcement: "partial", generated: false, state: "adapter_backed",
    supportedAssets: ["skills", "mcp"],
    unsupportedSurfaces: ["hooks nativos"],
    installOrOnramp: "gstack_vibehard install (detecção hermes)",
    riskNotes: ["enforcement parcial via MCP; sem pre-tool hook"],
  }),
  windsurf: row({
    target: "doc por harness", enforcement: "instructional", generated: false, state: "instruction_backed",
    supportedAssets: ["orientação por repo"],
    unsupportedSurfaces: ["hooks", "adapters gerados"],
    installOrOnramp: "orientação por-repo (sem escrita global)",
    riskNotes: ["só texto — o agente pode ignorar"],
  }),
  kiro: row({
    target: "doc por harness", enforcement: "detection_only", generated: false, state: "reference_only",
    supportedAssets: [],
    unsupportedSurfaces: ["hooks", "adapters", "rules"],
    installOrOnramp: "apenas detectado pelo doctor",
    riskNotes: ["nenhum artefato gerado — cobertura zero"],
  }),
  devin: row({
    target: ".devin/config.json + .devin/hooks.v1.json + .devin/skills", enforcement: "real_hooks", generated: true, state: "adapter_backed",
    supportedAssets: ["permissions (policy compilada)", "hooks", "skills"],
    unsupportedSurfaces: ["cloud handoff (opt-in explícito, nunca default)"],
    installOrOnramp: "gstack_vibehard install --harness devin --project-only",
    verificationCommands: [...VERIFY_BASE, "gstack_vibehard doctor --json", "devin --version"],
    riskNotes: [
      "real_hooks depende do Devin instalado E dos hooks carregarem — doctor faz downgrade p/ rules_only/partial se não validar",
      "cloud handoff pode enviar repo/diff/contexto para Devin Cloud — sempre exige confirmação",
    ],
  }),
})

const UNKNOWN = row({
  target: "(desconhecido)", enforcement: "detection_only", generated: false, state: "unsupported",
  supportedAssets: [], unsupportedSurfaces: ["tudo"], installOrOnramp: "não suportado",
  riskNotes: ["harness fora da matriz — nenhuma promessa"],
})

export function getAdapterInfo(id) {
  return ADAPTER_MATRIX[id] || UNKNOWN
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
