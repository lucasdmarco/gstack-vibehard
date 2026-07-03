import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { taskDir, latestByStep, evidenceSummary } from "./evidence-ledger.js"

/**
 * Journal de execução de plano (append-only JSONL) em
 * .gstack/plans/<planId>/journal.jsonl. Espelha a disciplina do workflow journal:
 * só RESUMO vai pro disco — NUNCA output bruto de comando nem secrets (PRD §15).
 */

export function journalPath(planDir) {
  return join(planDir, "journal.jsonl")
}

export function appendPlanEvent(planDir, event) {
  mkdirSync(planDir, { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n"
  appendFileSync(journalPath(planDir), line)
}

export function readPlanJournal(planDir) {
  const p = journalPath(planDir)
  if (!existsSync(p)) return []
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

/** Conjunto de stepIds com evento step_completed (para replay/retomada). */
export function completedSteps(planDir) {
  const done = new Set()
  for (const e of readPlanJournal(planDir)) {
    if (e.event === "step_completed" && e.stepId) done.add(e.stepId)
  }
  return done
}

// ── Handoff humano de uma Task (PRD18 Sprint 4) ─────────────────────────────
// O evidence.jsonl é o journal; aqui geramos o resumo acionável quando o loop
// para sem concluir: erros persistentes, pendências e arquivos tocados — sem
// secrets (os recibos já vêm redigidos).

/** Bloco `## Título` + lista; vazio → nada. */
function mdSection(title, items) {
  return items.length ? [`## ${title}`, ...items, ""] : []
}

/** Recibos (último por etapa) com um dado status. */
function stepsWithStatus(entries, status) {
  return latestByStep(entries).filter((e) => e.status === status)
}

export function renderTaskHandoff({ taskId, objective, entries, attempts, reason, files = [] }) {
  const s = evidenceSummary(entries)
  const failed = stepsWithStatus(entries, "failed").map((e) => `- ${e.step}: ${e.result || e.evidence || "(sem detalhe)"}`)
  const pending = stepsWithStatus(entries, "pending").map((e) => `- ${e.step}`)
  const lines = [
    `# Handoff — task ${taskId}`, "",
    `- objetivo: ${objective || "(sem objetivo)"}`,
    `- motivo da parada: **${reason || "incompleto"}**`,
    `- tentativas: ${attempts}`,
    `- provado: ${s.proved} · falhou: ${s.failed} · pendente: ${s.pending} · advisory: ${s.advisory}`,
    "",
    ...mdSection("Erros persistentes", failed),
    ...mdSection("Ainda pendente", pending),
    ...mdSection("Arquivos tocados", files.map((f) => `- ${f}`)),
    "## Próximos passos",
    `1. Revise a evidência: .gstack/tasks/${taskId}/evidence.jsonl`,
    `2. Corrija a causa e retome: \`gstack_vibehard task resume ${taskId}\``,
    "3. `no proof, no done`: só COMPLETA com prova determinística (gate/test/verify).",
  ]
  return lines.join("\n") + "\n"
}

export function writeTaskHandoff(cwd, taskId, meta) {
  const md = renderTaskHandoff({ taskId, ...meta })
  const dir = taskDir(cwd, taskId)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, "handoff.md")
  writeFileSync(p, md)
  return p
}
