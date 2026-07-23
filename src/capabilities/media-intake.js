import { createHash } from "node:crypto"

/**
 * Unified media-intake router (PRD49 S49.8).
 *
 * Evita pipelines de vídeo duplicados e minimiza tokens de frame. Default é
 * transcript/captions primeiro; frames só quando timestamp visual é
 * necessário, sempre com janela focada + dedupe + cap conservador. Nunca
 * seleciona um backend "token-burner". Credenciais de provider, se algum dia
 * forem necessárias, resolvem via `src/secrets/broker.js` — nunca inline.
 */
export const MEDIA_INTAKE_SCHEMA = "gstack.media-intake-router.v1"

export const DISALLOWED_BACKENDS = Object.freeze(["token-burner"])

const CONSERVATIVE_FRAME_CAP = 20

/** Cap fixo — nunca escala linearmente com a duração do vídeo. */
export function boundedFrameBudget({ durationSeconds = 0, cap = CONSERVATIVE_FRAME_CAP } = {}) {
  const naive = Math.ceil(durationSeconds / 30) // 1 frame a cada ~30s, antes do cap
  return Math.min(naive, cap)
}

/** transcript/captions primeiro; frames só quando timestamp visual é necessário. */
export function selectMediaBackend({ captionsAvailable, visualTimestampNeeded, durationSeconds = 0 } = {}) {
  if (visualTimestampNeeded) {
    return { backend: "frames", frameBudget: boundedFrameBudget({ durationSeconds, cap: CONSERVATIVE_FRAME_CAP }) }
  }
  return { backend: "transcript", frameBudget: 0 }
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

/** Dedupe por hash de conteúdo — frames idênticos contam 1x. */
export function dedupeFrames(frames = []) {
  const seen = new Set()
  const out = []
  for (const f of frames) {
    const h = sha256(Buffer.isBuffer(f) ? f : Buffer.from(String(f)))
    if (seen.has(h)) continue
    seen.add(h)
    out.push(f)
  }
  return out
}

/** Fonte remota (URL) exige consentimento explícito; arquivo local nunca precisa. */
export function requiresNetworkConsent({ sourceType }) {
  return sourceType === "url"
}

/** Nunca baixa uma URL sem consentimento explícito do usuário. */
export function canIngestSource({ sourceType, consented = false } = {}) {
  if (requiresNetworkConsent({ sourceType }) && !consented) return { ok: false, reason: "network_consent_required" }
  return { ok: true }
}

/** Política de retenção de arquivo temporário — declarada, nunca implícita. */
export function temporaryFileDisposition({ retain = false } = {}) {
  return retain ? "retain_per_policy" : "delete_after_processing"
}

/** Registra a decisão com TODA a evidência de roteamento do DoD — nunca decide silenciosamente. */
export function routeMediaIntake(evidence = {}) {
  const { backend, frameBudget } = selectMediaBackend(evidence)
  return {
    schemaVersion: MEDIA_INTAKE_SCHEMA,
    sourceType: evidence.sourceType,
    questionType: evidence.questionType,
    captionsAvailable: evidence.captionsAvailable,
    visualTimestampNeeded: evidence.visualTimestampNeeded,
    durationSeconds: evidence.durationSeconds,
    projectedTextTokens: evidence.projectedTextTokens,
    projectedFrameTokens: evidence.projectedFrameTokens,
    network: evidence.network,
    retention: evidence.retention,
    selectedBackend: backend,
    frameBudget,
  }
}
