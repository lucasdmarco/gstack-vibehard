import { existsSync } from "fs"
import { readRun, listRuns, verifyRun, provenanceDir } from "../vfa/provenance.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `gstack_vibehard audit <status|inspect|verify|export|doctor>` — inspeciona o
 * provenance log (VFA, §10.3). `verify` recomputa a HASH-CHAIN e falha (exit 1) se
 * algum recibo foi adulterado/removido/reordenado.
 */
export function auditCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const positional = args.filter((a) => !a.startsWith("-"))
  const sub = positional[0] || "status"
  const runId = positional[1]

  if (sub === "status") return statusCmd(cwd, json)
  if (sub === "verify") return verifyCmd(cwd, runId, json)
  if (sub === "inspect") return inspectCmd(cwd, runId, json)
  if (sub === "export") return exportCmd(cwd, runId, json)
  if (sub === "doctor") return doctorCmd(cwd, json)
  warn(`Subcomando desconhecido: ${sub}`)
  info("  Use: audit <status|inspect|verify|export|doctor>")
}

function statusCmd(cwd, json) {
  const runs = listRuns(cwd)
  if (json) { process.stdout.write(JSON.stringify({ runs }) + "\n"); return }
  section("audit status — provenance")
  if (!runs.length) { info("  (sem provenance neste projeto)"); return }
  for (const r of runs) info(`  • ${r.runId}: ${r.count} ação(ões) · até ${r.last}`)
}

function verifyCmd(cwd, runId, json) {
  const targets = runId ? [{ runId }] : listRuns(cwd)
  const results = targets.map((t) => ({ runId: t.runId, ...verifyRun(cwd, t.runId) }))
  const ok = results.length === 0 ? true : results.every((r) => r.valid)
  if (json) { process.stdout.write(JSON.stringify({ ok, results }) + "\n"); if (!ok) process.exitCode = 1; return }
  section(runId ? `audit verify — ${runId}` : "audit verify — todos os runs")
  if (!results.length) { info("  (nada a verificar)"); return }
  for (const r of results) (r.valid ? success : error)(`  ${r.valid ? "✓" : "✗"} ${r.runId}: ${r.valid ? `cadeia íntegra (${r.length} recibos)` : `${r.reason} @${r.brokenAt}`}`)
  if (!ok) { process.exitCode = 1; error("Provenance ADULTERADO — a cadeia não fecha.") }
}

function inspectCmd(cwd, runId, json) {
  if (!runId) { error("Uso: audit inspect <runId>"); return }
  const run = readRun(cwd, runId)
  if (json) { process.stdout.write(JSON.stringify({ runId, receipts: run }) + "\n"); return }
  section(`audit inspect — ${runId}`)
  if (!run.length) { warn("Sem recibos para esse run."); return }
  for (const r of run) info(`  • ${r.actionId} · ${r.intent} → ${r.policy && r.policy.decision} · ${(r.target && r.target.kind) || "?"}:${(r.target && r.target.pathOrName) || "?"}`)
}

function exportCmd(cwd, runId, json) {
  if (!runId) { error("Uso: audit export <runId>"); return }
  process.stdout.write(JSON.stringify({ runId, receipts: readRun(cwd, runId), verify: verifyRun(cwd, runId) }, null, json ? 0 : 2) + "\n")
}

function doctorCmd(cwd, json) {
  const runs = listRuns(cwd)
  const broken = runs.filter((r) => !verifyRun(cwd, r.runId).valid).length
  const report = { provenance: existsSync(provenanceDir(cwd)), runs: runs.length, broken, ok: broken === 0 }
  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); if (!report.ok) process.exitCode = 1; return }
  section("audit doctor")
  info(`  Provenance: ${report.provenance ? "presente" : "ausente"} · ${report.runs} run(s)`)
  ;(report.ok ? success : error)(report.ok ? "Todas as cadeias íntegras." : `${broken} run(s) com cadeia QUEBRADA — investigue.`)
  if (!report.ok) process.exitCode = 1
}
