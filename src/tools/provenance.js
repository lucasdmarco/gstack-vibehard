import { recordAction, readAllReceipts } from "../vfa/provenance.js"

/**
 * Provenance de decisões do catálogo de tools (PRD18 Sprint 8). Toda instalação
 * (ou recusa) de ferramenta REMOTA vira recibo encadeado — proof artifact do que
 * foi baixado/instalado, com origem e risco. Reusa a hash-chain do VFA.
 */

const TOOLS_RUN = "tools"

/** Grava a decisão de tool (install/skip/blocked). Best-effort — nunca lança. */
export function recordToolProvenance(cwd, { slug, origin = "unknown", decision = "install", risk = "?" } = {}) {
  try {
    return recordAction(cwd, {
      runId: TOOLS_RUN,
      intent: `tool:${decision}`,
      target: { kind: "tool", pathOrName: String(slug || "?").slice(0, 120) },
      policy: { decision: decision === "install" ? "allow" : "deny", rules: ["tool-catalog", origin, `risk:${risk}`] },
    })
  } catch { return null }
}

export function readToolProvenance(cwd) {
  return readAllReceipts(cwd).filter((r) => String(r.intent || "").startsWith("tool:"))
}
