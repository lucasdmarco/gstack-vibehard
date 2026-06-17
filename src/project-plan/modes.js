/**
 * Modos do Project Plan: leve (lite) vs completo (full).
 * Copy honesta sobre o que cada modo inclui/exclui, para quem é, deps e trade-offs.
 * Usado pelo wizard (PR4) e pelo planner para escolher o conjunto de steps.
 */

export const MODES = Object.freeze({
  lite: {
    id: "lite",
    label: "Leve",
    summary: "Mais rápido, menos dependências, ideal para começar e validar uma ideia.",
    includes: [
      "template do projeto",
      "estrutura .gstack",
      "agentes e instruções",
      "contexto do projeto",
      "Document Graph local",
      "comandos de desenvolvimento",
      "suporte básico a workflows",
      "OpenCode opcional",
      "Printing Press discovery opcional",
    ],
    excludes: [
      "Docker obrigatório",
      "Casdoor local",
      "Atomic VCS",
      "ECC2/control plane pesado",
      "instalação global pesada",
    ],
    bestFor: ["testar uma ideia", "criar MVP rápido", "rodar em notebook fraco", "usuário iniciante"],
    deps: ["node>=18"],
    tradeoffs: ["menos isolamento", "menos governança local", "features avançadas ficam opt-in"],
  },
  full: {
    id: "full",
    label: "Completo",
    summary: "Mais poderoso, com governança, isolamento, memória, quality gates e serviços locais.",
    includes: [
      "tudo do modo leve",
      "Casdoor local (IAM/governança)",
      "Atomic VCS/workspaces paralelos",
      "ECC2/control plane quando disponível",
      "daemons de memória",
      "Graphify hooks",
      "Headroom",
      "Quality Gate mais agressivo",
      "integrações MCP mais completas",
    ],
    excludes: [],
    bestFor: ["produto real", "time", "agentes em paralelo", "auditoria", "workflows longos", "governança"],
    deps: ["node>=18", "Docker (opcional p/ serviços)", "Rust/bun/Go (algumas features)"],
    tradeoffs: ["setup mais pesado", "mais peças para diagnosticar", "primeira instalação demora mais"],
  },
})

export function getMode(id) {
  return MODES[id] || null
}

/** Texto do wizard (mostra os dois modos com a copy completa). */
export function modeWizardText() {
  const m = MODES
  return [
    "Como você quer iniciar?",
    "",
    `1. ${m.lite.label}`,
    `   ${m.lite.summary}`,
    "   Sem Casdoor, Atomic VCS ou serviços pesados por padrão.",
    "",
    `2. ${m.full.label}`,
    `   ${m.full.summary}`,
    "   Recomendado para produto real ou trabalho com múltiplos agentes.",
    "",
    "Você pode começar leve e ativar recursos avançados depois.",
  ].join("\n")
}
