import { createHash } from "node:crypto"
import { costGateStatus } from "../skills/vendor-governance.js"

/**
 * Scroll World media budget (PRD49 S49.7).
 *
 * Gasto NUNCA é bypassável por `--yes` — reusa `costGateStatus` de
 * `vendor-governance.js` (S49.0), mesma invariante já testada (controle 4).
 * Caps de iteração e "1 provider por chain" são regras novas desta sprint.
 */
export const MEDIA_BUDGET_SCHEMA = "gstack.media-budget.v1"

/** Aritmética determinística — nunca estimativa vaga. */
export function estimateMediaCost({ stillCount = 0, videoCount = 0, stillUnitCost = 0, videoUnitCost = 0 } = {}) {
  return stillCount * stillUnitCost + videoCount * videoUnitCost
}

/** `--yes` NUNCA confirma gasto — delega ao mesmo gate real do S49.0. */
export function canProceedWithMediaSpend({ estimatedCost = 0, confirmed = false } = {}) {
  return costGateStatus({ estimatedCost, confirmed })
}

/** Cap de iteração fixo — nunca deixa rodar acima do limite declarado. */
export function enforceIterationCap({ attempted = 0, cap = 0 } = {}) {
  const ok = attempted <= cap
  return { ok, reason: ok ? null : "iteration_cap_exceeded" }
}

/** 1 provider/modelo por chain, a menos que uma recuperação documentada seja aprovada. */
export function oneProviderPerChain({ chainProviders = [], documentedRecovery = false } = {}) {
  const unique = new Set(chainProviders)
  const ok = unique.size <= 1 || documentedRecovery
  return { ok, reason: ok ? null : "multiple_providers_without_documented_recovery" }
}

const sha256 = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex")

/** Manifesto de mídia gerada — provider/promptHash/model/source/license/dimensões/fileHash. */
export function buildMediaManifestEntry({ provider, prompt, model, source, licenseNote, dimensions, fileContent }) {
  return {
    schemaVersion: MEDIA_BUDGET_SCHEMA,
    provider, model, source, licenseNote, dimensions,
    promptHash: sha256(Buffer.from(String(prompt || ""))),
    fileHash: sha256(Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(String(fileContent || ""))),
  }
}
