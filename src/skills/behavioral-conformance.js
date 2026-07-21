import { evaluatePreWriteGate } from "./design-system.js"
import { createExecutionContract, advanceExecution, recordApplied, verifyExecution, hashContent } from "./execution-contract.js"

/**
 * Behavioral Conformance (PRD42 S42.4). Uma skill P0 não é "confiável" porque existe — ela precisa
 * se comportar. Cada skill P0 tem um cenário RED/GREEN/REFACTOR exercitando o SEU verificador real
 * contra fixtures sintéticas determinísticas:
 *   • RED      — diante de uma violação, a skill DEVE reprovar/bloquear.
 *   • GREEN    — diante do estado correto, DEVE liberar.
 *   • REFACTOR — mudança de forma preserva o comportamento (invariante).
 *
 * O runner é BOUNDED (maxMs/maxTurns). Quando um cenário não produz decisão dentro dos limites,
 * o veredito é `inconclusive` — que NUNCA conta como verde (precedência: nonconformant > inconclusive
 * > conformant). PURO/testável: sem LLM, sem I/O real (io das skills é injetado nas fixtures).
 */
export const CONFORMANCE_SCHEMA = "gstack.behavioral-conformance.v1"
export const CONFORMANCE_VERDICTS = Object.freeze(["conformant", "nonconformant", "inconclusive"])
export const CONFORMANCE_PHASES = Object.freeze(["red", "green", "refactor"])
export const DEFAULT_BOUNDS = Object.freeze({ maxTurns: 3, maxMs: 5000 })

function scenarioOutcome(r, elapsedMs, bounds) {
  const res = r || {}
  if (res.inconclusive) return { verdict: "inconclusive", reason: res.reason || "sem decisão" }
  if (elapsedMs > bounds.maxMs) return { verdict: "inconclusive", reason: "excedeu maxMs" }
  return { verdict: res.pass ? "pass" : "fail" }
}

// Executa UM cenário. run() → {pass} | {inconclusive,reason}. Erro/timeout → inconclusive (nunca verde).
function evalScenario(sc, bounds) {
  const started = Date.now()
  try {
    return { phase: sc.phase, ...scenarioOutcome(sc.run(), Date.now() - started, bounds) }
  } catch (e) {
    return { phase: sc.phase, verdict: "inconclusive", reason: `erro: ${e.message}` }
  }
}

/** Precedência: uma fase reprovada → nonconformant; senão inconclusive domina conformant. */
export function aggregateVerdict(phases) {
  if (phases.some((p) => p.verdict === "fail")) return "nonconformant"
  if (phases.some((p) => p.verdict === "inconclusive")) return "inconclusive"
  return "conformant"
}

export function runConformance(spec, bounds = DEFAULT_BOUNDS) {
  const phases = spec.scenarios.map((sc) => evalScenario(sc, bounds))
  return { schema: CONFORMANCE_SCHEMA, skill: spec.skill, priority: spec.priority || "P0", verdict: aggregateVerdict(phases), phases }
}

/** Release: só ready se TODA skill P0 é `conformant` (inconclusive/nonconformant bloqueiam). */
export function aggregateRelease(reports) {
  const blocked = reports.filter((r) => r.verdict !== "conformant")
  return { schema: CONFORMANCE_SCHEMA, ready: blocked.length === 0, blocked: blocked.map((r) => ({ skill: r.skill, verdict: r.verdict })), reports }
}

// ── Specs P0 (fixtures sintéticas sobre os verificadores REAIS) ───────────────────
const dsIo = (ds) => ({ exists: () => true, readJson: () => ds, writeJson: () => {} })
const dsBlocked = (ds) => evaluatePreWriteGate({ root: "/x", uiIntended: true, io: dsIo(ds) }).blocked

function designSystemSpec() {
  return {
    skill: "design-system", priority: "P0",
    scenarios: [
      { phase: "red", run: () => ({ pass: dsBlocked({ schemaVersion: "gstack.design-system.v2", status: "generated", tokens: { colors: {}, typography: {} } }) === true }) },
      { phase: "green", run: () => ({ pass: dsBlocked({ schemaVersion: "gstack.design-system.v2", status: "generated", direction: "Dark minimal", tokens: { colors: { p: "#000" }, typography: { b: "Inter" } } }) === false }) },
      { phase: "refactor", run: () => ({ pass: dsBlocked({ schemaVersion: "gstack.design-system.v1", engine: "custom", path: "ds/", status: "complete" }) === false }) },
    ],
  }
}

function execContractSpec() {
  const build = () => { const c = createExecutionContract({ skill: "x", deliverables: ["a"] }); advanceExecution(c, "loaded"); return c }
  return {
    skill: "skill-execution", priority: "P0",
    scenarios: [
      { phase: "red", run: () => { const c = build(); recordApplied(c, { a: hashContent("1") }); verifyExecution(c, {}); return { pass: c.verification.ok === false } } },
      { phase: "green", run: () => { const c = build(); const h = hashContent("1"); recordApplied(c, { a: h }); verifyExecution(c, { a: h }); return { pass: c.verification.ok === true } } },
      { phase: "refactor", run: () => { const c = createExecutionContract({ skill: "x", deliverables: ["a"] }); try { advanceExecution(c, "verified"); return { pass: false } } catch { return { pass: true } } } },
    ],
  }
}

/** Specs de conformance das skills P0 (comportamento MEDIDO, não declarado). */
export function p0ConformanceSpecs() {
  return [designSystemSpec(), execContractSpec()]
}

/** Roda todas as specs P0 e agrega o veredito de release. */
export function runP0Conformance(bounds = DEFAULT_BOUNDS) {
  return aggregateRelease(p0ConformanceSpecs().map((s) => runConformance(s, bounds)))
}

// ── Conformance de skill APRENDIDA (PRD46 S46.5) ─────────────────────────────
// Uma skill promovida do pipeline dream não tem verificador próprio — o
// comportamento a provar é ATIVAÇÃO: dispara nos casos positivos, NUNCA nos
// negativos. "red" aqui = casos negativos que NÃO podem ativar (violação =
// ativar); "green" = casos positivos que DEVEM ativar; "refactor" = invariante
// de que o candidato tem cobertura real dos dois lados (sem isso, nunca conformant).
const matchesTrigger = (triggerTokens, text) => triggerTokens.some((t) => String(text || "").toLowerCase().includes(String(t).toLowerCase()))

/** Monta a spec de conformance de ativação para uma skill aprendida e promovida. */
export function learnedSkillActivationSpec({ id, triggerTokens = [], positiveCases = [], negativeCases = [] } = {}) {
  const activates = (text) => matchesTrigger(triggerTokens, text)
  return {
    skill: id, priority: "P1",
    scenarios: [
      { phase: "red", run: () => ({ pass: negativeCases.every((c) => !activates(c)) }) },
      { phase: "green", run: () => ({ pass: positiveCases.every((c) => activates(c)) }) },
      { phase: "refactor", run: () => ({ pass: positiveCases.length > 0 && negativeCases.length > 0 }) },
    ],
  }
}

/** Roda a conformance de ativação de UMA skill aprendida. */
export function evaluateLearnedSkillActivation(spec, bounds = DEFAULT_BOUNDS) {
  return runConformance(learnedSkillActivationSpec(spec), bounds)
}
