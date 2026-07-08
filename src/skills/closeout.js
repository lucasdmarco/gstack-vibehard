import { writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"

/**
 * Run Closeout Sync (PRD28 28.7 + PRD32 §6 / PRD34 F4-A).
 *
 * Helper ÚNICO de fechamento de run — adotado por start/delegate/workflow/
 * orchestrate/task/dream/verify/proof. Grava `closeout.{json,md}` e (opcional)
 * dispara um refresh BOUNDED das ferramentas. best-effort: o refresh NUNCA esconde
 * falha — se quebrar, marca `degraded` honesto (não finge que atualizou). PURO/testável.
 */

export const CLOSEOUT_SCHEMA = "gstack.closeout.v1"

export function buildCloseout({ runId, command, status, changed = [], toolsRefresh = null } = {}) {
  return {
    schemaVersion: CLOSEOUT_SCHEMA, generatedAt: new Date().toISOString(),
    runId: runId ?? null, command: command ?? null, status: status ?? "unknown",
    changedFiles: [...changed],
    toolsRefresh: toolsRefresh || { ran: false, state: "not_run" },
  }
}

export function renderCloseoutMarkdown(c) {
  return [
    `# Closeout — ${c.command || "run"} ${c.runId || ""}`.trim(), "",
    `Status: ${c.status} · ${c.generatedAt}`, "",
    `Arquivos alterados: ${c.changedFiles.length}`,
    ...c.changedFiles.slice(0, 20).map((f) => `- ${f}`),
    "", `Tools refresh: ${c.toolsRefresh.state}${c.toolsRefresh.error ? ` (${c.toolsRefresh.error})` : ""}`, "",
  ].join("\n")
}

const defaultIo = Object.freeze({
  write: (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s) },
})

const normalizeRefresh = (r) => (r ? { ran: true, state: r.state || "ok", ...r } : { ran: true, state: "ok" })
const refreshError = (e) => ({ ran: true, state: "degraded", error: e && e.message ? e.message : String(e) })
// Refresh bounded best-effort: falha vira `degraded` (nunca esconde), nunca lança.
function safeRefresh(refresh, cwd, changed) {
  if (!refresh) return { ran: false, state: "not_run" }
  try { return normalizeRefresh(refresh({ cwd, changed })) }
  catch (e) { return refreshError(e) }
}

/** Fecha o run: grava closeout.{json,md} e sincroniza ferramentas (bounded). */
export function runCloseoutSync({ cwd, runId, command, status, changed = [], refresh = null, io = defaultIo } = {}) {
  const toolsRefresh = safeRefresh(refresh, cwd, changed)
  const closeout = buildCloseout({ runId, command, status, changed, toolsRefresh })
  const dir = join(cwd, ".gstack", "runs", runId || "adhoc")
  io.write(join(dir, "closeout.json"), JSON.stringify(closeout, null, 2) + "\n")
  io.write(join(dir, "closeout.md"), renderCloseoutMarkdown(closeout))
  return closeout
}
