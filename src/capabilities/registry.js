/**
 * Registro canônico de capacidades (PRD42 §5.11 / S42.0B). Governa (fonte única) o que cada
 * MODO materializa e o suporte HONESTO por plataforma. Backends que exigem Docker/daemon são
 * `wsl_only` no Windows nativo (sem prova WSL) e ficam `not_proved` até o E2E de backend
 * (S42.0D). Em LITE todo backend do Full é `excluded` (nenhum arquivo/processo/claim).
 */
import { CAPABILITY_CONTRACT_SCHEMA, gradeCapabilityClaim } from "./contract.js"

const BACKENDS = Object.freeze({
  casdoor:     { platformSupport: { linux: "supported", macos: "supported", windows: "wsl_only" }, enforcement: "adapter_enforced" },
  atomic:      { platformSupport: { linux: "supported", macos: "supported", windows: "wsl_only" }, enforcement: "none" },
  agentmemory: { platformSupport: { linux: "supported", macos: "supported", windows: "wsl_only" }, enforcement: "none" },
  openhands:   { platformSupport: { linux: "supported", macos: "untested", windows: "wsl_only" }, enforcement: "none" },
})

export const CAPABILITY_IDS = Object.freeze(Object.keys(BACKENDS))

const emptyEvidence = () => ({ adapter: null, probe: null, negativeControl: null, artifactHash: null, freshAt: null })
// Obrigação por MODO: Lite exclui backend Full; Full o exige (é o produto anunciado — só
// vira opcional por ADR, nunca por teste conveniente).
const obligationFor = (mode) => (mode === "lite" ? "excluded" : "required")

/** Contrato canônico de um backend resolvido para o `mode` (lite|full). null se desconhecido. */
export function contractFor(id, mode = "full") {
  const b = BACKENDS[id]
  if (!b) return null
  const obligation = obligationFor(mode)
  const base = {
    schemaVersion: CAPABILITY_CONTRACT_SCHEMA, component: id, mode, obligation,
    installState: "absent",
    runtimeState: obligation === "excluded" ? "unsupported" : "not_started",
    enforcement: b.enforcement, platformSupport: b.platformSupport,
    evidence: emptyEvidence(), platform: "linux",
  }
  return { ...base, claim: gradeCapabilityClaim(base) }
}

/** Todos os contratos do modo (útil p/ doctor/proof/dream declararem a verdade por modo). */
export function contractsForMode(mode = "full") {
  return CAPABILITY_IDS.map((id) => contractFor(id, mode))
}
