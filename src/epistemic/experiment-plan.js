import { createHash } from "node:crypto"

/**
 * Plano de experimento (PRD50 S50.4, §12.3) — a ponte Knowledge → Execution.
 *
 * `research validate` é camada Knowledge: **nunca executa nada**. Ele só produz
 * este plano IMUTÁVEL, que a camada Execution (`workflow`/`task`) consome em
 * worktree/sandbox, sob policy, VFA provenance, Evidence Ledger e gates.
 *
 * Por isso este módulo NÃO exporta runner algum — há um teste que falha se
 * alguém adicionar `run`/`exec`/`spawn` aqui. O firewall é estrutural.
 *
 * E o resultado que volta é rotulado: mil casos passando é
 * `supported_within_scope`, jamais `proved` (amostragem finita não demonstra
 * afirmação universal, §2.2). Um contraexemplo, esse sim, refuta de verdade.
 */
export const EXPERIMENT_PLAN_SCHEMA = "gstack.experiment-plan.v1"

const MAX_TIMEOUT_MS = 600000 // 10 min — teto de recurso
const SHELL_METACHARS = /[;&|`$><\n\r]|\$\(|\.\./

/** Monta o plano. `executable` + `args` (array) — nunca uma string de shell. */
export function buildExperimentPlan({
  claim = "", property = "", executable = "", args = [],
  fixtures = [], timeoutMs = 30000, allowedPaths = [], expected = "", network = false,
} = {}) {
  return {
    schemaVersion: EXPERIMENT_PLAN_SCHEMA,
    claim, property, executable, args: [...args], fixtures: [...fixtures],
    timeoutMs, allowedPaths: [...allowedPaths], expected,
    network,
    // Proibições fixas do §12.3 — parte do plano, não convenção do chamador.
    forbidden: Object.freeze(["leitura de .env*", "acesso a rede sem autorização", "paths fora de allowedPaths"]),
  }
}

const ENV_PATH = /(^|[\\/])\.env($|[.\\/])/i
const ABSOLUTE_PATH = /^([\\/]|[A-Za-z]:)/
const TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/

// Cada regra devolve razão quando VIOLADA. Fail-closed por construção.
const PLAN_RULES = Object.freeze([
  { check: (p) => !p.executable || SHELL_METACHARS.test(p.executable), reason: () => "executable vazio ou com metacaractere de shell" },
  { check: (p) => (p.args || []).some((a) => SHELL_METACHARS.test(String(a))), reason: () => "arg com metacaractere de shell (tentativa de injeção)" },
  { check: (p) => (p.allowedPaths || []).some((x) => ENV_PATH.test(String(x))), reason: () => ".env* nunca é permitido (§12.3)" },
  { check: (p) => (p.allowedPaths || []).some((x) => ABSOLUTE_PATH.test(String(x))), reason: () => "path absoluto não é permitido" },
  { check: (p) => (p.allowedPaths || []).some((x) => TRAVERSAL.test(String(x))), reason: () => "path com travessia (../) não é permitido" },
  { check: (p) => !(p.timeoutMs > 0 && p.timeoutMs <= MAX_TIMEOUT_MS), reason: () => `timeoutMs deve ser > 0 e <= ${MAX_TIMEOUT_MS}` },
  { check: (p) => p.network === true, reason: () => "rede é proibida no plano por default — exige autorização explícita fora dele" },
])

/** Valida o plano. → { ok, reasons }. */
export function validateExperimentPlan(plan) {
  if (!plan || typeof plan !== "object") return { ok: false, reasons: ["plano ausente"] }
  const reasons = PLAN_RULES.filter((r) => r.check(plan)).map((r) => r.reason(plan))
  return { ok: reasons.length === 0, reasons }
}

const stable = (p) => JSON.stringify({
  claim: p.claim, property: p.property, executable: p.executable, args: p.args,
  fixtures: p.fixtures, timeoutMs: p.timeoutMs, allowedPaths: p.allowedPaths,
  expected: p.expected, network: p.network,
})

/** Hash determinístico do plano — é o que Execution confere antes de rodar. */
export function planHash(plan) {
  return "sha256:" + createHash("sha256").update(stable(plan)).digest("hex")
}

/** Execution nunca aceita plano adulterado depois de assinado. */
export function planWasTampered(plan, expectedHash) {
  return planHash(plan) !== expectedHash
}

/**
 * Rotula o resultado que volta da Execution. Amostragem finita passando é
 * suporte DENTRO DO ESCOPO; um contraexemplo é refutação conclusiva.
 */
export function labelExperimentResult({ passed = false, casesRun = 0, claim = "", counterexample = null } = {}) {
  if (!passed) {
    return {
      status: "refuted_by_counterexample", conclusive: true, counterexample,
      scopeNote: `contraexemplo encontrado em ${casesRun} caso(s) — refuta a afirmação "${claim}"`,
    }
  }
  return {
    status: "supported_within_scope", conclusive: false, counterexample: null,
    scopeNote: `${casesRun} caso(s) executado(s) passaram — não demonstra a afirmação geral "${claim}" (amostragem finita)`,
  }
}
