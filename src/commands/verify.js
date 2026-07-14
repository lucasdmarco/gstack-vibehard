import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import { execFileSync } from "child_process"
import { runVerify } from "../project-plan/verify-runner.js"
import { runChangedFilesVerify } from "../project-plan/changed-files.js"
import { npxArgv } from "../installer/deps.js"
import { aggregateTier } from "../project-plan/quality-profile.js"
import { isKnownTier } from "../project-plan/qa-plan.js"
import { dockerAvailable } from "../capabilities/e2e-runner.js"
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

const STEP_ICONS = { passed: "✓", failed: "✗", timed_out: "⏱", pending_feature: "◷", tool_missing: "⚠", advisory: "•", cache_hit: "⚡" }
const stepIcon = (status) => STEP_ICONS[status] || "–"
const wantsAgentShield = (args) => args.includes("--agentshield") || process.env.GSTACK_AGENTSHIELD === "1"

function renderQgInfo(report) {
  if (!report.qg || !report.qg.path) return
  info(`  QG: ${report.qg.origin} v${report.qg.version || "?"} (${report.qg.path})`)
  if (report.qgDrift) warn(`  QG DRIFT: o qg.py instalado difere do empacotado (v${report.qg.packagedVersion || "?"}). Rode \`gstack_vibehard install\` p/ atualizar.`)
}
function renderVerifyHeader(report) {
  section(`verify — perfil ${report.profile} · arquétipo ${report.archetype} · status ${report.status}${report.cached ? " (cache)" : ""}`)
  renderQgInfo(report)
}
function renderVerifySteps(report) {
  for (const s of report.steps) info(`  ${stepIcon(s.status)} ${s.id}: ${s.status}${s.detail ? ` (${s.detail})` : ""}`)
}
function renderAgentShieldLine(report) {
  if (!report.agentShield) return
  const a = report.agentShield
  const icon = a.status === "advisory" ? "•" : a.status === "unavailable" ? "⚠" : "–"
  info(`  ${icon} agentshield (ECC): ${a.status}${a.detail ? ` — ${a.detail}` : ""}`)
}
// Mensagem honesta: "PRONTO" só em ready; nunca em pending_product/blocked/timeout.
function renderVerifyStatus(report) {
  if (report.status === "ready") return success("Projeto PRONTO — todos os gates aplicáveis passaram.")
  if (report.status === "ready_with_warnings") return warn(`Pronto COM AVISOS — faltou ferramenta esperada: ${report.toolMissing.join(", ")}. Não é Zero-Trust completo.`)
  if (report.status === "pending_product") return warn("NÃO declarado pronto: runtime/preview pendente (o app/preview não roda ainda). Build/testes passaram.")
  if (report.status === "timed_out") {
    error(`TIMEOUT — etapa(s) estouraram o tempo: ${(report.timedOut || []).join(", ")}`)
    return warn("Os processos filhos foram encerrados. Investigue a etapa e rode de novo.")
  }
  error(`BLOQUEADO — gates obrigatórios falharam: ${report.failed.join(", ")}`)
  warn("Corrija e rode `verify` de novo (ou acione `task`).")
}
function renderVerify(report, runId) {
  renderVerifyHeader(report)
  renderVerifySteps(report)
  renderAgentShieldLine(report)
  if (report.reducedTrust) warn(`Confiança REDUZIDA: harness '${report.harness}' não tem controle real (best-effort).`)
  info(`  Relatório: .gstack/runs/${runId}/verify.json`)
  renderVerifyStatus(report)
}
// Persiste o verify.json FINAL (substitui os parciais do sink) em .gstack/runs/<runId>/.
function persistVerify(dir, runId, report) {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "verify.json"), JSON.stringify({ runId, ...report }, null, 2) + "\n") }
  catch (e) { report.persistError = e.message }
}
/** Gate seletivo por arquivos alterados (NUNCA substitui o release gate). null = fallback. */
function tryChangedFiles(args, cwd, opts, json) {
  if (!args.includes("--changed-files")) return null
  return handleChangedFiles(cwd, opts, json)
}
// S42.8: `--tier smoke|regression|release` é ADITIVO ao --profile. release exige engine (Docker);
// ausente ⇒ blocked_missing_engine (nunca skip-verde). Ausência de --tier = comportamento intacto.
const pickTier = (args) => { const ti = args.indexOf("--tier"); return ti !== -1 && args[ti + 1] ? args[ti + 1] : null }
const dockerInfoProbe = () => { execFileSync("docker", ["info"], { stdio: "ignore", timeout: 15000 }); return true }

const downgradeIfTierBlocks = (report) => { if (!report.tier.ready && report.status === "ready") report.status = "blocked" }

function applyTierGate(args, report, opts) {
  const tier = pickTier(args)
  if (!tier) return
  if (!isKnownTier(tier)) { report.tier = { ready: false, unknownTier: tier }; return }
  const engineAvailable = dockerAvailable(opts.engineProbe || dockerInfoProbe)
  const checks = (report.steps || []).map((s) => ({ name: s.id, status: s.status }))
  report.tier = aggregateTier({ tier, engineAvailable, checks })
  downgradeIfTierBlocks(report)
}

function runFullVerify(args, cwd, opts) {
  const runId = opts.runId || randomUUID().slice(0, 8)
  const dir = join(cwd, ".gstack", "runs", runId)
  const report = runVerify({ cwd, profile: pickProfile(args), harness: pickHarness(args, opts), exec: opts.exec, stepExec: opts.stepExec, home: opts.home, runId, onStep: makeProgressSink(dir, runId) })
  // ECC AgentShield (opt-in): camada de segurança de prompt-injection, advisory.
  if (wantsAgentShield(args)) report.agentShield = runAgentShield(cwd, opts.exec)
  applyTierGate(args, report, opts)
  persistVerify(dir, runId, report)
  return { report, runId }
}

/**
 * `verify` — roda os delivery gates do projeto e salva o relatório.
 *   gstack_vibehard verify [--profile scaffold|full] [--json]
 * Não declara "pronto" sem verificar; gates ausentes viram `not_applicable`.
 */
export async function verifyCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const changed = tryChangedFiles(args, cwd, opts, json)
  if (changed) return changed // null = fallback → segue o verify completo abaixo
  if (args.includes("--dry-run")) return handleDryRun(cwd, pickProfile(args), opts, json)
  const { report, runId } = runFullVerify(args, cwd, opts)
  if (json) { process.stdout.write(JSON.stringify({ runId, ...report }) + "\n"); return report }
  renderVerify(report, runId)
  return report
}
