import { redactSecrets } from "../security/redact.js"

/**
 * NotebookLM experimental research connector (PRD49 S49.9).
 *
 * Conector cloud OPCIONAL e experimental — nunca vira memória automática,
 * nunca gate de release, nunca claim de "local"/"grátis". `connect` é SEMPRE
 * interativo (nunca bypassável por `--yes`). Falhas de schema/quota/auth
 * degradam honestamente (`degraded_external_service`), nunca travam nem
 * fingem sucesso. Resultado importado exige citação de fonte + aprovação
 * explícita — nunca é absorvido silenciosamente na memória local.
 */
export const NOTEBOOKLM_ADAPTER_SCHEMA = "gstack.notebooklm-adapter.v1"

/** `connect` é SEMPRE interativo — `--yes` nunca escondeu isso e nunca vai. */
export function resolveConnectMode() {
  return "interactive_required"
}

const KNOWN_FAILURE_KINDS = new Set(["schema", "quota", "auth"])

/** Falha real (schema/quota/auth ou desconhecida) -> degrada honestamente, nunca crasha/finge sucesso. */
export function classifyNotebookLMFailure({ kind } = {}) {
  return { status: "degraded_external_service", category: KNOWN_FAILURE_KINDS.has(kind) ? kind : "unknown" }
}

/** Resultado importado exige citação de fonte E aprovação explícita do usuário. */
export function validateImportRequiresCitationAndApproval({ result = {}, approved = false } = {}) {
  const hasCitations = Array.isArray(result.sourceCitations) && result.sourceCitations.length > 0
  if (!hasCitations) return { ok: false, reason: "missing_source_citations" }
  if (!approved) return { ok: false, reason: "missing_user_approval" }
  return { ok: true }
}

// Nunca implementado, nunca habilitado — importação automática de cookie de
// browser é uma classe de risco que este adapter nunca suporta.
export const AUTO_COOKIE_IMPORT_ENABLED = false

/** Caminho de código que NÃO existe de propósito — sempre recusa. */
export function attemptAutomaticCookieImport() {
  return { ok: false, reason: "automatic_cookie_import_never_supported" }
}

const AUTH_STATE_PATTERNS = [/cookie\s*=\s*[^\s;]+/gi, /session_token\s*=\s*[^\s;]+/gi, /auth_state\s*=\s*[^\s;]+/gi]

/** Nunca loga estado de auth — reusa redactSecrets (genérico) + padrões de auth específicos. */
export function redactAuthLog(text) {
  let out = redactSecrets(text).redacted
  for (const rx of AUTH_STATE_PATTERNS) out = out.replace(rx, "***REDACTED***")
  return out
}

/** Sem ambiente Python pinado configurado -> not_configured honesto, nunca finge conectado. */
export function doctorStatus({ probe } = {}) {
  const res = probe ? probe() : { ok: false }
  return { schemaVersion: NOTEBOOKLM_ADAPTER_SCHEMA, status: res.ok ? "callable" : "not_configured" }
}
