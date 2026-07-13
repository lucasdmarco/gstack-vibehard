/**
 * Gate Registry central (PRD41 S41.5 / PRD40 P1.2).
 *
 * Antes, o `proof` decidia ad-hoc quais checagens BLOQUEIAM. Agora há um registro único
 * onde CADA gate declara seu contrato: id/version/severity/aplicabilidade/chave de
 * evidência/comportamento em tool-missing/controle-negativo. O `proof` consome ISTO para
 * montar blockers×warnings — a severidade (hard×advisory) vive no contrato, não no código
 * do proof. `negativeControl` documenta o teste que PROVA o enforcement (o que tem que
 * reprovar se o gate for removido) — é o elo com a conformance por caminho (P1.3).
 */
export const GATE_REGISTRY_SCHEMA = "gstack.gate-registry.v1"

export const REQUIRED_GATE_FIELDS = Object.freeze([
  "id", "version", "severity", "appliesTo", "evidenceKey", "toolMissing", "negativeControl",
])

// `hard` bloqueia o proof; `advisory` só avisa (nunca reprova — ex.: Headroom routing).
export const PROOF_GATES = Object.freeze([
  { id: "verify", version: 1, severity: "hard", appliesTo: "all", evidenceKey: "verify",
    toolMissing: "block", negativeControl: "verify.status != ready → ready:false" },
  { id: "dream-audit", version: 1, severity: "hard", appliesTo: ["release", "full"], evidenceKey: "dreamAudit",
    toolMissing: "block", negativeControl: "claim sem evidência/adapter → dream reprova" },
  { id: "graphify-freshness", version: 1, severity: "hard", appliesTo: "all", evidenceKey: "graphifyFreshness",
    toolMissing: "warn", negativeControl: "grafo stale/ausente → blocker" },
  { id: "git-tree", version: 1, severity: "hard", appliesTo: "all", evidenceKey: "gitTree",
    toolMissing: "block", negativeControl: "árvore suja → blocker" },
  { id: "skill-gates", version: 1, severity: "hard", appliesTo: "all", evidenceKey: "skillGates",
    toolMissing: "warn", negativeControl: "gate pendente enforced → blocker" },
  { id: "tool-readiness", version: 1, severity: "advisory", appliesTo: "all", evidenceKey: "toolReadiness",
    toolMissing: "warn", negativeControl: "ferramenta ausente → warning (nunca bloqueia)" },
  { id: "headroom-routing", version: 1, severity: "advisory", appliesTo: "all", evidenceKey: "headroomRouting",
    toolMissing: "warn", negativeControl: "callable_not_routed → warning, nunca economia alegada" },
])

/** Um gate se aplica ao profile? `"all"` sempre; senão a lista precisa conter o profile. */
export function gateApplies(gate, profile) {
  return gate.appliesTo === "all" || (Array.isArray(gate.appliesTo) && gate.appliesTo.includes(profile))
}

/** Contrato completo? (todos os campos obrigatórios presentes). */
export function validateGateContract(gate) {
  const missing = REQUIRED_GATE_FIELDS.filter((f) => gate[f] === undefined || gate[f] === null)
  const badSeverity = gate.severity !== "hard" && gate.severity !== "advisory"
  return { ok: missing.length === 0 && !badSeverity, missing, badSeverity }
}

export function buildGateRegistry(gates = PROOF_GATES) {
  return {
    schemaVersion: GATE_REGISTRY_SCHEMA,
    gates: gates.map((g) => ({ ...g })),
    contractOk: gates.every((g) => validateGateContract(g).ok),
  }
}

/**
 * Resolve blockers×warnings PELO registry. Cada gate aplicável lê `checks[evidenceKey]`:
 * um `.blocker` num gate `hard` vira blocker; num gate `advisory` é REBAIXADO a warning
 * (advisory nunca reprova). `.warning` sempre entra como aviso. É o que o `proof` chama.
 */
export function resolveGateOutcomes({ profile, checks = {}, gates = PROOF_GATES }) {
  const blockers = []
  const warnings = []
  for (const g of gates) {
    if (gateApplies(g, profile)) applyGateOutcome(g, checks[g.evidenceKey] || {}, blockers, warnings)
  }
  return { blockers, warnings }
}

/** Um `.blocker` em gate `hard` bloqueia; em `advisory` é rebaixado a warning. `.warning`
 * sempre entra como aviso. Muta as listas (chamado só pelo resolveGateOutcomes). */
function applyGateOutcome(gate, check, blockers, warnings) {
  if (check.blocker) (gate.severity === "hard" ? blockers : warnings).push(check.blocker)
  if (check.warning) warnings.push(check.warning)
}
