import { existsSync } from "fs"
import { readRun, listRuns, verifyRun, provenanceDir } from "../vfa/provenance.js"
import { readHarnessEvents } from "../harness/events.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `gstack_vibehard audit <status|inspect|verify|export|events|doctor>` — inspeciona
 * o provenance log (VFA, §10.3) e o event ledger (PRD18 Sprint 3). `verify`
 * recomputa a HASH-CHAIN e falha (exit 1) se algum recibo foi adulterado.
 */
export function auditCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const positional = args.filter((a) => !a.startsWith("-"))
  const sub = positional[0] || "status"
  const handler = AUDIT_SUBS[sub]
  if (handler) return handler(cwd, positional[1], args, json)
  warn(`Subcomando desconhecido: ${sub}`)
  info("  Use: audit <status|inspect|verify|export|events|doctor>")
}

/** `--limit N` do ledger (default 30, ignora valor inválido). */
function eventsLimit(args) {
  const raw = args[args.indexOf("--limit") + 1]
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 30
}

/** Event ledger local (.gstack/events/events.jsonl) — sem secrets, só resumo. */
function eventsCmd(cwd, args, json) {
  const events = readHarnessEvents(cwd, { limit: eventsLimit(args) })
  if (json) { process.stdout.write(JSON.stringify({ events }) + "\n"); return { events } }
  section("audit events — ledger local (sanitizado)")
  if (!events.length) { info("  (sem eventos — produtores: pretool challenge, delegates)"); return { events } }
  for (const e of events) info(`  • ${e.ts} ${e.event} [${e.harness}] ${e.intent || ""} ${e.decision ? `→ ${e.decision}` : ""}`)
  return { events }
}

function statusCmd(cwd, json) {
  const runs = listRuns(cwd)
  if (json) { process.stdout.write(JSON.stringify({ runs }) + "\n"); return }
  section("audit status — provenance")
  if (!runs.length) { info("  (sem provenance neste projeto)"); return }
  for (const r of runs) info(`  • ${r.runId}: ${r.count} ação(ões) · até ${r.last}`)
}

const allValid = (results) => results.length === 0 || results.every((r) => r.valid)
const verifyLine = (r) => `  ${r.valid ? "✓" : "✗"} ${r.runId}: ${r.valid ? `cadeia íntegra (${r.length} recibos)` : `${r.reason} @${r.brokenAt}`}`
function renderVerifyResults(results) {
  for (const r of results) (r.valid ? success : error)(verifyLine(r))
}
function emitVerifyJson(ok, results) {
  process.stdout.write(JSON.stringify({ ok, results }) + "\n")
  if (!ok) process.exitCode = 1
}
function verifyCmd(cwd, runId, json) {
  const targets = runId ? [{ runId }] : listRuns(cwd)
  const results = targets.map((t) => ({ runId: t.runId, ...verifyRun(cwd, t.runId) }))
  const ok = allValid(results)
  if (json) return emitVerifyJson(ok, results)
  section(runId ? `audit verify — ${runId}` : "audit verify — todos os runs")
  if (!results.length) return info("  (nada a verificar)")
  renderVerifyResults(results)
  if (!ok) { process.exitCode = 1; error("Provenance ADULTERADO — a cadeia não fecha.") }
}

const decisionOf = (r) => r.policy && r.policy.decision
const targetOf = (r) => `${(r.target && r.target.kind) || "?"}:${(r.target && r.target.pathOrName) || "?"}`
const inspectLine = (r) => `  • ${r.actionId} · ${r.intent} → ${decisionOf(r)} · ${targetOf(r)}`
function inspectCmd(cwd, runId, json) {
  if (!runId) return error("Uso: audit inspect <runId>")
  const run = readRun(cwd, runId)
  if (json) return process.stdout.write(JSON.stringify({ runId, receipts: run }) + "\n")
  section(`audit inspect — ${runId}`)
  if (!run.length) return warn("Sem recibos para esse run.")
  for (const r of run) info(inspectLine(r))
}

function exportCmd(cwd, runId, json) {
  if (!runId) { error("Uso: audit export <runId>"); return }
  process.stdout.write(JSON.stringify({ runId, receipts: readRun(cwd, runId), verify: verifyRun(cwd, runId) }, null, json ? 0 : 2) + "\n")
}

function renderDoctor(report, broken) {
  section("audit doctor")
  info(`  Provenance: ${report.provenance ? "presente" : "ausente"} · ${report.runs} run(s)`)
  ;(report.ok ? success : error)(report.ok ? "Todas as cadeias íntegras." : `${broken} run(s) com cadeia QUEBRADA — investigue.`)
  if (!report.ok) process.exitCode = 1
}
function doctorCmd(cwd, json) {
  const runs = listRuns(cwd)
  const broken = runs.filter((r) => !verifyRun(cwd, r.runId).valid).length
  const report = { provenance: existsSync(provenanceDir(cwd)), runs: runs.length, broken, ok: broken === 0 }
  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); if (!report.ok) process.exitCode = 1; return }
  renderDoctor(report, broken)
}

// Dispatch (definido após os handlers; auditCommand só o lê em runtime).
const AUDIT_SUBS = {
  status: (cwd, runId, args, json) => statusCmd(cwd, json),
  verify: (cwd, runId, args, json) => verifyCmd(cwd, runId, json),
  inspect: (cwd, runId, args, json) => inspectCmd(cwd, runId, json),
  export: (cwd, runId, args, json) => exportCmd(cwd, runId, json),
  events: (cwd, runId, args, json) => eventsCmd(cwd, args, json),
  doctor: (cwd, runId, args, json) => doctorCmd(cwd, json),
}
