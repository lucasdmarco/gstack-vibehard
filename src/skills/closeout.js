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

// PRD41 S41.9 (P1.8): `fresh` só é verdade se o refresh RODOU e ficou ok. Um refresh que
// falhou/degradou REMOVE o claim de frescor (o trabalho não se perde, mas não se finge que
// readiness/contexto foram atualizados). Transacional: sem prova, sem claim.
const isFresh = (r) => r.ran === true && r.state === "ok"

export function buildCloseout({ runId, command, status, changed = [], toolsRefresh = null, proof = null } = {}) {
  const refresh = toolsRefresh || { ran: false, state: "not_run" }
  return {
    schemaVersion: CLOSEOUT_SCHEMA, generatedAt: new Date().toISOString(),
    runId: runId ?? null, command: command ?? null, status: status ?? "unknown",
    changedFiles: [...changed],
    toolsRefresh: refresh,
    fresh: isFresh(refresh),
    proof: proof || { ran: false, state: "not_run" },
  }
}

const nBlockers = (p) => (p.blockers ? p.blockers.length : 0)
const PROOF_LINE = Object.freeze({
  not_run: () => "Proof: não rodou (encerramento sem sucesso ou sem runner)",
  skipped_not_success: () => "Proof: não rodou (encerramento sem sucesso ou sem runner)",
  degraded: (p) => `Proof: degraded (${p.error || "erro"})`,
  ran: (p) => `Proof: ready=${p.ready}${nBlockers(p) ? ` — blockers: ${nBlockers(p)}` : ""}`,
})
const proofLine = (p) => (PROOF_LINE[p && p.state] || PROOF_LINE.not_run)(p || {})

export function renderCloseoutMarkdown(c) {
  return [
    `# Closeout — ${c.command || "run"} ${c.runId || ""}`.trim(), "",
    `Status: ${c.status} · ${c.generatedAt}`, "",
    `Arquivos alterados: ${c.changedFiles.length}`,
    ...c.changedFiles.slice(0, 20).map((f) => `- ${f}`),
    "", `Tools refresh: ${c.toolsRefresh.state}${c.toolsRefresh.error ? ` (${c.toolsRefresh.error})` : ""}`,
    proofLine(c.proof), "",
  ].join("\n")
}

const defaultIo = Object.freeze({
  write: (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s) },
})

const normalizeRefresh = (r) => (r ? { ran: true, state: r.state || "ok", ...r } : { ran: true, state: "ok" })
const bestEffortError = (e) => ({ ran: true, state: "degraded", error: e && e.message ? e.message : String(e) })
// Refresh bounded best-effort: falha vira `degraded` (nunca esconde), nunca lança.
function safeRefresh(refresh, cwd, changed) {
  if (!refresh) return { ran: false, state: "not_run" }
  try { return normalizeRefresh(refresh({ cwd, changed })) }
  catch (e) { return bestEffortError(e) }
}

// Status de encerramento considerados SUCESSO (rodam o proof automático).
const SUCCESS_STATUSES = Object.freeze(["done", "ready", "success", "completed"])

/**
 * Proof automático no encerramento (PRD36 36.10): SÓ em sucesso e SÓ se houver
 * runner injetado. best-effort: erro vira `degraded` (nunca esconde), nunca lança.
 * Não roda em run que parou/handoff — proof num run falho seria ruído.
 */
function safeAutoProof(proof, status, cwd) {
  if (!proof) return { ran: false, state: "not_run" }
  if (!SUCCESS_STATUSES.includes(status)) return { ran: false, state: "skipped_not_success" }
  try {
    const r = proof({ cwd }) || {}
    return { ran: true, state: "ran", ready: r.ready === true, blockers: r.blockers || [] }
  } catch (e) { return bestEffortError(e) }
}

/** Fecha o run: grava closeout.{json,md}, sincroniza ferramentas E roda proof (sucesso). */
export function runCloseoutSync({ cwd, runId, command, status, changed = [], refresh = null, proof = null, io = defaultIo } = {}) {
  const toolsRefresh = safeRefresh(refresh, cwd, changed)
  const proofResult = safeAutoProof(proof, status, cwd)
  const closeout = buildCloseout({ runId, command, status, changed, toolsRefresh, proof: proofResult })
  const dir = join(cwd, ".gstack", "runs", runId || "adhoc")
  io.write(join(dir, "closeout.json"), JSON.stringify(closeout, null, 2) + "\n")
  io.write(join(dir, "closeout.md"), renderCloseoutMarkdown(closeout))
  return closeout
}
