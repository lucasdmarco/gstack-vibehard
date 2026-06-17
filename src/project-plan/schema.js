/**
 * Project Plan — schema do plano determinístico (sem LLM).
 *
 * Um plano descreve PASSOS que mapeiam para comandos REAIS do gstack_vibehard
 * (create/context/tools/workflow/doctor...). Nenhum comando fictício: passos que
 * dependem de features ainda não existentes (ex.: runtime manager) entram como
 * `pendingFeature:true` e NÃO carregam comando executável.
 *
 * Esta camada é puramente declarativa: não registra comandos na CLI nem executa
 * nada. O executor (PR5) é quem roda; aqui só definimos/validamos a estrutura.
 */

export const PLAN_STATUS = Object.freeze(["draft", "ready", "running", "done", "failed"])
export const MODE_IDS = Object.freeze(["lite", "full"])

/** Cria um passo normalizado. command=null só é válido com pendingFeature:true. */
export function makeStep(partial = {}) {
  return {
    id: partial.id || "",
    label: partial.label || partial.id || "",
    command: Array.isArray(partial.command) ? partial.command : (partial.command == null ? null : [String(partial.command)]),
    required: partial.required !== false,
    destructive: partial.destructive === true,
    cwd: partial.cwd || ".",
    pendingFeature: partial.pendingFeature === true,
  }
}

/** Normaliza um plano parcial, preenchendo defaults e congelando o formato. */
export function makePlan(partial = {}) {
  return {
    id: partial.id || `plan_${Math.random().toString(36).slice(2, 10)}`,
    version: partial.version || 1,
    objective: partial.objective || "",
    projectName: partial.projectName || "",
    intent: partial.intent || "",
    template: partial.template || "",
    mode: MODE_IDS.includes(partial.mode) ? partial.mode : "lite",
    recommendedMode: MODE_IDS.includes(partial.recommendedMode) ? partial.recommendedMode : "lite",
    modeReason: partial.modeReason || "",
    status: PLAN_STATUS.includes(partial.status) ? partial.status : "draft",
    createdAt: partial.createdAt || new Date().toISOString(),
    steps: (partial.steps || []).map(makeStep),
    optionalSteps: (partial.optionalSteps || []).map(makeStep),
    suggestedIntegrations: Array.isArray(partial.suggestedIntegrations) ? partial.suggestedIntegrations : [],
    risks: Array.isArray(partial.risks) ? partial.risks : [],
    nextActions: Array.isArray(partial.nextActions) ? partial.nextActions : [],
  }
}

/**
 * Valida um plano. Retorna { ok, errors:[] }. Regras:
 *  - objetivo e ao menos 1 step;
 *  - mode/recommendedMode em MODE_IDS;
 *  - todo step tem id e label;
 *  - step executável (não pendingFeature) precisa de command[] não-vazio;
 *  - step pendingFeature NÃO pode ter command (evita rodar comando inexistente);
 *  - nenhum step destrutivo entra no MVP (execução segura).
 */
export function validatePlan(plan) {
  const errors = []
  if (!plan || typeof plan !== "object") return { ok: false, errors: ["plano ausente"] }
  if (!plan.objective || !String(plan.objective).trim()) errors.push("objective vazio")
  if (!MODE_IDS.includes(plan.mode)) errors.push(`mode inválido: ${plan.mode}`)
  if (!MODE_IDS.includes(plan.recommendedMode)) errors.push(`recommendedMode inválido: ${plan.recommendedMode}`)
  const steps = Array.isArray(plan.steps) ? plan.steps : null
  if (!steps || steps.length === 0) errors.push("plano sem steps")
  for (const [i, s] of (steps || []).entries()) {
    if (!s.id) errors.push(`step[${i}] sem id`)
    if (!s.label) errors.push(`step[${i}] sem label`)
    if (s.destructive) errors.push(`step[${i}] destrutivo não permitido no MVP`)
    if (s.pendingFeature) {
      if (s.command) errors.push(`step[${i}] pendingFeature não pode ter command`)
    } else if (!Array.isArray(s.command) || s.command.length === 0) {
      errors.push(`step[${i}] executável sem command`)
    }
  }
  return { ok: errors.length === 0, errors }
}
