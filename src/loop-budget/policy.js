/**
 * Loop budget: caps determinísticos e circuit breakers para workflows agênticos.
 * Config declarativa em .gstack/loop-budget.json — consumida pelo graph runner.
 * Inclui a policy de delegação (opt-in, sem execução automática).
 */

export const SCHEMA_VERSION = 1

export const DEFAULT_LOOP_BUDGET = {
  schemaVersion: SCHEMA_VERSION,
  maxIterations: 3,
  maxWallTimeSeconds: 900,
  maxConsecutiveSameFailure: 2,
  compressLogs: true,
  preferredVerifier: "fallow",
  humanHandoffOnCap: true,
  delegation: {
    enabled: false,
    requiresUserApproval: true,
    defaultHarness: "opencode",
    returnFormat: "summary+diff+exitCode+verifier",
    modelProvider: "user-configured",
  },
  journal: {
    enabled: true,
    path: ".gstack/workflows/runs",
  },
}

export function buildLoopBudget(overrides = {}) {
  return {
    ...DEFAULT_LOOP_BUDGET,
    ...overrides,
    delegation: { ...DEFAULT_LOOP_BUDGET.delegation, ...(overrides.delegation || {}) },
    journal: { ...DEFAULT_LOOP_BUDGET.journal, ...(overrides.journal || {}) },
  }
}

/**
 * Valida um loop-budget. Retorna { valid, errors[] }. Não lança.
 */
export function validateLoopBudget(obj) {
  const errors = []
  if (!obj || typeof obj !== "object") return { valid: false, errors: ["nao e objeto"] }
  const posInt = (k) => {
    const v = obj[k]
    if (!Number.isInteger(v) || v <= 0) errors.push(`${k} deve ser inteiro > 0`)
  }
  posInt("maxIterations")
  posInt("maxWallTimeSeconds")
  posInt("maxConsecutiveSameFailure")
  if (obj.delegation) {
    if (typeof obj.delegation.enabled !== "boolean") errors.push("delegation.enabled deve ser boolean")
    if (obj.delegation.enabled && obj.delegation.requiresUserApproval !== true) {
      errors.push("delegation habilitada exige requiresUserApproval:true")
    }
  }
  return { valid: errors.length === 0, errors }
}

/** Merge de defaults (preenche campos faltando) — para configs antigas/parciais. */
export function normalizeLoopBudget(obj) {
  return buildLoopBudget(obj && typeof obj === "object" ? obj : {})
}
