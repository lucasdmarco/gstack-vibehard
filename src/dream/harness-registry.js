/**
 * PRD46 S46.5 — registro CANÔNICO de harnesses/capacidades. O projeto já tinha
 * duas fontes independentes que descrevem harnesses: `HARNESS_CAPABILITIES`
 * (capabilities.js — trust/mode/hooks) e `ADAPTER_MATRIX` (adapter-matrix.js —
 * target/enforcement/instalação). Nunca foram cruzadas: esta é a checagem que
 * prova (ou reprova) que elas concordam sobre QUAIS harnesses existem.
 *
 * Docs/doctor/Agent Factory/adapters devem consultar `buildHarnessRegistry()` —
 * nunca inventar uma 3ª lista paralela de harnesses.
 */
import { HARNESS_CAPABILITIES } from "./capabilities.js"
import { ADAPTER_MATRIX } from "../agents/adapter-matrix.js"

export const HARNESS_REGISTRY_SCHEMA = "gstack.harness-registry.v1"

function driftStatusFor(id, inCapabilities, inAdapterMatrix) {
  if (inCapabilities && inAdapterMatrix) return "consistent"
  if (inCapabilities) return "capabilities_only"
  return "adapter_matrix_only"
}

/**
 * Une os dois registros por id de harness. Cada entrada declara `driftStatus`:
 * `consistent` (nas duas fontes), `capabilities_only` (capacidade declarada mas
 * sem adapter documentado) ou `adapter_matrix_only` (adapter existe mas
 * capacidade nunca foi declarada) — NUNCA silenciado, sempre visível.
 */
export function buildHarnessRegistry() {
  const ids = new Set([...Object.keys(HARNESS_CAPABILITIES), ...Object.keys(ADAPTER_MATRIX)])
  const harnesses = [...ids].sort().map((id) => {
    const cap = HARNESS_CAPABILITIES[id] || null
    const adapter = ADAPTER_MATRIX[id] || null
    return { id, capabilities: cap, adapter, driftStatus: driftStatusFor(id, !!cap, !!adapter) }
  })
  const drift = harnesses.filter((h) => h.driftStatus !== "consistent")
  return { schemaVersion: HARNESS_REGISTRY_SCHEMA, harnesses, driftCount: drift.length, drift }
}
