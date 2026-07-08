/**
 * Parallel preflight (PRD28 28.3 / PRD34 F3-C).
 *
 * Antes de `orchestrate --parallel`, o usuário precisa saber a VERDADE: só passos
 * independentes paralelizam; passos com `dependsOn` rodam em wave; um ciclo é erro.
 * Este módulo analisa os passos e devolve uma recomendação honesta — nada de
 * prometer paralelismo total quando há dependências. PURO/testável.
 */

export const PARALLEL_PREFLIGHT_SCHEMA = "gstack.parallel-preflight.v1"

const depsInPlan = (step, ids) => (step.dependsOn || []).filter((d) => ids.has(d))

// Ao concluir doneId, decrementa quem dependia dele; libera p/ fila se zerou.
function releaseDependents(step, doneId, ids, indeg, queue) {
  if (!depsInPlan(step, ids).includes(doneId)) return
  indeg.set(step.id, indeg.get(step.id) - 1)
  if (indeg.get(step.id) === 0) queue.push(step.id)
}
// Detecção de ciclo por Kahn: remove nós de indegree 0; sobrou algo ⇒ ciclo.
function hasCycle(steps, ids) {
  const indeg = new Map(steps.map((s) => [s.id, depsInPlan(s, ids).length]))
  const queue = steps.filter((s) => indeg.get(s.id) === 0).map((s) => s.id)
  let removed = 0
  while (queue.length) {
    const id = queue.shift()
    removed++
    for (const s of steps) releaseDependents(s, id, ids, indeg, queue)
  }
  return removed < steps.length
}

function recommend(total, dependentCount, cycle) {
  if (cycle) return "cycle_error"
  if (dependentCount === 0) return "parallel_safe"
  if (total - dependentCount <= 1) return "sequential_required"
  return "mixed_waves"
}

/** Analisa a segurança de paralelizar os passos (dependsOn dentro do plano). */
export function analyzeParallelSafety(steps = []) {
  const ids = new Set(steps.map((s) => s.id))
  const dependent = steps.filter((s) => depsInPlan(s, ids).length > 0)
  const cycle = hasCycle(steps, ids)
  const recommendation = recommend(steps.length, dependent.length, cycle)
  return {
    schemaVersion: PARALLEL_PREFLIGHT_SCHEMA,
    totalSteps: steps.length,
    independentSteps: steps.filter((s) => depsInPlan(s, ids).length === 0).map((s) => s.id),
    dependentSteps: dependent.map((s) => s.id),
    hasCycle: cycle,
    recommendation,
    safe: recommendation === "parallel_safe",
  }
}

/** Frase honesta p/ o preflight (o que --parallel REALMENTE fará). */
export function parallelPreflightNote(analysis) {
  const notes = {
    parallel_safe: () => `${analysis.totalSteps} passos independentes — paralelizam de fato.`,
    mixed_waves: () => `${analysis.dependentSteps.length} passo(s) com dependência rodam em wave; só os independentes paralelizam.`,
    sequential_required: () => "os passos são encadeados — --parallel não muda a ordem (roda sequencial).",
    cycle_error: () => "ciclo de dependência detectado — corrija dependsOn antes de orquestrar.",
  }
  return (notes[analysis.recommendation] || (() => ""))()
}
