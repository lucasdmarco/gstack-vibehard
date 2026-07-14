import { createHash } from "node:crypto"
import { analyzeParallelSafety } from "../skills/parallel-preflight.js"

/**
 * Paralelismo adaptativo (PRD42 S42.11). Estende o preflight de DAG (`analyzeParallelSafety`) com
 * decisões HONESTAS sobre quando paralelizar:
 *
 *  • DAG misto (mixed_waves) ⇒ PERGUNTA ao usuário (não auto-decide como paralelizar).
 *  • quota `unknown` (não medida) NUNCA vira "suficiente" — sem saber a quota, não se paraleliza.
 *  • MERGE BARRIER: toda branch paralela precisa passar os GATES COMUNS antes do merge.
 *  • Context Pack por REFERÊNCIA (hash), nunca inlinado.
 *
 * PURO/testável.
 */
export const ADAPTIVE_PARALLEL_SCHEMA = "gstack.adaptive-parallel.v1"

/** quota.available não-numérico ⇒ `unknown`, nunca suficiente. */
export function quotaSufficient(quota = {}) {
  const needed = quota.needed || 1
  if (typeof quota.available !== "number") return { sufficient: false, reason: "quota unknown — nunca é 'suficiente'", needed }
  return { sufficient: quota.available >= needed, available: quota.available, needed }
}

const MODE_BY_RECOMMENDATION = { parallel_safe: "parallel", sequential_required: "sequential" }

/**
 * Decide o modo. Ciclo ⇒ blocked. Quota insuficiente/unknown OU DAG misto ⇒ ask_user (decisão
 * humana, não auto). Independente + quota ok ⇒ parallel; encadeado ⇒ sequential.
 */
export function planParallelism(steps = [], { quota = {} } = {}) {
  const analysis = analyzeParallelSafety(steps)
  const q = quotaSufficient(quota)
  if (analysis.hasCycle) return { schema: ADAPTIVE_PARALLEL_SCHEMA, mode: "blocked", reason: "cycle_error", analysis, quota: q }
  if (!q.sufficient) return { schema: ADAPTIVE_PARALLEL_SCHEMA, mode: "ask_user", reason: "quota insuficiente/unknown — decisão do usuário", analysis, quota: q }
  if (analysis.recommendation === "mixed_waves") return { schema: ADAPTIVE_PARALLEL_SCHEMA, mode: "ask_user", reason: "DAG misto — pergunte ao usuário como paralelizar", analysis, quota: q }
  return { schema: ADAPTIVE_PARALLEL_SCHEMA, mode: MODE_BY_RECOMMENDATION[analysis.recommendation] || "sequential", analysis, quota: q }
}

const missingGates = (branch, commonGates) => commonGates.filter((g) => !(branch.gates || {})[g])

/** Merge barrier: nenhuma branch entra no merge sem passar TODOS os gates comuns. */
export function mergeBarrier(branches = [], commonGates = []) {
  const blocked = branches
    .map((b) => ({ branch: b.id, missing: missingGates(b, commonGates) }))
    .filter((x) => x.missing.length > 0)
  return { schema: ADAPTIVE_PARALLEL_SCHEMA, ready: blocked.length === 0, blocked, commonGates: [...commonGates] }
}

/** Referência ao Context Pack por HASH (não inlina o conteúdo — economiza contexto de verdade). */
export function packReference(pack) {
  const json = JSON.stringify(pack || {})
  return { schema: ADAPTIVE_PARALLEL_SCHEMA, ref: createHash("sha256").update(json).digest("hex").slice(0, 16), bytes: json.length, inlined: false }
}
