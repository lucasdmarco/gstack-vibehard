import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { redactEvent } from "./redact-event.js"

/**
 * Journal por run em .gstack/workflows/runs/<runId>/journal.jsonl.
 *
 * Permite REPLAY: ao re-rodar um workflow após falha, nós já concluídos com
 * sucesso são pulados (journal_hit) — não se refaz trabalho. Guarda apenas
 * metadados/resumos (nunca secrets nem transcripts completos).
 */

export const EVENTS = ["node_started", "node_completed", "node_failed", "journal_hit", "run_started", "run_ended"]

function runDir(baseDir, runId) {
  return join(baseDir, runId)
}

function journalPath(baseDir, runId) {
  return join(runDir(baseDir, runId), "journal.jsonl")
}

/** Anexa um evento ao journal do run (cria dir se preciso). */
export function appendEvent(baseDir, runId, event) {
  const dir = runDir(baseDir, runId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // PRD45 S45.3 (P1.5): redação RECURSIVA antes de QUALQUER escrita — segredo em campo não
  // literal (task/summary/aninhado/URL) nunca chega ao disco. `ts` fica fora da varredura
  // (não é sensível e a chave não deve ser mascarada por nome).
  const rec = { ts: event.ts || new Date().toISOString(), ...redactEvent(event) }
  appendFileSync(journalPath(baseDir, runId), JSON.stringify(rec) + "\n", "utf-8")
  return rec
}

/** Lê todos os eventos do journal de um run. */
export function readJournal(baseDir, runId) {
  const p = journalPath(baseDir, runId)
  if (!existsSync(p)) return []
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

/** Set de nodeIds concluídos com sucesso (node_completed) num run. */
export function completedNodes(baseDir, runId) {
  const done = new Set()
  for (const ev of readJournal(baseDir, runId)) {
    if (ev.event === "node_completed" && ev.nodeId) done.add(ev.nodeId)
  }
  return done
}

/** True se o nó já foi concluído — base do replay (skip). */
export function isJournalHit(baseDir, runId, nodeId) {
  return completedNodes(baseDir, runId).has(nodeId)
}

/** Lista os runIds existentes (para observability). */
export function listRuns(baseDir) {
  if (!existsSync(baseDir)) return []
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

/** Estatísticas de um run (iterações, completes, fails, journal hits). */
export function runStats(baseDir, runId) {
  const evs = readJournal(baseDir, runId)
  const count = (e) => evs.filter((x) => x.event === e).length
  return {
    runId,
    events: evs.length,
    completed: count("node_completed"),
    failed: count("node_failed"),
    journalHits: count("journal_hit"),
    started: evs.find((e) => e.event === "run_started")?.ts || null,
    ended: evs.find((e) => e.event === "run_ended")?.ts || null,
  }
}
