import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import { execFileSync } from "child_process"
import { runVerify } from "../project-plan/verify-runner.js"
import { runChangedFilesVerify } from "../project-plan/changed-files.js"
import { npxArgv } from "../installer/deps.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * Sink de progresso incremental (PRD20 20.1): a cada etapa, append em
 * `verify.progress.jsonl` + reescrita do `verify.json` PARCIAL. Assim o release
 * NUNCA fica mudo — dá pra observar em qual gate está. Best-effort (nunca lança).
 */
function makeProgressSink(dir, runId) {
  const seen = []
  try { mkdirSync(dir, { recursive: true }) } catch { /* best-effort */ }
  return (step) => {
    seen.push(step)
    try { appendFileSync(join(dir, "verify.progress.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...step }) + "\n") } catch { /* best-effort */ }
    try { writeFileSync(join(dir, "verify.json"), JSON.stringify({ runId, partial: true, steps: seen }, null, 2) + "\n") } catch { /* best-effort */ }
  }
}

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

function renderChangedFiles(r) {
  section(`verify --changed-files — ${r.files.length} arquivo(s) alterado(s)`)
  for (const s of r.steps) info(`  ${s.status === "passed" ? "✓" : "✗"} ${s.id}: ${s.status}${s.detail ? ` (${s.detail})` : ""}`)
  if (r.status === "clean") success("Nada alterado — nada a verificar.")
  else if (r.status === "ready") success(`Alterados OK. ${r.note}`)
  else error(`BLOQUEADO: ${r.failed.join(", ")}. ${r.note}`)
}

/** Gate seletivo por arquivos alterados. @returns resultado (terminou) ou null (fallback). */
function handleChangedFiles(cwd, opts, json) {
  const r = runChangedFilesVerify({ cwd, exec: opts.exec })
  if (r.status === "fallback") { if (!json) warn(`${r.note} — rodando o verify completo.`); return null }
  if (json) { process.stdout.write(JSON.stringify(r) + "\n"); return r }
  renderChangedFiles(r)
  return r
}

function pickProfile(args) {
  if (args.includes("--quick")) return "quick"
  if (args.includes("--release")) return "release"
  const pi = args.indexOf("--profile")
  return pi !== -1 && args[pi + 1] ? args[pi + 1] : "full"
}
function pickHarness(args, opts) {
  const hi = args.indexOf("--harness")
  return hi !== -1 && args[hi + 1] ? args[hi + 1] : opts.harness
}

/** `--dry-run`: lista os comandos do profile SEM executar nada (PRD20 20.1). */
function handleDryRun(cwd, profile, opts, json) {
  const plan = runVerify({ cwd, profile, home: opts.home, dryRun: true })
  if (json) { process.stdout.write(JSON.stringify(plan) + "\n"); return plan }
  section(`verify --dry-run — perfil ${plan.profile} (nada executado)`)
  for (const s of plan.plan) info(`  ${s.required ? "▸" : "·"} ${s.id}: ${s.command}`)
  return plan
}

/**
 * `verify` — roda os delivery gates do projeto e salva o relatório.
 *   gstack_vibehard verify [--profile scaffold|full] [--json]
 * Não declara "pronto" sem verificar; gates ausentes viram `not_applicable`.
 */
export async function verifyCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")

  // Gate seletivo por arquivos alterados: NUNCA substitui o release gate.
  if (args.includes("--changed-files")) {
    const r = handleChangedFiles(cwd, opts, json)
    if (r) return r // null = fallback → segue o verify completo abaixo
  }

  const profile = pickProfile(args)
  const harness = pickHarness(args, opts)

  if (args.includes("--dry-run")) return handleDryRun(cwd, profile, opts, json)

  const runId = opts.runId || randomUUID().slice(0, 8)
  const dir = join(cwd, ".gstack", "runs", runId)
  const report = runVerify({ cwd, profile, harness, exec: opts.exec, stepExec: opts.stepExec, home: opts.home, runId, onStep: makeProgressSink(dir, runId) })

  // ECC AgentShield (opt-in): camada de segurança de prompt-injection, advisory.
  if (args.includes("--agentshield") || process.env.GSTACK_AGENTSHIELD === "1") {
    report.agentShield = runAgentShield(cwd, opts.exec)
  }

  // Persiste o verify.json FINAL (substitui os parciais do sink) em .gstack/runs/<runId>/.
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
      : s.status === "timed_out" ? "⏱" : s.status === "pending_feature" ? "◷" : s.status === "tool_missing" ? "⚠"
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
  else if (report.status === "timed_out") { error(`TIMEOUT — etapa(s) estouraram o tempo: ${(report.timedOut || []).join(", ")}`); warn("Os processos filhos foram encerrados. Investigue a etapa e rode de novo.") }
  else { error(`BLOQUEADO — gates obrigatórios falharam: ${report.failed.join(", ")}`); warn("Corrija e rode `verify` de novo (ou acione `task`).") }
  return report
}
