/**
 * Harness Skill Gate Projection (PRD29 29.6 / PRD34 F5-C).
 *
 * O mesmo skill-gate NÃO é imposto igual em todo harness. Honestidade de enforcement:
 *  - gate advisory                      → sempre `advisory` (registra/explica, não trava);
 *  - gate blocking em evento SHIP        → `enforced` em todo harness (a CLI roda
 *    verify/proof independentemente do harness);
 *  - gate blocking em evento PRE-WRITE   → `enforced` só onde o harness intercepta a
 *    escrita (hook pre-tool); sem hook, `advisory` — a CLI ainda gateia quando o fluxo
 *    passa por ela, mas o harness não bloqueia a escrita em tempo real;
 *  - harness desconhecido                → `unsupported`.
 *
 * Declara o REAL — nunca finge que um advisory bloqueia. PURO/testável.
 */

export const HARNESS_GATE_PROJECTION_SCHEMA = "gstack.harness-gate-projection.v1"
export const ENFORCEMENT_LEVELS = Object.freeze(["enforced", "advisory", "unsupported"])

// Suporte REAL de bloqueio pre-tool por harness (o que existe hoje no produto):
// só o Claude tem hook pre_tool_use que NEGA a ação; os demais são advisory.
const HARNESS_HOOK_SUPPORT = Object.freeze({
  claude: { preToolBlock: true },
  codex: { preToolBlock: false },
  opencode: { preToolBlock: false },
  cursor: { preToolBlock: false },
})

export const KNOWN_HARNESSES = Object.freeze(Object.keys(HARNESS_HOOK_SUPPORT))

// Evento em que o gate incide, derivado do fallback declarado na matriz.
// SHIP = imposto pela CLI (verify/proof/delegate) → independe do harness.
// PRE-WRITE = precisa interceptar a escrita → depende de hook pre-tool.
const SHIP_FALLBACKS = Object.freeze(["block_before_ship", "block_before_delegate"])

/** "ship" | "pre-write" — quando o gate realmente incide. */
export function gateEvent(gate) {
  return SHIP_FALLBACKS.includes(gate.fallback) ? "ship" : "pre-write"
}

/** Nível de enforcement REAL de um gate num harness. */
export function projectGate(gate, harness) {
  const support = HARNESS_HOOK_SUPPORT[harness]
  if (!support) return "unsupported"
  if (gate.mode !== "blocking") return "advisory"
  if (gateEvent(gate) === "ship") return "enforced"
  return support.preToolBlock ? "enforced" : "advisory"
}

/** Matriz gate × harness com o nível REAL de enforcement. */
export function buildHarnessProjection(gates = [], harnesses = KNOWN_HARNESSES) {
  const matrix = {}
  for (const h of harnesses) {
    matrix[h] = gates.map((g) => ({ gate: g.id, mode: g.mode, event: gateEvent(g), level: projectGate(g, h) }))
  }
  return {
    schemaVersion: HARNESS_GATE_PROJECTION_SCHEMA,
    generatedAt: new Date().toISOString(),
    harnesses: [...harnesses],
    matrix,
    note: "honesto: 'enforced' em SHIP vale em todo harness (CLI); em PRE-WRITE só onde há hook pre-tool; senão 'advisory'.",
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
    "🔒 enforced (harness/CLI bloqueia) · 📎 advisory (registra, não trava) · — unsupported.", "",
    projection.note, "",
  ].join("\n")
}
