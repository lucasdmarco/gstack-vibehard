import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { redactSecrets } from "../security/redact.js"

/**
 * Evidence Task Ledger (PRD18 Sprint 4) — `no proof, no done`.
 *
 * Cada etapa de uma task grava um recibo em `.gstack/tasks/<taskId>/evidence.jsonl`
 * com objetivo/ação/comando/resultado/evidência/status. Regra dura:
 *  - só uma FONTE determinística (gate/test/build/verify/command) pode marcar
 *    `proved`; LLM/review vira `advisory` (registrado, NUNCA conta como prova);
 *  - nenhuma task fica `complete` sem ao menos uma prova e sem nada `failed`/`pending`;
 *  - secrets são redigidos e valores longos truncados — o ledger nunca vaza segredo.
 */

export const EVIDENCE_STATUS = Object.freeze(["proved", "failed", "pending", "not_applicable", "advisory"])
// Fontes que PODEM provar. Qualquer outra (llm/review) é rebaixada a advisory.
export const PROVING_SOURCES = Object.freeze(["gate", "test", "build", "verify", "command"])
// Etapas provadas/neutras não são retomadas; failed/pending sim.
export const SKIP_STATUSES = Object.freeze(new Set(["proved", "not_applicable", "advisory"]))

export function taskDir(cwd, taskId) { return join(cwd, ".gstack", "tasks", taskId) }
export function evidencePath(cwd, taskId) { return join(taskDir(cwd, taskId), "evidence.jsonl") }
export function taskMdPath(cwd, taskId) { return join(taskDir(cwd, taskId), "TASK.md") }

const MAX_FIELD = 400
function clean(v) {
  if (v == null) return ""
  const s = typeof v === "string" ? v : JSON.stringify(v)
  const { redacted } = redactSecrets(s)
  return redacted.length > MAX_FIELD ? redacted.slice(0, MAX_FIELD) + "…[truncado]" : redacted
}

/** Coage o status conforme a fonte: só PROVING_SOURCES prova. Fora do vocabulário → pending. */
export function resolveStatus({ source = "unknown", status = "pending" } = {}) {
  if (status === "proved" && !PROVING_SOURCES.includes(source)) return "advisory"
  return EVIDENCE_STATUS.includes(status) ? status : "pending"
}

/** Grava um recibo de evidência (sanitizado). @returns o registro gravado. */
export function recordEvidence(cwd, taskId, entry = {}) {
  const rec = {
    ts: new Date().toISOString(),
    step: clean(entry.step || entry.objective || "?"),
    objective: clean(entry.objective),
    action: clean(entry.action),
    command: clean(entry.command),
    result: clean(entry.result),
    evidence: clean(entry.evidence),
    source: entry.source || "unknown",
    status: resolveStatus(entry),
  }
  const dir = taskDir(cwd, taskId)
  mkdirSync(dir, { recursive: true })
  appendFileSync(evidencePath(cwd, taskId), JSON.stringify(rec) + "\n")
  return rec
}

export function readEvidence(cwd, taskId) {
  const p = evidencePath(cwd, taskId)
  if (!existsSync(p)) return []
  return readFileSync(p, "utf-8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

/** Último recibo por etapa (re-execução: o último vence). */
export function latestByStep(entries) {
  const map = new Map()
  for (const e of entries) map.set(e.step, e)
  return [...map.values()]
}

/** `no proof, no done`: precisa de ≥1 prova e nada failed/pending. advisory é neutro. */
export function taskComplete(entries) {
  const latest = latestByStep(entries)
  if (!latest.length) return false
  const hasProof = latest.some((e) => e.status === "proved")
  const blocked = latest.some((e) => e.status === "failed" || e.status === "pending")
  return hasProof && !blocked
}

export function evidenceSummary(entries) {
  const latest = latestByStep(entries)
  const by = { proved: 0, failed: 0, pending: 0, not_applicable: 0, advisory: 0 }
  for (const e of latest) if (e.status in by) by[e.status]++
  return { steps: latest.length, ...by, complete: taskComplete(entries) }
}

/** Linha de uma etapa no TASK.md. */
function stepLine(e) {
  const detail = e.result || e.action || ""
  const cmd = e.command ? ` (\`${e.command}\`)` : ""
  return `- [${e.status}] **${e.step}** — ${detail}${cmd}`
}

/** TASK.md legível (espelho humano do evidence.jsonl). Sem secrets (já redigido). */
export function renderTaskMd({ taskId, objective, entries }) {
  const s = evidenceSummary(entries)
  const state = s.complete ? "**COMPLETE** (com prova)" : "**INCOMPLETO** — no proof, no done"
  return [
    `# Task ${taskId}`, "",
    `- objetivo: ${objective || "(sem objetivo)"}`,
    `- provado: ${s.proved} · falhou: ${s.failed} · pendente: ${s.pending} · n/a: ${s.not_applicable} · advisory: ${s.advisory}`,
    `- estado: ${state}`,
    "", "## Evidência por etapa",
    ...latestByStep(entries).map(stepLine),
  ].join("\n") + "\n"
}

/** Escreve/atualiza o TASK.md do ledger. */
export function writeTaskMd(cwd, taskId, objective) {
  const md = renderTaskMd({ taskId, objective, entries: readEvidence(cwd, taskId) })
  mkdirSync(taskDir(cwd, taskId), { recursive: true })
  writeFileSync(taskMdPath(cwd, taskId), md)
  return md
}
