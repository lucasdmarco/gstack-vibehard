import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import { runVerify } from "../project-plan/verify-runner.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * `verify` — roda os delivery gates do projeto e salva o relatório.
 *   gstack_vibehard verify [--profile scaffold|full] [--json]
 * Não declara "pronto" sem verificar; gates ausentes viram `not_applicable`.
 */
export async function verifyCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const pi = args.indexOf("--profile")
  const profile = pi !== -1 && args[pi + 1] ? args[pi + 1] : "full"

  const report = runVerify({ cwd, profile, exec: opts.exec, home: opts.home })

  // Persiste em .gstack/runs/<runId>/verify.json
  const runId = opts.runId || randomUUID().slice(0, 8)
  const dir = join(cwd, ".gstack", "runs", runId)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "verify.json"), JSON.stringify({ runId, ...report }, null, 2) + "\n")
  } catch (e) { report.persistError = e.message }

  if (json) { process.stdout.write(JSON.stringify({ runId, ...report }) + "\n"); return report }

  section(`verify — perfil ${report.profile}`)
  for (const s of report.steps) {
    const icon = s.status === "passed" ? "✓" : s.status === "failed" ? "✗" : s.status === "pending_feature" ? "◷" : "–"
    const note = s.detail ? ` (${s.detail})` : ""
    info(`  ${icon} ${s.id}: ${s.status}${note}`)
  }
  info(`  Relatório: .gstack/runs/${runId}/verify.json`)
  if (report.ready) success("Projeto PRONTO — todos os gates aplicáveis passaram.")
  else { error(`Gates falharam: ${report.failed.join(", ")}`); warn("Corrija e rode `verify` de novo (ou acione o Loop Engineer com `task`).") }
  return report
}
