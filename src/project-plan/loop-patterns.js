/**
 * Biblioteca determinística de Loop Patterns (PRD kilo-loop-patterns §3).
 *
 * Cada padrão descreve um CICLO seguro (objetivo claro, contexto relevante, ação
 * pequena, verificação confiável, regra de parada). `recommendedCommands` aponta
 * SEMPRE comandos REAIS do gstack. Módulo PURO: nenhum loop executa nada — só
 * informa o `task-planner` qual ciclo usar.
 */
import { VERIFICATION_PROFILES } from "./verification-profiles.js"
import { STOPPING_RULES } from "./stopping-rules.js"

const COMMON_STOPS = ["maxIterations", "sameFailureLimit", "maxWallTimeSeconds", "stopBeforeDestructiveCommand"]

export const LOOP_PATTERNS = Object.freeze({
  "test-driven": {
    id: "test-driven",
    label: "Test-Driven Agent Loop",
    bestFor: ["bug fix", "regressao", "parser", "regra de negocio", "data transformation"],
    intentKeywords: ["teste", "test", "regressao", "regressão", "falhando", "parser", "validacao", "validação"],
    contextSources: ["context.search", "context.related", "changed-files"],
    actionStrategy: "smallest-fix-to-pass-test",
    verificationProfile: "test-driven",
    stoppingRules: COMMON_STOPS,
    recommendedCommands: ["context search", "workflow run", "delegate opencode --worktree"],
  },
  "compiler-driven": {
    id: "compiler-driven",
    label: "Compiler-Driven Loop",
    bestFor: ["typescript", "migracao", "refactor", "upgrade de deps", "ajuste de tipos"],
    intentKeywords: ["type", "types", "typescript", "tsc", "build", "migracao", "migração", "refactor", "refatorar", "upgrade"],
    contextSources: ["context.search", "graphify", "changed-files"],
    actionStrategy: "small-structural-change",
    verificationProfile: "compiler-driven",
    stoppingRules: COMMON_STOPS,
    recommendedCommands: ["context search", "workflow run", "delegate opencode --worktree"],
  },
  "review-driven": {
    id: "review-driven",
    label: "Review-Driven Loop",
    bestFor: ["comentarios de PR", "revisao humana", "follow-ups"],
    intentKeywords: ["review", "revisao", "revisão", "comentario", "comentário", "pr", "feedback", "follow-up"],
    contextSources: ["context.search", "changed-files", "diff"],
    actionStrategy: "apply-actionable-feedback-only",
    verificationProfile: "review-driven",
    stoppingRules: [...COMMON_STOPS, "requireHumanReviewBeforeMerge"],
    recommendedCommands: ["context search", "workflow run", "delegate opencode --worktree"],
  },
  "runtime-debugging": {
    id: "runtime-debugging",
    label: "Runtime Debugging Loop",
    bestFor: ["bug", "runtime", "api", "logs", "crash"],
    intentKeywords: ["erro", "error", "bug", "crash", "500", "404", "log", "logs", "runtime", "stack", "excecao", "exceção"],
    contextSources: ["context.search", "context.related", "graphify", "logs", "changed-files"],
    actionStrategy: "small-reversible-change",
    verificationProfile: "runtime-debugging",
    stoppingRules: [...COMMON_STOPS, "stopOnMissingSecrets"],
    recommendedCommands: ["context search", "workflow run", "delegate opencode --worktree"],
  },
  "product-iteration": {
    id: "product-iteration",
    label: "Product Iteration Loop",
    bestFor: ["ui", "landing page", "copy", "ux", "responsividade", "polish visual"],
    intentKeywords: ["ui", "landing", "copy", "visual", "layout", "responsivo", "responsividade", "ux", "design", "estilo"],
    contextSources: ["context.search", "changed-files"],
    actionStrategy: "small-visual-change-with-acceptance",
    verificationProfile: "product-iteration",
    stoppingRules: [...COMMON_STOPS, "handoffOnAmbiguousProductDecision"],
    recommendedCommands: ["context search", "workflow run", "delegate opencode --worktree"],
  },
})

// Validação leve em tempo de carga: cada padrão referencia perfil/regras reais.
for (const p of Object.values(LOOP_PATTERNS)) {
  if (!VERIFICATION_PROFILES[p.verificationProfile]) throw new Error(`loop ${p.id}: verificationProfile inexistente`)
  for (const r of p.stoppingRules) if (!STOPPING_RULES[r]) throw new Error(`loop ${p.id}: stoppingRule inexistente ${r}`)
}

export function getLoopPattern(id) {
  return LOOP_PATTERNS[id] || null
}
