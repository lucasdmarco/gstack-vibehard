import { recordEvidence, readEvidence, taskComplete, evidenceSummary, writeTaskMd } from "./evidence-ledger.js"
import { resumeIndex, shouldStop, stepKey, DEFAULT_HARD_CAP } from "./stopping-rules.js"
import { writeTaskHandoff } from "./journal.js"

/**
 * Evidence Task Loop (PRD18 Sprint 4). Roda uma lista de passos contra o evidence
 * ledger com RETOMADA (pula o que já foi provado) e HARD CAP (para em handoff,
 * nunca loop zumbi). `runStep` é injetável — o executor real (dev/test/verify) ou
 * um stub de teste. Cada passo vira um recibo; só prova determinística conclui.
 * (Distinto do `runTaskLoop` de worktree em task-loop.js — este é o loop de EVIDÊNCIA.)
 *
 *   runStep({ step, index, cwd, taskId }) →
 *     { status, source, objective?, action?, command?, result?, evidence?, files?, resumable? }
 */

/** Grava o recibo do passo (status já coagido pela regra de fonte). */
function recordStep(cwd, taskId, step, r) {
  return recordEvidence(cwd, taskId, {
    step: stepKey(step),
    objective: r.objective || (typeof step === "object" ? step.label : step),
    action: r.action, command: r.command, result: r.result, evidence: r.evidence,
    source: r.source, status: r.status,
  })
}

/**
 * Motivo para parar APÓS um passo ("" = continua). Um passo `failed` SEMPRE
 * interrompe o run (não dá pra construir sobre um passo quebrado): `blocked` se
 * não for retomável, senão `failed` (a retomada volta nesse passo depois).
 */
function stopAfter(rec, r, attempts, hardCap) {
  if (rec.status === "failed") {
    const d = shouldStop({ attempts, hardCap, lastStatus: "failed", resumable: r.resumable !== false })
    return d.reason || "failed"
  }
  return shouldStop({ attempts, hardCap }).stop ? "hard_cap" : ""
}

/** Fecha o loop: TASK.md sempre; handoff.md só quando não concluiu. */
function finalize(cwd, taskId, objective, attempts, reason, files) {
  writeTaskMd(cwd, taskId, objective)
  const entries = readEvidence(cwd, taskId)
  const summary = evidenceSummary(entries)
  if (taskComplete(entries)) return { taskId, status: "complete", attempts, summary }
  const handoffPath = writeTaskHandoff(cwd, taskId, { objective, entries, attempts, reason: reason || "incompleto", files })
  return { taskId, status: "handoff", attempts, reason: reason || "incompleto", summary, handoffPath }
}

function addFiles(set, files) { for (const f of files || []) set.add(f) }
// No último passo, o hard cap não força handoff (não há passo a retomar depois).
function capFor(i, len, hardCap) { return i < len - 1 ? hardCap : Infinity }

/** Executa um passo e grava o recibo. @returns { r, rec }. */
function execStep(cwd, taskId, step, index, runStep) {
  const r = runStep({ step, index, cwd, taskId }) || { status: "pending", source: "unknown" }
  return { r, rec: recordStep(cwd, taskId, step, r) }
}

export function runEvidenceLoop({ cwd, taskId, objective, steps = [], runStep, hardCap = DEFAULT_HARD_CAP }) {
  if (typeof runStep !== "function") throw new Error("runEvidenceLoop: runStep é obrigatório")
  const start = resumeIndex(steps, readEvidence(cwd, taskId))
  if (start === -1) return finalize(cwd, taskId, objective, 0, "", []) // tudo já provado/neutro
  const files = new Set()
  let attempts = 0
  let reason = ""
  for (let i = start; i < steps.length; i++) {
    attempts++
    const { r, rec } = execStep(cwd, taskId, steps[i], i, runStep)
    addFiles(files, r.files)
    reason = stopAfter(rec, r, attempts, capFor(i, steps.length, hardCap))
    if (reason) break
  }
  return finalize(cwd, taskId, objective, attempts, reason, [...files])
}
