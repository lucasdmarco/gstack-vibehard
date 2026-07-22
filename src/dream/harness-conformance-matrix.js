/**
 * PRD47 S47.10 — matriz PÚBLICA de conformance por harness. Projeta os vocabulários
 * internos já reais (`ADAPTER_MATRIX` em `agents/adapter-matrix.js`, unidos por
 * `buildHarnessRegistry()` do PRD46 S46.5) na taxonomia PÚBLICA de 5 valores que os
 * claims do produto usam — nunca inventa um 3º vocabulário paralelo, só traduz.
 *
 * Honestidade dupla: (1) `instructional`/`detection_only`/`partial` NUNCA viram
 * enforcement público (harness instrucional não é Zero-Trust — mesma regra do
 * `adapter-matrix.js`); (2) um harness só recebe nível público diferente de
 * `not_tested` quando `testedHarnesses` o declara EXPLICITAMENTE — claim público
 * limitado ao que foi medido nesta sessão, nunca presumido pelo enforcement interno.
 */
import { buildHarnessRegistry } from "./harness-registry.js"

export const CONFORMANCE_MATRIX_SCHEMA = "gstack.harness-conformance-matrix.v1"
export const PUBLIC_ENFORCEMENT_LEVELS = Object.freeze([
  "native_enforced", "adapter_enforced", "instructional_advisory", "unsupported", "not_tested",
])

const INTERNAL_TO_PUBLIC = Object.freeze({
  real_hooks: "native_enforced",
  partial: "adapter_enforced",
  rules_only: "adapter_enforced",
  instructional: "instructional_advisory",
  detection_only: "unsupported",
})

/**
 * Traduz o enforcement INTERNO (fato auditado do adapter, PRD46 S46.5) pro nível público —
 * SEM o gate de `testedHarnesses`. Uso: perguntar "este harness bloqueia de fato?" sobre um
 * adapter concreto (ex.: onboarding do PRD48 S48.1). Para CLAIMS PÚBLICOS/docs, use
 * `buildConformanceMatrix` (exige `testedHarnesses` — claim limitado ao medido).
 */
export function publicLevelFor(adapter) {
  if (!adapter || !adapter.enforcement) return "not_tested"
  return INTERNAL_TO_PUBLIC[adapter.enforcement] || "not_tested"
}

/**
 * Projeta a matriz pública a partir do registro canônico. `testedHarnesses` é uma
 * lista EXPLÍCITA (injetada pelo caller) dos harnesses com fixture/teste real
 * executado — sem isso, todo harness fica `not_tested`, mesmo com enforcement
 * interno forte.
 */
export function buildConformanceMatrix({ registry = buildHarnessRegistry(), testedHarnesses = [] } = {}) {
  const tested = new Set(testedHarnesses)
  const harnesses = registry.harnesses.map((h) => ({
    id: h.id,
    publicLevel: tested.has(h.id) ? publicLevelFor(h.adapter) : "not_tested",
    internalEnforcement: h.adapter?.enforcement || null,
    driftStatus: h.driftStatus,
  }))
  return { schemaVersion: CONFORMANCE_MATRIX_SCHEMA, harnesses, driftCount: registry.driftCount }
}
