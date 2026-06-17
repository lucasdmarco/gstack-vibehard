import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs"
import { join } from "path"

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
