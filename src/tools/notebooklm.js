import {
  NOTEBOOKLM_ADAPTER_SCHEMA, resolveConnectMode, classifyNotebookLMFailure,
  validateImportRequiresCitationAndApproval, doctorStatus,
} from "../research/notebooklm-adapter.js"

/**
 * NotebookLM CLI-facing wrapper (PRD49 S49.9). Delega toda a lógica ao
 * adapter puro (`src/research/notebooklm-adapter.js`) — este módulo só monta
 * os payloads de resposta do comando `research notebooklm`.
 */
export function notebookLmDoctor(deps = {}) {
  return doctorStatus({ probe: deps.probe || (() => ({ ok: false })) })
}

/** `connect` é sempre interativo — este comando nunca completa uma conexão sozinho. */
export function notebookLmConnect() {
  return {
    schemaVersion: NOTEBOOKLM_ADAPTER_SCHEMA,
    mode: resolveConnectMode(),
    message: "Conexão com NotebookLM exige um passo interativo real (login/consentimento) — não pode ser automatizado nem escondido por --yes.",
  }
}

/** Query experimental — sem ambiente Python real pinado, sempre degrada honestamente. */
export function notebookLmQuery({ notebookId, question, deps = {} } = {}) {
  if (!deps.transport) return classifyNotebookLMFailure({ kind: "auth" })
  try {
    return deps.transport({ notebookId, question })
  } catch {
    return classifyNotebookLMFailure({ kind: "unknown" })
  }
}

/** Import exige citação de fonte + aprovação explícita — nunca silenciosamente absorvido. */
export function notebookLmImport({ result, approved, to } = {}) {
  const v = validateImportRequiresCitationAndApproval({ result, approved })
  if (!v.ok) return { ok: false, reason: v.reason }
  if (!["context", "obsidian"].includes(to)) return { ok: false, reason: "invalid_import_target" }
  return { ok: true, to, sourceCitations: result.sourceCitations }
}
