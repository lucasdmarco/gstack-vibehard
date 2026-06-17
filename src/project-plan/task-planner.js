/**
 * Loop Engineer (PR7): gera um plano de FEATURE/BUGFIX sobre um projeto existente.
 *
 * Reusa a infra real: Document Graph (context search/related), workflow determinístico
 * e delegação OpenCode. Princípios de segurança (PRD §15):
 *  - OpenCode NUNCA roda sem confirmação explícita (step requiresConfirmation);
 *  - nada destrutivo;
 *  - passos de leitura (context) são seguros e ajudam a achar o código relevante.
 *
 * Módulo PURO (sem I/O): retorna o plano; a camada de comando imprime/persiste.
 */

const CLI = "gstack_vibehard"

/** Heurística simples: termo mais "substantivo" do pedido para `context related`. */
function pickEntity(request) {
  const words = String(request || "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((w) => w.length > 3)
  // prefere uma palavra capitalizada (provável entidade), senão a mais longa
  const cap = words.find((w) => /^[A-ZÀ-Ý]/.test(w))
  return cap || words.sort((a, b) => b.length - a.length)[0] || ""
}

export function buildTaskPlan(opts = {}) {
  const request = String(opts.request || "").trim()
  const hasIndex = opts.hasIndex === true
  const steps = []

  if (hasIndex) {
    steps.push({ id: "context:search", label: "Descobrir código relacionado (Document Graph)", command: [CLI, "context", "search", request], kind: "read", optional: false, requiresConfirmation: false })
    const entity = pickEntity(request)
    if (entity) {
      steps.push({ id: "context:related", label: `Entidades relacionadas a "${entity}"`, command: [CLI, "context", "related", entity], kind: "read", optional: true, requiresConfirmation: false })
    }
  }

  steps.push({ id: "workflow:run", label: "Rodar workflow determinístico (planner→worker→verifier→testes)", command: [CLI, "workflow", "run", "--task", request], kind: "work", optional: false, requiresConfirmation: false })
  steps.push({ id: "delegate:opencode", label: "Delegar implementação ao OpenCode (worktree isolado)", command: [CLI, "delegate", "opencode", "--task", request], kind: "delegate", optional: true, requiresConfirmation: true })

  const notes = [
    "Os passos de contexto são leitura segura (offline, sem LLM).",
    "O OpenCode NUNCA é executado sem sua confirmação explícita.",
    hasIndex ? "Índice encontrado — o plano usa o Document Graph." : "Sem índice: rode `context index` para enriquecer a descoberta.",
  ]

  return {
    id: `task_${Math.random().toString(36).slice(2, 10)}`,
    request,
    hasIndex,
    createdAt: new Date().toISOString(),
    steps,
    notes,
  }
}
