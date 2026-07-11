import { ADAPTER_MATRIX, getAdapterInfo, isInstructional } from "../agents/adapter-matrix.js"
import { EVENTS, EVENT_DECLARATIONS, EVENT_LEVELS } from "./events.js"

/**
 * Conformance de hooks/eventos por harness (PRD18 Sprint 3). Regras:
 *  - harness INSTRUCIONAL nunca pode declarar evento `enforced` (claim proibida);
 *  - declaração deve ser coerente com o enforcement da adapter-matrix
 *    (matrix instructional/detection_only → nenhum enforced; rules_only → no máx partial);
 *  - todo evento do contrato deve estar declarado (ausente = drift);
 *  - nível fora do vocabulário = drift.
 * Determinístico e offline — a EVIDÊNCIA de instalação é papel do doctor/detector.
 */

const MAX_LEVEL_BY_ENFORCEMENT = Object.freeze({
  real_hooks: "enforced",
  partial: "partial",
  rules_only: "partial", // hook pontual real (ex.: cursor beforeShellExecution)
  instructional: "advisory",
  detection_only: "advisory",
})

const LEVEL_RANK = Object.freeze({ unsupported: 0, advisory: 1, partial: 2, enforced: 3 })

const forbid = (event, detail) => ({ event, kind: "forbidden_claim", detail })

// Regras de claim proibida (cada uma: retorna violação ou null). PRD36 36.2.
const CLAIM_RULES = Object.freeze([
  ({ level, maxLevel, enforcement, event }) =>
    LEVEL_RANK[level] > LEVEL_RANK[maxLevel] ? forbid(event, `matrix diz ${enforcement} (máx ${maxLevel}) mas declara ${level}`) : null,
  ({ level, harness, event }) =>
    isInstructional(harness) && level === "enforced" ? forbid(event, "harness instrucional NUNCA pode declarar enforced") : null,
  // tool.after roda DEPOIS da ação — não desfaz o que já rodou; enforced ali é desonesto.
  ({ level, event }) =>
    event === "tool.after" && level === "enforced" ? forbid(event, "tool.after é pós-ação: observa/roteia, não pode ser enforced") : null,
])

/** Violações de UM evento declarado (contra teto da matrix + regras de claim). */
function checkEvent(ctx) {
  const { event, level } = ctx
  if (level === undefined) return [{ event, kind: "missing_event", detail: "evento do contrato não declarado" }]
  if (!EVENT_LEVELS.includes(level)) return [{ event, kind: "invalid_level", detail: `nível desconhecido: ${level}` }]
  return CLAIM_RULES.map((rule) => rule(ctx)).filter(Boolean)
}

/** Violações de UMA declaração contra a matrix. */
export function checkDeclaration(harness, decl) {
  const { enforcement } = getAdapterInfo(harness)
  const maxLevel = MAX_LEVEL_BY_ENFORCEMENT[enforcement] || "advisory"
  return EVENTS.flatMap((event) => checkEvent({ event, level: decl.events?.[event], harness, enforcement, maxLevel }))
}

/**
 * Relatório completo: por harness da matrix, a declaração + violações + resumo.
 * Harness na matrix SEM declaração de eventos = drift (não pode ficar no vácuo).
 */
export function buildConformanceReport() {
  const harnesses = {}
  let totalViolations = 0
  for (const harness of Object.keys(ADAPTER_MATRIX)) {
    const info = getAdapterInfo(harness)
    const decl = EVENT_DECLARATIONS[harness]
    if (!decl) {
      harnesses[harness] = { enforcement: info.enforcement, declared: false, violations: [{ kind: "missing_declaration", detail: "harness na matrix sem declaração de eventos" }] }
      totalViolations++
      continue
    }
    const violations = checkDeclaration(harness, decl)
    totalViolations += violations.length
    const enforcedEvents = EVENTS.filter((e) => decl.events[e] === "enforced")
    harnesses[harness] = {
      enforcement: info.enforcement,
      declared: true,
      target: decl.target,
      residualRisk: decl.residualRisk,
      enforcedEvents,
      advisoryEvents: EVENTS.filter((e) => decl.events[e] === "advisory" || decl.events[e] === "partial"),
      violations,
    }
  }
  return {
    schemaVersion: "gstack.conformance.v1",
    events: [...EVENTS],
    harnesses,
    ok: totalViolations === 0,
    totalViolations,
    note: "declaração honesta do que existe HOJE; evidência de instalação é papel do doctor",
  }
}
