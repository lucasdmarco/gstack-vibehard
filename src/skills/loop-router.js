/**
 * Loop Router (PRD34 F2-C / PRD32 §14).
 *
 * O leigo não sabe se o pedido dele é "um app", "um fluxo com fases", "uma tarefa
 * iterativa num projeto existente" ou "vários agentes em paralelo". O Loop Router
 * classifica a INTENÇÃO em um dos 6 modos de execução e DECLARA um Loop Decision
 * Record — a próxima etapa sabe qual laço reger.
 *
 * Regra de honestidade (PRD32 §14): em contexto NÃO-interativo AMBÍGUO (nenhum
 * sinal claro), o router NÃO chuta — devolve `needs_user_confirmation` com um
 * JSON acionável. PURO/testável.
 */

export const LOOP_DECISION_SCHEMA = "gstack.loop-decision.v1"

// Os 6 modos e o comando GStack que os implementa.
export const LOOP_MODES = Object.freeze({
  knowledge_only: { command: "consult|plan", writes: false, desc: "consulta/análise read-only" },
  replit_pipeline: { command: "start", writes: true, desc: "construir um app/feature guiado" },
  workflow_graph: { command: "workflow", writes: true, desc: "fluxo multi-etapa com dependências" },
  task_worktree_loop: { command: "task", writes: true, desc: "tarefa iterativa em worktree" },
  meta_harness_parallel: { command: "orchestrate --parallel", writes: true, desc: "subtarefas independentes em paralelo" },
  delegate_single_harness: { command: "delegate", writes: true, desc: "entregar a um harness externo" },
})

// Sinais por modo (ordem = prioridade quando mais de um casa).
const LOOP_SIGNALS = Object.freeze([
  ["knowledge_only", /explicar|entender|analis|revis|documentar|comparar|consultar|resumir|auditar|o que (é|faz|significa)|como funciona|por que/i],
  ["delegate_single_harness", /delegar|delega\b|entregar (para|ao) (o |um )?(agente|codex|devin|cursor|opencode|claude code)|handoff|terceiriz/i],
  ["meta_harness_parallel", /paralelo|paralel|simultân|simultane|vários? agentes|varios? agentes|múltiplos agentes|subtarefas independentes|ao mesmo tempo|em lote/i],
  ["workflow_graph", /várias etapas|varias etapas|multi.?etapa|fluxo de|pipeline com|com fases|dependênc|primeiro.+depois|orquestrar (as )?etapas|workflow/i],
  ["task_worktree_loop", /refator|corrig|\bbug\b|ajustar|melhorar|adicionar (ao|no|a este|à)|neste projeto|projeto existente|iterar|itere|patch|pequena mudança/i],
  ["replit_pipeline", /criar|construir|fazer|montar|desenvolver|novo (app|site|projeto)|landing|dashboard|\bapp\b|\bsite\b|\bmvp\b|sistema/i],
])

/** Modos cujos sinais casam com o texto, em ordem de prioridade. */
export function detectLoopSignals(text) {
  const t = String(text || "")
  return LOOP_SIGNALS.filter(([, re]) => re.test(t)).map(([mode]) => mode)
}

// Fonte da decisão: flag do usuário > sinais da intenção > palpite default.
function decideMode(objective, flags) {
  if (flags && flags.loop && LOOP_MODES[flags.loop]) return { mode: flags.loop, source: "user_flag", matched: [flags.loop] }
  const matched = detectLoopSignals(objective)
  if (matched.length > 0) return { mode: matched[0], source: "intent_signals", matched }
  return { mode: "replit_pipeline", source: "default_guess", matched: [] }
}

const confidenceOf = (source, matched) =>
  source === "user_flag" ? "high" : source === "default_guess" ? "none" : matched.length === 1 ? "high" : "medium"

/** Monta o Loop Decision Record (declarativo — não executa nada). */
export function buildLoopDecision({ objective = "", flags = {} } = {}) {
  const { mode, source, matched } = decideMode(objective, flags)
  const confidence = confidenceOf(source, matched)
  return {
    schemaVersion: LOOP_DECISION_SCHEMA,
    generatedAt: new Date().toISOString(),
    objective,
    mode,
    command: LOOP_MODES[mode].command,
    writesCode: LOOP_MODES[mode].writes,
    source,
    confidence,
    ambiguous: source === "default_guess",
    matchedModes: matched,
    alternatives: matched.slice(1).map((m) => ({ mode: m, command: LOOP_MODES[m].command })),
    reason: `${source} → ${mode} (${LOOP_MODES[mode].desc})`,
  }
}

/**
 * Resolve a decisão para o chamador. Em não-interativo AMBÍGUO (palpite, sem flag),
 * NÃO chuta: status `needs_user_confirmation` + JSON acionável (as opções reais).
 */
export function resolveLoopDecision({ objective = "", flags = {}, interactive = false } = {}) {
  const decision = buildLoopDecision({ objective, flags })
  if (decision.ambiguous && !interactive) {
    return {
      ...decision, status: "needs_user_confirmation",
      actionable: {
        message: "Não consegui inferir o modo de execução com segurança. Escolha um:",
        options: Object.entries(LOOP_MODES).map(([mode, m]) => ({ mode, command: m.command, desc: m.desc })),
        hint: 'reexecute com --loop <mode> ou "" objetivo mais específico',
      },
    }
  }
  return { ...decision, status: "decided" }
}
