/**
 * Placar vivo do dream audit (PRD51 S51.0A, achado 4.3).
 *
 * O README publicado na v5.56.0 fixou "hoje 20 REAL / 1 PARTIAL / 0 RISK" — um
 * número histórico apresentado como estado atual, quando o auditor do commit
 * retorna 4 REAL / 20 NOT_PROVED. Este módulo torna o placar DERIVADO do
 * auditor real, com proveniência (commit/data), para que documentação e CI
 * mostrem o estado do commit, nunca um número solto.
 *
 * Invariante: NOT_PROVED nunca é somado a REAL. O placar honesto MOSTRA os
 * NOT_PROVED — não os esconde nem os promove.
 */
export const DREAM_SCOREBOARD_SCHEMA = "gstack.dream-scoreboard.v1"

// Ordem de exibição: primeiro o que foi provado, depois o que falta. NOT_PROVED
// aparece explicitamente — é o ponto do achado 4.3.
const DISPLAY_ORDER = Object.freeze(["REAL", "PARTIAL", "NOT_PROVED", "ROADMAP", "PLACEBO", "RISK"])

const num = (v) => (Number.isFinite(v) ? v : 0)

/** Monta o placar a partir de um summary de contagens + proveniência opcional. */
export function buildDreamScoreboard(summary = {}, provenance = {}) {
  const counts = {}
  for (const k of DISPLAY_ORDER) counts[k] = num(summary[k])
  const line = DISPLAY_ORDER.filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${k}`).join(" / ") || "0 REAL"
  return {
    schemaVersion: DREAM_SCOREBOARD_SCHEMA,
    counts,
    line,
    provenance: {
      commit: provenance.commit || null,
      generatedAt: provenance.generatedAt || new Date().toISOString().slice(0, 10),
    },
  }
}

/** Consome o resultado do `audit()` real e devolve o placar honesto com proveniência. */
export function scoreboardFromAudit(auditResult = {}) {
  const summary = auditResult.summary || {}
  const commit = auditResult.scope ? auditResult.scope.headCommit || auditResult.scope.commit || null : null
  return buildDreamScoreboard(summary, { commit })
}

/** Render markdown de uma linha — o que docs/CI inserem, sempre com proveniência. */
export function renderScoreboardLine(board) {
  const prov = board.provenance.commit ? ` (commit ${board.provenance.commit.slice(0, 7)}, ${board.provenance.generatedAt})` : ` (${board.provenance.generatedAt})`
  return `dream audit${prov}: ${board.line}`
}
