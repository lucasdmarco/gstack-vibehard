import { gateEvent, gateTruth, truthLevel, verifyProvedBy, TRUTH_HARNESSES } from "./gate-truth.js"

/**
 * Harness Skill Gate Projection (PRD29 29.6 / PRD34 F5-C / PRD36 36.0).
 *
 * DERIVA de `gate-truth.js` (fonte única dos 5 estados). Honestidade:
 *  - gate advisory → sempre `advisory`;
 *  - gate blocking só é `enforced` com implementação + bloqueio real no harness
 *    + TESTE NEGATIVO verificado (executed && blocking && proved) — a versão
 *    anterior marcava todo pre-write como enforced no Claude sem provar cada
 *    gate; esse claim foi removido (PRD36 36.0);
 *  - harness desconhecido → `unsupported`.
 */

export const HARNESS_GATE_PROJECTION_SCHEMA = "gstack.harness-gate-projection.v1"
export const ENFORCEMENT_LEVELS = Object.freeze(["enforced", "advisory", "unsupported"])
export const KNOWN_HARNESSES = TRUTH_HARNESSES

export { gateEvent }

/** Nível de enforcement REAL de um gate num harness (derivado dos 5 estados). */
export function projectGate(gate, harness, io = undefined) {
  const { proved } = verifyProvedBy(gate, io)
  return truthLevel(gate, harness, gateTruth(gate, harness, proved))
}

/** Matriz gate × harness com o nível REAL de enforcement. */
export function buildHarnessProjection(gates = [], harnesses = KNOWN_HARNESSES, io = undefined) {
  const matrix = {}
  for (const h of harnesses) {
    matrix[h] = gates.map((g) => ({ gate: g.id, mode: g.mode, event: gateEvent(g), level: projectGate(g, h, io) }))
  }
  return {
    schemaVersion: HARNESS_GATE_PROJECTION_SCHEMA,
    generatedAt: new Date().toISOString(),
    harnesses: [...harnesses],
    matrix,
    note: "honesto: 'enforced' SÓ com implementação + bloqueio real no harness + teste negativo verificado (gate-truth); senão 'advisory'.",
  }
}

/** Resumo por harness (quantos enforced/advisory/unsupported). */
export function projectionSummary(projection) {
  const out = {}
  for (const [h, rows] of Object.entries(projection.matrix)) {
    out[h] = { enforced: 0, advisory: 0, unsupported: 0 }
    for (const r of rows) out[h][r.level]++
  }
  return out
}

const LEVEL_ICON = Object.freeze({ enforced: "🔒", advisory: "📎", unsupported: "—" })

/** Render markdown da projeção (linha por gate, coluna por harness). */
export function renderHarnessProjectionMarkdown(projection) {
  const gates = (projection.matrix[projection.harnesses[0]] || []).map((r) => r.gate)
  const header = ["| Gate | Evento |", ...projection.harnesses.map((h) => ` ${h} |`)].join("")
  const sep = ["|---|---|", ...projection.harnesses.map(() => "---|")].join("")
  const rows = gates.map((gate, i) => {
    const event = projection.matrix[projection.harnesses[0]][i].event
    const cells = projection.harnesses.map((h) => ` ${LEVEL_ICON[projection.matrix[h][i].level]} ${projection.matrix[h][i].level} |`)
    return `| ${gate} | ${event} |${cells.join("")}`
  })
  return [
    `# Harness Skill Gate Projection — enforcement REAL por harness`, "",
    `Gerado: ${projection.generatedAt} · schema ${projection.schemaVersion}`, "",
    header, sep, ...rows, "",
    "🔒 enforced (implementado + bloqueia + teste negativo) · 📎 advisory (registra, não trava) · — unsupported.", "",
    projection.note, "",
  ].join("\n")
}
