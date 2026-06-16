import { execFileSync as defaultExecFileSync } from "child_process"

/**
 * Delegação para OpenCode — usa OUTRO modelo/free tier configurado pelo USUÁRIO.
 *
 * Fase 1: policy declarativa (contrato). Fase 2 adiciona o runner real
 * `runDelegation`. O gstack NÃO faz model calls — quem chama o modelo é o
 * OpenCode (configurado pelo usuário). Tudo opt-in, com confirmação.
 */

// A task vai como arg em array (execFileSync, shell:false) → injecao de shell
// nao e possivel. Espacos sao OK (linguagem natural); rejeitamos newline/null.
const UNSAFE_TASK = /[\n\r\0]/

export function buildDelegationPolicy(overrides = {}) {
  return {
    enabled: false,
    requiresUserApproval: true,
    defaultHarness: "opencode",
    returnFormat: "summary+diff+exitCode+verifier",
    modelProvider: "user-configured",
    ...overrides,
  }
}

/** Valida a policy de delegação. Não lança. */
export function validateDelegation(policy) {
  const errors = []
  if (!policy || typeof policy !== "object") return { valid: false, errors: ["policy ausente"] }
  if (typeof policy.enabled !== "boolean") errors.push("enabled deve ser boolean")
  if (policy.enabled && policy.requiresUserApproval !== true) {
    errors.push("delegacao habilitada exige requiresUserApproval:true")
  }
  if (policy.defaultHarness && policy.defaultHarness !== "opencode") {
    errors.push("defaultHarness suportado: opencode")
  }
  return { valid: errors.length === 0, errors }
}

/** True se o CLI do OpenCode está disponível. */
export function isOpencodeAvailable(exec = defaultExecFileSync) {
  try {
    exec("opencode", ["--version"], { stdio: "pipe", timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export function isSafeTask(task) {
  return typeof task === "string" && task.trim().length > 0 && !UNSAFE_TASK.test(task)
}
