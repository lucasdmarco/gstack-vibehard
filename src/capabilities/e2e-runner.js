/**
 * Runner de E2E de backend (PRD42 S42.0D). Regra dura (PLANSPRINTSPRD42 §7): uma capacidade
 * `required` cujo ENGINE (Docker daemon) está AUSENTE fica `blocked_missing_engine` — NUNCA
 * skip-verde, NUNCA `not_applicable→passed`. Backend só é `passed` com probe real + teardown.
 * A lógica de classificação/agregação é PURA e testável sem Docker; o probe real roda em CI.
 */
export const E2E_STATES = Object.freeze(["passed", "failed", "blocked_missing_engine"])

/** Detecção do engine (Docker daemon), injetável. probe() deve retornar true se `docker
 * info` respondeu; qualquer erro/false = engine ausente (fail-closed, não assume disponível). */
export function dockerAvailable(probe) {
  try { return probe() === true }
  catch { return false }
}

const BLOCKED = "Docker daemon ausente — required NÃO vira skip-verde (roda em CI com engine)"

/**
 * Classifica o desfecho de UM backend. Sem engine → blocked_missing_engine. Com engine, o
 * resultado do probe (real, com teardown) decide passed|failed. Nunca inventa sucesso.
 */
export function classifyE2E({ capability, dockerUp, result }) {
  if (!dockerUp) return { capability, status: "blocked_missing_engine", reason: BLOCKED }
  if (!result || typeof result !== "object") return { capability, status: "failed", detail: "probe sem resultado" }
  return { capability, status: result.ok === true ? "passed" : "failed", detail: result.detail || null }
}

/**
 * Agrega resultados por obrigação. `ready` só se NENHUM backend `required` ficou fora de
 * `passed` (blocked/failed de required bloqueia release; opcional/experimental não).
 */
export function aggregateCapabilityE2E(results, obligations = {}) {
  const blocking = results.filter((r) => obligations[r.capability] === "required" && r.status !== "passed")
  return {
    ready: blocking.length === 0,
    blocked: blocking.map((r) => ({ capability: r.capability, status: r.status })),
    results,
  }
}
