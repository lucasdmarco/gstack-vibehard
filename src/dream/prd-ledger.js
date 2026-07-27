import { readFileSync, existsSync } from "fs"
import { createHash } from "crypto"
import { join } from "path"
import { buildReleaseBaseline, canRenderAsComplete } from "../release/baseline.js"

/**
 * Ledger unificado de PRDs (PRD51 S51.3, §3). Cada checklist `rc-checklist-prdXX.js`
 * já rastreia itens `{id, status, proof}` com semânticas próprias e inconsistentes
 * entre programas. Este módulo PROJETA qualquer checklist no schema comum já
 * estabelecido por `release/baseline.js` (S51.0B/C) — reusa `buildReleaseBaseline`
 * inteiro, não duplica a lógica dos 4 estados que não se implicam.
 *
 * Ação #4 do PRD51 (§S51.3): `status:"delivered"` sem arquivo de prova existente
 * em disco é uma VIOLAÇÃO que derruba `releaseReady`/`programComplete` — nunca um
 * aviso ignorável.
 */
export const PRD_LEDGER_SCHEMA = "gstack.prd-ledger.v1"

/** sha256 real do arquivo de prova — null honesto se ausente, nunca inventado. */
export function evidenceHash(repoRoot, proofPath) {
  if (!proofPath) return null
  const abs = join(repoRoot, proofPath)
  if (!existsSync(abs)) return null
  return `sha256:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`
}

/** Evidência auditável por item com `proof` — hash real, não afirmação. */
export function evidenceForItems(items, repoRoot) {
  return items.filter((i) => i.proof).map((i) => ({ id: i.id, proof: i.proof, hash: evidenceHash(repoRoot, i.proof) }))
}

/** `delivered` sem prova em disco — a violação que a ação #4 proíbe. */
export function violationsOf(items, repoRoot) {
  return items
    .filter((i) => i.status === "delivered" && i.proof && !existsSync(join(repoRoot, i.proof)))
    .map((i) => ({ id: i.id, reason: `status delivered sem prova em disco: ${i.proof}` }))
}

/**
 * Projeta o checklist de UM programa no schema comum. `operational`/
 * `humanValidation` são específicos de cada programa e opcionais — sem eles,
 * `operationallyProven`/`fullyValidated` ficam honestamente `false` (nunca
 * inferidos por omissão, mesma disciplina do builder reusado).
 */
export function projectPrdLedger({
  prdId, items = [], repoRoot, commit = null, proof = {}, operational = {}, humanValidation = {},
} = {}) {
  const violations = violationsOf(items, repoRoot)
  const honest = violations.length === 0
  const baseline = buildReleaseBaseline({ commit, proof, programItems: items, flake: operational, humanValidation })
  return {
    ...baseline,
    schemaVersion: PRD_LEDGER_SCHEMA,
    prdId,
    releaseReady: baseline.releaseReady && honest,
    programComplete: baseline.programComplete && honest,
    completeVerdict: canRenderAsComplete(baseline),
    evidence: evidenceForItems(items, repoRoot),
    violations,
  }
}
