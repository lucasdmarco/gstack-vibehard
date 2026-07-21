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

const NOT_RUN = Object.freeze({ ran: false, state: "not_run" })
const orNull = (v) => v ?? null
const defaultRefresh = (r) => r || NOT_RUN
const defaultProof = (p) => p || NOT_RUN
const defaultLearning = (l) => l || { candidate: null }

export function buildCloseout({ runId, command, status, changed = [], toolsRefresh = null, proof = null, learning = null } = {}) {
  const refresh = defaultRefresh(toolsRefresh)
  return {
    schemaVersion: CLOSEOUT_SCHEMA, generatedAt: new Date().toISOString(),
    runId: orNull(runId), command: orNull(command), status: status ?? "unknown",
    changedFiles: [...changed],
    toolsRefresh: refresh,
    fresh: isFresh(refresh),
    proof: defaultProof(proof),
    learning: defaultLearning(learning),
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
const errorMessage = (e) => (e && e.message ? e.message : String(e))
const bestEffortError = (e) => ({ ran: true, state: "degraded", error: errorMessage(e) })
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

// PRD46 S46.2: detecção de golden path é OPCIONAL, best-effort e bounded a UM
// candidate — nunca esconde erro (degrada pra `candidate:null`), nunca lança.
function safeDetect(detect, cwd, runId, status, changed) {
  if (!detect) return { candidate: null }
  try {
    const r = detect({ cwd, runId, status, changed }) || {}
    return { candidate: r.candidate || null }
  } catch (e) {
    return { candidate: null, error: errorMessage(e) }
  }
}

/** Fecha o run: grava closeout.{json,md}, sincroniza ferramentas, roda proof (sucesso)
 * e detecta golden path (bounded, nunca promove — só observa). */
export function runCloseoutSync({ cwd, runId, command, status, changed = [], refresh = null, proof = null, detect = null, io = defaultIo } = {}) {
  const toolsRefresh = safeRefresh(refresh, cwd, changed)
  const proofResult = safeAutoProof(proof, status, cwd)
  const learning = safeDetect(detect, cwd, runId, status, changed)
  const closeout = buildCloseout({ runId, command, status, changed, toolsRefresh, proof: proofResult, learning })
  const dir = join(cwd, ".gstack", "runs", runId || "adhoc")
  io.write(join(dir, "closeout.json"), JSON.stringify(closeout, null, 2) + "\n")
  io.write(join(dir, "closeout.md"), renderCloseoutMarkdown(closeout))
  return closeout
}
