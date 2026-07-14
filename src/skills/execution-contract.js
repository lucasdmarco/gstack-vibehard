import { createHash } from "node:crypto"

/**
 * Skill Execution Contract (PRD42 S42.3). Uma skill não é "aplicada" porque foi SELECIONADA —
 * ela percorre um ciclo tipado `selected → loaded → applied → verified` (ou `failed`), e a
 * verificação é por HASH dos deliverables: se um deliverable prometido some ou muda depois do
 * `applied`, a verificação FALHA (mutation test embutido). Transição fora de ordem é fail-closed.
 *
 * Honestidade de enforcement (ligada ao S42.0A): só harness com `real_hooks` (Claude) consegue
 * BLOQUEAR de verdade; qualquer outro (instructional/rules_only/partial) é `advisory` — o contrato
 * registra isso, então nunca afirmamos enforcement que o harness não tem.
 *
 * PURO/testável: sem I/O; a camada de comando persiste o artefato.
 */
export const SKILL_EXECUTION_SCHEMA = "gstack.skill-execution.v1"
export const EXEC_STATES = Object.freeze(["selected", "loaded", "applied", "verified", "failed"])
const TRANSITIONS = Object.freeze({
  selected: ["loaded", "failed"],
  loaded: ["applied", "failed"],
  applied: ["verified", "failed"],
  verified: [],
  failed: [],
})

/** Hash determinístico do conteúdo de um deliverable (fonte da verdade da verificação). */
export const hashContent = (s) => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex")

/** Só `real_hooks` bloqueia; o resto é advisory (o contrato nunca mente sobre isso). */
export const enforcementFor = (harnessEnforcement) => (harnessEnforcement === "real_hooks" ? "enforced" : "advisory")

export function createExecutionContract({ skill, deliverables = [], harnessEnforcement = null } = {}) {
  return {
    schemaVersion: SKILL_EXECUTION_SCHEMA,
    skill,
    deliverables: [...deliverables],
    enforcement: enforcementFor(harnessEnforcement),
    state: "selected",
    applied: null,
    verification: null,
    history: [{ state: "selected", at: new Date().toISOString() }],
  }
}

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to)

/** Avança o estado do contrato. Transição inválida = erro tipado (fail-closed). */
export function advanceExecution(contract, to, evidence = null) {
  if (!canTransition(contract.state, to)) throw new Error(`invalid_transition: ${contract.state} -> ${to}`)
  contract.state = to
  contract.history.push({ state: to, at: new Date().toISOString(), ...(evidence ? { evidence } : {}) })
  return contract
}

/** `applied`: registra o hash de cada deliverable ENTREGUE (base p/ o mutation test do verify). */
export function recordApplied(contract, hashesByFile = {}) {
  advanceExecution(contract, "applied")
  contract.applied = { hashes: { ...hashesByFile }, at: new Date().toISOString() }
  return contract
}

// Verifica UM deliverable contra o hash registrado em applied. null = ok.
function verifyOne(file, appliedHash, currentHash) {
  if (!appliedHash) return { file, reason: "não registrado em applied" }
  if (!currentHash) return { file, reason: "deliverable ausente na verificação (mutation)" }
  if (currentHash !== appliedHash) return { file, reason: "conteúdo alterado após applied (hash diverge)" }
  return null
}

/**
 * `verified`: recomputa e confirma cada deliverable. Faltando ou hash divergente ⇒ falha
 * (mutation test). Vazio de deliverables NÃO é sucesso vazio: sem deliverable declarado o
 * contrato exige ao menos um (senão não há o que verificar) → falha honesta.
 */
export function verifyExecution(contract, currentHashes = {}) {
  const applied = (contract.applied && contract.applied.hashes) || {}
  const failures = contract.deliverables.map((f) => verifyOne(f, applied[f], currentHashes[f])).filter(Boolean)
  const empty = contract.deliverables.length === 0
  const ok = !empty && failures.length === 0
  contract.verification = { ok, empty, failures, at: new Date().toISOString() }
  advanceExecution(contract, ok ? "verified" : "failed")
  return contract
}

/**
 * Contratos (estado `selected`) para as skills de uma rota. `harnessEnforcement` decide o
 * enforcement honesto; default advisory (a CLI não bloqueia via hooks de outro harness).
 */
export function contractsForRoute(skillRoute, { harnessEnforcement = null, deliverablesBySkill = {} } = {}) {
  const skills = (skillRoute && skillRoute.selectedSkills) || []
  return skills.map((skill) => createExecutionContract({
    skill, harnessEnforcement, deliverables: deliverablesBySkill[skill] || [],
  }))
}
