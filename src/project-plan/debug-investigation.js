/**
 * Debug científico (PRD42 S42.9). Um bug não se "conserta" no chute: percorre um método
 *   reported → reproduced → hypothesis → fix_applied → regression_green
 * com dois invariantes que fecham a porta contra debugging por tentativa-e-erro cego:
 *
 *  1. EDITAR ANTES DE REPRODUZIR é BLOQUEADO — sem reprodução do bug, não se aplica correção.
 *  2. Após MAX_FIX_ATTEMPTS regressões vermelhas, HARD HALT em `architecture_review_required`
 *     (para de tentar consertar o sintoma — o problema é estrutural).
 *
 * Transição fora de ordem = erro tipado (fail-closed). PURO/testável.
 */
export const DEBUG_INVESTIGATION_SCHEMA = "gstack.debug-investigation.v1"
export const DEBUG_STATES = Object.freeze(["reported", "reproduced", "hypothesis", "fix_applied", "regression_green", "architecture_review_required"])
export const MAX_FIX_ATTEMPTS = 3

const TRANSITIONS = Object.freeze({
  reported: ["reproduced"],
  reproduced: ["hypothesis"],
  hypothesis: ["fix_applied"],
  fix_applied: ["regression_green", "hypothesis", "architecture_review_required"],
  regression_green: [],
  architecture_review_required: [],
})

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to)

export function startInvestigation({ bug = "" } = {}) {
  return {
    schema: DEBUG_INVESTIGATION_SCHEMA, bug,
    state: "reported", attempts: 0,
    history: [{ state: "reported", at: new Date().toISOString() }],
  }
}

/** Avança o estado (fail-closed). `evidence` anexada ao histórico. */
export function advanceDebug(inv, to, evidence = null) {
  if (!canTransition(inv.state, to)) throw new Error(`invalid_transition: ${inv.state} -> ${to}`)
  inv.state = to
  inv.history.push({ state: to, at: new Date().toISOString(), ...(evidence ? { evidence } : {}) })
  return inv
}

/** reported → reproduced. Exige EVIDÊNCIA de reprodução (não basta afirmar). */
export function reproduce(inv, evidence = {}) {
  if (evidence.reproduced !== true) throw new Error("reprodução exige evidence.reproduced === true (não se avança sem reproduzir)")
  return advanceDebug(inv, "reproduced", evidence)
}

/** reproduced → hypothesis. */
export function hypothesize(inv, note = "") {
  return advanceDebug(inv, "hypothesis", { note })
}

/** hypothesis → fix_applied. BLOQUEIA editar antes de reproduzir (estado reported). */
export function applyFix(inv) {
  if (inv.state === "reported") throw new Error("editar antes de reproduzir é BLOQUEADO — reproduza o bug primeiro")
  return advanceDebug(inv, "fix_applied")
}

/**
 * fix_applied + regressão. Verde → `regression_green` (fim). Vermelha → conta a tentativa;
 * ao atingir MAX_FIX_ATTEMPTS, HARD HALT em `architecture_review_required`; senão volta a
 * `hypothesis` para nova hipótese.
 */
export function recordRegression(inv, green) {
  if (inv.state !== "fix_applied") throw new Error(`recordRegression exige fix_applied (estado atual: ${inv.state})`)
  if (green === true) return advanceDebug(inv, "regression_green")
  inv.attempts += 1
  const halt = inv.attempts >= MAX_FIX_ATTEMPTS
  return advanceDebug(inv, halt ? "architecture_review_required" : "hypothesis", { regression: "red", attempts: inv.attempts })
}

export const isTerminal = (inv) => inv.state === "regression_green" || inv.state === "architecture_review_required"
