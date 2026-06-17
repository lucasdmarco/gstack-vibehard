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
  const hi = args.indexOf("--harness")
  const harness = hi !== -1 && args[hi + 1] ? args[hi + 1] : opts.harness

  const report = runVerify({ cwd, profile, harness, exec: opts.exec, home: opts.home })

  // Persiste em .gstack/runs/<runId>/verify.json
  const runId = opts.runId || randomUUID().slice(0, 8)
  const dir = join(cwd, ".gstack", "runs", runId)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "verify.json"), JSON.stringify({ runId, ...report }, null, 2) + "\n")
  } catch (e) { report.persistError = e.message }

  if (json) { process.stdout.write(JSON.stringify({ runId, ...report }) + "\n"); return report }

  section(`verify — perfil ${report.profile} · status ${report.status}`)
  for (const s of report.steps) {
    const icon = s.status === "passed" ? "✓" : s.status === "failed" ? "✗"
      : s.status === "pending_feature" ? "◷" : s.status === "tool_missing" ? "⚠" : "–"
    const note = s.detail ? ` (${s.detail})` : ""
    info(`  ${icon} ${s.id}: ${s.status}${note}`)
  }
  if (report.reducedTrust) warn(`Confiança REDUZIDA: harness '${report.harness}' não tem controle real (best-effort).`)
  info(`  Relatório: .gstack/runs/${runId}/verify.json`)

  // Mensagem honesta: "PRONTO" só em ready; nunca em pending_product/blocked.
  if (report.status === "ready") success("Projeto PRONTO — todos os gates aplicáveis passaram.")
  else if (report.status === "ready_with_warnings") warn(`Pronto COM AVISOS — faltou ferramenta esperada: ${report.toolMissing.join(", ")}. Não é Zero-Trust completo.`)
  else if (report.status === "pending_product") warn("NÃO declarado pronto: runtime/preview pendente (o app/preview não roda ainda). Build/testes passaram.")
  else { error(`BLOQUEADO — gates obrigatórios falharam: ${report.failed.join(", ")}`); warn("Corrija e rode `verify` de novo (ou acione `task`).") }
  return report
}
