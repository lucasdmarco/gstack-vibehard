import { readFileSync, existsSync } from "fs"
import { join } from "path"

/**
 * FastContext Confidence Gate (PRD28 28.9 + PRD32 §7 / PRD34 F3-D).
 *
 * O scout já dá confiança por resultado; aqui agregamos a confiança do CONTEXTO
 * e decidimos se vale enriquecer. Invariantes duras:
 *  - backend REMOTO é opt-in EXPLÍCITO (policy.allowRemote:true) — NUNCA default;
 *  - sem TTY em modo `ask`, NÃO decide sozinho → `needs_user_confirmation`;
 *  - nunca lê `.env*`, nunca extrai key, nunca registra MCP global.
 * PURO/testável.
 */

export const CONTEXT_POLICY_SCHEMA = "gstack.context-policy.v1"
export const CONTEXT_POLICIES = Object.freeze(["disabled", "ask", "project_auto", "local_only"])
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6

const defaultIo = Object.freeze({
  exists: existsSync,
  readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } },
})

/** Confiança agregada do contexto (média dos top-5 resultados). 0..1. */
export function aggregateConfidence(results = []) {
  if (!results.length) return 0
  const top = [...results].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 5)
  const sum = top.reduce((s, r) => s + (r.confidence || 0), 0)
  return Math.round((sum / top.length) * 100) / 100
}

/** Lê `.gstack/context-policy.json`. Default seguro: mode=ask, remoto DESLIGADO. */
export function loadContextPolicy(root, io = defaultIo) {
  const p = join(root, ".gstack", "context-policy.json")
  const raw = (io.exists(p) && io.readJson(p)) || {}
  const mode = CONTEXT_POLICIES.includes(raw.mode) ? raw.mode : "ask"
  return { schemaVersion: CONTEXT_POLICY_SCHEMA, mode, allowRemote: raw.allowRemote === true, remoteBackend: raw.remoteBackend || null }
}

// Decisão quando a confiança está baixa. REMOTO nunca entra aqui (opt-in explícito
// é resolvido fora, com allowRemote). Sem TTY em `ask` → confirmação, nunca chute.
function lowConfidenceDecision(policy, interactive, autoEnhance) {
  if (policy.mode === "project_auto" || policy.mode === "local_only") return { action: "local_enhance", reason: "enriquecimento LOCAL (sem rede)" }
  if (autoEnhance) return { action: "local_enhance", reason: "--auto-enhance: enriquecimento local" }
  if (!interactive) return { action: "needs_user_confirmation", reason: "confiança baixa e sem TTY — não decido sozinho" }
  return { action: "ask_user", reason: "perguntar ao usuário se/como enriquecer" }
}

/**
 * Resolve a ação de enriquecimento. Confiança suficiente → none; política disabled
 * → disabled; senão decisão local/ask (remoto sempre fora do caminho automático).
 */
export function resolveEnhancement({ confidence, policy, interactive = false, autoEnhance = false, threshold = DEFAULT_CONFIDENCE_THRESHOLD } = {}) {
  if (confidence >= threshold) return { action: "none", reason: `confiança ${confidence} ≥ ${threshold}`, confidence, threshold }
  if (policy.mode === "disabled") return { action: "disabled", reason: "FastContext desligado por política", confidence, threshold }
  return { ...lowConfidenceDecision(policy, interactive, autoEnhance), confidence, threshold }
}

/** Remoto só é permitido com opt-in explícito na política (nunca default). */
export function remoteAllowed(policy) {
  return policy.allowRemote === true && Boolean(policy.remoteBackend)
}
