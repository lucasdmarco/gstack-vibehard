import { getAdapterInfo } from "../agents/adapter-matrix.js"
import { enforcementFor } from "../skills/execution-contract.js"
import { LEVELS, EPISTEMIC_REVIEW_SCHEMA } from "./schema.js"

/**
 * Projeção do contrato epistêmico por harness (PRD50 S50.5, §5.4).
 *
 * Dois eixos que não se misturam:
 *  - **contrato entregue**: todo harness conhecido recebe o MESMO texto
 *    canônico (`core/03-verificacao-epistemica.md`) e o MESMO schema;
 *  - **enforcement**: só quem tem `real_hooks` bloqueia de verdade. O resto é
 *    `advisory`, e isso é dito — nunca se afirma enforcement que o harness não
 *    tem (reusa `enforcementFor` do execution-contract, não duplica a regra).
 *
 * Harness desconhecido não recebe projeção e nunca sai como `enforced`.
 */
export const EPISTEMIC_PROJECTION_SCHEMA = "gstack.epistemic-harness-projection.v1"

/** Campos que TODA saída epistêmica deve carregar, em qualquer harness. */
export const REQUIRED_OUTPUT_FIELDS = Object.freeze([
  "level", "claims", "verdict", "notPerformed", "protocol",
])

/** → { schemaVersion, harness, contractDelivered, enforcement, levels, reviewSchema, requiredOutputFields }. */
export function epistemicContractProjection(harness) {
  const info = getAdapterInfo(harness)
  // `getAdapterInfo` devolve a linha `unsupported` para harness desconhecido.
  const known = info && info.state !== "unsupported"
  return {
    schemaVersion: EPISTEMIC_PROJECTION_SCHEMA,
    harness,
    contractDelivered: Boolean(known),
    enforcement: known ? enforcementFor(info.enforcement) : "advisory",
    levels: [...LEVELS],
    reviewSchema: EPISTEMIC_REVIEW_SCHEMA,
    requiredOutputFields: [...REQUIRED_OUTPUT_FIELDS],
    contractSource: "core/03-verificacao-epistemica.md",
  }
}
