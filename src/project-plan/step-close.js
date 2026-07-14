import { stepClose as stepCloseMatrix } from "../skills/action-kernel.js"
import { classifySurface } from "./change-surface.js"

/**
 * Step-close incremental (PRD42 S42.7). EXECUTA as checagens que o Action Kernel escolheu para o
 * diff (via `stepClose` = matriz superfície→checks), rodando SÓ o que a mudança pede — NUNCA a
 * suíte inteira por edição (a suíte completa fica para verify/proof). Reforça o invariante com
 * `ranFullSuite: false` sempre, e agrega um veredito por check.
 *
 * `runners`: `{ [checkName]: () => ({ ok, detail? }) }`. Sem runner ⇒ `skipped` (NÃO conta como
 * pass — honesto). Erro no runner ⇒ `failed`. PURO/testável (runners injetados).
 */
export const STEP_CLOSE_SCHEMA = "gstack.step-close.v1"

const runStatus = (r) => (r && r.ok === true ? "passed" : "failed")

function runOne(check, runners) {
  const runner = runners[check.name]
  if (!runner) return { name: check.name, status: "skipped", why: check.why, detail: "sem runner (não conta como pass)" }
  try {
    const r = runner()
    return { name: check.name, status: runStatus(r), why: check.why, detail: (r && r.detail) || null }
  } catch (e) {
    return { name: check.name, status: "failed", why: check.why, detail: `erro: ${e.message}` }
  }
}

export function runStepClose(files = [], runners = {}) {
  const plan = stepCloseMatrix(files)
  const checks = plan.checks.map((c) => runOne(c, runners))
  const failed = checks.filter((r) => r.status === "failed")
  return {
    schema: STEP_CLOSE_SCHEMA,
    surface: classifySurface(files),
    primary: plan.primary,
    types: plan.types,
    checks,
    ranFullSuite: false, // INVARIANTE: nunca a suíte inteira por edição
    ok: failed.length === 0,
    failed: failed.map((r) => r.name),
  }
}
