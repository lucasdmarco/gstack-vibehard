import { mkdirSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import { execFileSync } from "child_process"
import { runVerify } from "../project-plan/verify-runner.js"
import { npxArgv } from "../installer/deps.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * ECC AgentShield (opt-in via `--agentshield` ou GSTACK_AGENTSHIELD=1): consome o
 * ECC como BIBLIOTECA — roda `npx ecc-agentshield scan` nos arquivos de regra do
 * projeto (CLAUDE.md/AGENTS.md). ADVISORY e não-bloqueante; pula gracioso se
 * indisponível (não vira dependência dura do gate). `exec` injetável p/ teste.
 */
function runAgentShield(cwd, exec) {
  const target = ["CLAUDE.md", "AGENTS.md"].find((f) => existsSync(join(cwd, f)))
  if (!target) return { status: "skipped", detail: "sem CLAUDE.md/AGENTS.md p/ escanear" }
  try {
    const { file, argv } = npxArgv(["-y", "ecc-agentshield", "scan", target])
    const out = String((exec || execFileSync)(file, argv, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 120000 }) || "")
    return { status: "advisory", detail: `scan em ${target}`, output: out.slice(0, 400) }
  } catch (e) {
    return { status: "unavailable", detail: `indisponível (${String(e.message || "").slice(0, 50)}) — opcional` }
  }
}

/**
 * `verify` — roda os delivery gates do projeto e salva o relatório.
 *   gstack_vibehard verify [--profile scaffold|full] [--json]
 * Não declara "pronto" sem verificar; gates ausentes viram `not_applicable`.
 */
export async function verifyCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const pi = args.indexOf("--profile")
  const profile = args.includes("--quick") ? "quick"
    : args.includes("--release") ? "release"
    : pi !== -1 && args[pi + 1] ? args[pi + 1] : "full"
  const hi = args.indexOf("--harness")
  const harness = hi !== -1 && args[hi + 1] ? args[hi + 1] : opts.harness

  const report = runVerify({ cwd, profile, harness, exec: opts.exec, home: opts.home })

  // ECC AgentShield (opt-in): camada de segurança de prompt-injection, advisory.
  if (args.includes("--agentshield") || process.env.GSTACK_AGENTSHIELD === "1") {
    report.agentShield = runAgentShield(cwd, opts.exec)
  }

  // Persiste em .gstack/runs/<runId>/verify.json
  const runId = opts.runId || randomUUID().slice(0, 8)
  const dir = join(cwd, ".gstack", "runs", runId)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "verify.json"), JSON.stringify({ runId, ...report }, null, 2) + "\n")
  } catch (e) { report.persistError = e.message }

  if (json) { process.stdout.write(JSON.stringify({ runId, ...report }) + "\n"); return report }

  section(`verify — perfil ${report.profile} · arquétipo ${report.archetype} · status ${report.status}${report.cached ? " (cache)" : ""}`)
  if (report.qg && report.qg.path) {
    info(`  QG: ${report.qg.origin} v${report.qg.version || "?"} (${report.qg.path})`)
    if (report.qgDrift) warn(`  QG DRIFT: o qg.py instalado difere do empacotado (v${report.qg.packagedVersion || "?"}). Rode \`gstack_vibehard install\` p/ atualizar.`)
  }
  for (const s of report.steps) {
    const icon = s.status === "passed" ? "✓" : s.status === "failed" ? "✗"
      : s.status === "pending_feature" ? "◷" : s.status === "tool_missing" ? "⚠"
      : s.status === "advisory" ? "•" : s.status === "cache_hit" ? "⚡" : "–"
    const note = s.detail ? ` (${s.detail})` : ""
    info(`  ${icon} ${s.id}: ${s.status}${note}`)
  }
  if (report.agentShield) {
    const a = report.agentShield
    const icon = a.status === "advisory" ? "•" : a.status === "unavailable" ? "⚠" : "–"
    info(`  ${icon} agentshield (ECC): ${a.status}${a.detail ? ` — ${a.detail}` : ""}`)
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
