import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { runWizard } from "../project-plan/wizard.js"
import { buildPlan } from "../project-plan/planner.js"
import { sanitizeCommand } from "../project-plan/executor.js"
import { runPipeline, renderPlanMarkdown, PIPELINE_STAGES } from "../project-plan/run-loop.js"
import { modeWizardText } from "../project-plan/modes.js"
import { buildConsult, renderConsultHuman } from "./consult.js"
import { printPlanHuman } from "./plan.js"
import { prompt, select, confirm, success, error, info, section, warn } from "../cli/index.js"
import { classifyWorkspace } from "../runtime/workspace.js"

/**
 * `start` — entrada Replit-like (PRD18 Sprint 1). Orquestra o wizard (objetivo →
 * nome → modo), mostra o plano e SÓ executa após confirmação — agora via pipeline
 * `Intent → Plan → Scout → Create → Dev → Test → Review → Verify → Preview`,
 * reusando planner/executor/runtime/verify (não reimplementa nada).
 *
 *   gstack_vibehard start ["objetivo"] [--name X] [--mode lite|full] [--yes]
 *   gstack_vibehard start "objetivo" --dry-run --json   # JSON PURO, nada é escrito
 */

// Flags do start: valor (consomem o próximo token) e booleanas (tabela → cc baixa).
const VALUE_FLAGS = { "--name": "projectName", "--mode": "mode" }
const BOOL_FLAGS = { "--dry-run": "dryRun", "--json": "json", "--yes": "yes", "-y": "yes" }

function parseStartArgs(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (VALUE_FLAGS[a]) { out[VALUE_FLAGS[a]] = args[++i]; continue }
    if (BOOL_FLAGS[a]) { out[BOOL_FLAGS[a]] = true; continue }
    if (!a.startsWith("-")) out._.push(a)
  }
  out.objective = out._[0]
  return out
}

/** Dry-run JSON puro: plano + comandos que SERIAM chamados. Nada é escrito. */
function dryRunReport(flags, cwd) {
  const { plan, validation } = buildPlan({ objective: flags.objective, projectName: flags.projectName, mode: flags.mode })
  const commands = [...plan.steps, ...plan.optionalSteps]
    .filter((s) => Array.isArray(s.command))
    .map((s) => ({ id: s.id, command: sanitizeCommand(s.command), cwd: s.cwd, required: s.required !== false }))
  return {
    ok: validation.ok,
    dryRun: true,
    plan,
    pipeline: { stages: [...PIPELINE_STAGES], commands },
    warnings: validation.ok ? [] : validation.errors,
    note: "dry-run: nenhum comando executado, nada foi escrito",
    cwd,
  }
}

/** dry-run: JSON puro (stdout SÓ JSON), sem escrita, sem execução. */
function handleDryRun(flags, objective, json, cwd) {
  if (!objective) {
    const err = { ok: false, dryRun: true, errors: ['objetivo obrigatório: start "descreva o que quer" --dry-run'] }
    if (json) { process.stdout.write(JSON.stringify(err) + "\n"); return err }
    error(err.errors[0])
    return err
  }
  const report = dryRunReport({ ...flags, objective }, cwd)
  if (json) { process.stdout.write(JSON.stringify(report) + "\n"); return report }
  section("start --dry-run — plano (nada será executado)")
  printPlanHuman(report.plan)
  info(`  Pipeline: ${report.pipeline.stages.join(" → ")}`)
  return report
}

function printNonInteractiveHelp() {
  section("start")
  info("start é interativo. Em modo não-interativo use:")
  info('  gstack_vibehard start "<objetivo>" --dry-run --json   # plano sem executar')
  info('  gstack_vibehard plan "<objetivo>"                      # gera o plano')
  info("  gstack_vibehard plan run <id> --yes                    # executa")
}

/** Persiste plan.json + plan.md + status.json (PRD18: artefato humano E máquina). */
function persistPlanArtifacts(cwd, plan) {
  const planDir = join(cwd, ".gstack", "plans", plan.id)
  mkdirSync(planDir, { recursive: true })
  writeFileSync(join(planDir, "plan.json"), JSON.stringify(plan, null, 2) + "\n")
  writeFileSync(join(planDir, "plan.md"), renderPlanMarkdown(plan))
  writeFileSync(join(planDir, "status.json"), JSON.stringify({ id: plan.id, status: "ready", steps: {} }, null, 2) + "\n")
  return planDir
}

function wizardInputs(flags, opts, objective) {
  return {
    objective,
    projectName: opts.projectName !== undefined ? opts.projectName : flags.projectName,
    mode: opts.mode || flags.mode,
  }
}

function printWizardIntro(json) {
  if (json) return
  section("start — assistente guiado"); info(modeWizardText()); info("")
}

/** Trilha única ECC-style (PRD14 §4.9): consult READ-ONLY antes de executar. */
function printConsult(json, objective, cwd) {
  if (json) return
  renderConsultHuman(buildConsult({ objective, cwd }), { compact: true }); info("")
}

/** Wizard + validação + consult. null quando cancelado/inválido (já reportado). */
async function collectPlan(flags, opts, objective, json, cwd) {
  printWizardIntro(json)
  const ui = { prompt: opts.prompt || prompt, select: opts.select || select }
  const res = await runWizard(ui, wizardInputs(flags, opts, objective))
  if (res.cancelled) { info("Cancelado — nenhum objetivo informado."); return null }
  if (!res.validation.ok) { error(`Plano inválido: ${res.validation.errors.join("; ")}`); return null }
  printConsult(json, res.plan.objective, cwd)
  return res
}

/** Confirmação humana da execução (a menos de --yes). */
async function confirmExecution(plan, flags, opts) {
  if (flags.yes || opts.yes === true) return true
  const doConfirm = opts.confirm || confirm
  return doConfirm(`Executar este plano (${plan.steps.length} passos)?`, false)
}

/** Persiste, confirma e roda o pipeline. Retorna o contrato público do start. */
async function confirmAndRunPipeline(plan, flags, opts, json, cwd) {
  const planDir = persistPlanArtifacts(cwd, plan)
  if (!json) printPlanHuman(plan)

  if (!(await confirmExecution(plan, flags, opts))) {
    info(`Plano salvo. Execute quando quiser: gstack_vibehard plan run ${plan.id}`)
    return { plan, executed: false }
  }

  // Pipeline Replit-like: create (hard cap+retomada) → dev → test → review → verify → preview.
  const pipeline = runPipeline({
    plan, planDir, cwd,
    exec: opts.exec, gateExec: opts.gateExec,
    devRunner: opts.devRunner, verifyRunner: opts.verifyRunner,
    maxAttempts: opts.maxAttempts,
  })

  if (json) process.stdout.write(JSON.stringify({ ok: pipeline.status === "done", runId: pipeline.runId, status: pipeline.status, stages: pipeline.stages, planId: plan.id }) + "\n")
  else renderPipelineHuman(pipeline, plan)
  return { plan, result: pipeline.execResult, pipeline, executed: true }
}

function resolveStartCtx(args, opts) {
  const flags = parseStartArgs(args)
  const objective = opts.objective !== undefined ? opts.objective : flags.objective
  return { flags, objective, cwd: opts.cwd || process.cwd(), json: flags.json || opts.json === true }
}
// start é interativo: sem TTY e sem entradas injetadas/posicionais → orienta `plan`.
const startNeedsHelp = (objective, opts) => !process.stdin.isTTY && !(objective !== undefined || opts.prompt)

// ── Workspace guard (PRD28 28.0) ─────────────────────────────────────────────────
// O bug real: usuário leigo em C:\Users\Windows caiu em `npm install` cru porque
// nada perguntou ONDE ele estava. Antes do wizard, classifica o diretório e pergunta
// a trilha — NUNCA orienta npm manual. gstack_project/node_app/unknown seguem direto.
const GUARD_QUESTIONS = {
  home_or_wrong_cwd: {
    intro: (ws) => `Você está em uma pasta sem projeto (${ws.description}). NÃO rode npm install aqui.`,
    choices: ["Criar um novo projeto GStack agora (continua o assistente)", "Entrar em um projeto existente (te mostro como)", "Apenas diagnosticar esta pasta"],
  },
  empty_git_repo: {
    intro: () => "Encontrei um repositório Git, mas ainda não há app executável.",
    choices: ["Criar scaffold GStack neste diretório (continua o assistente)", "Criar novo projeto em outra pasta (te mostro como)", "Cancelar e mostrar diagnóstico"],
  },
}
function renderGuardExit(ws, choiceIdx) {
  if (choiceIdx === 1) { info("  Trilha:"); info("    cd <caminho-do-projeto>"); info("    gstack_vibehard dev"); return }
  info("  Diagnóstico read-only desta pasta:")
  ws.actions.forEach((a) => info(`    • ${a}`))
}
/** true = seguir para o wizard; false = usuário escolheu sair (já orientado). */
async function workspaceGuard(cwd, opts) {
  const ws = (opts.classify || classifyWorkspace)(cwd)
  const q = GUARD_QUESTIONS[ws.state]
  if (!q) return true
  warn(q.intro(ws))
  const doSelect = opts.select || select
  const choice = await doSelect("O que você quer fazer?", q.choices, 0)
  if (choice === 0) return true
  renderGuardExit(ws, choice)
  return false
}

export async function startCommand(args = [], opts = {}) {
  const { flags, objective, cwd, json } = resolveStartCtx(args, opts)
  if (flags.dryRun) return handleDryRun(flags, objective, json, cwd)
  if (startNeedsHelp(objective, opts)) return printNonInteractiveHelp()
  if (!(await workspaceGuard(cwd, opts))) return { executed: false, guarded: true }
  const res = await collectPlan(flags, opts, objective, json, cwd)
  if (!res) return
  return confirmAndRunPipeline(res.plan, flags, opts, json, cwd)
}

function stageIcon(status) {
  return status === "ready" ? "✓" : status === "failed" ? "✗" : status === "advisory" ? "•"
    : status === "pending_feature" ? "◷" : status === "not_applicable" ? "–" : "…"
}

function renderStageLines(stages) {
  for (const stage of PIPELINE_STAGES) {
    const s = stages[stage]
    if (s) info(`  ${stageIcon(s.status)} ${stage}: ${s.status}${s.detail ? ` — ${s.detail}` : ""}`)
  }
}

function renderPipelineOutcome(pipeline, plan) {
  if (pipeline.status === "done") { success(`Concluído (${pipeline.attempts} tentativa(s)). Journal: .gstack/runs/${pipeline.runId}/journal.jsonl`); return }
  warn(`Parou com handoff após ${pipeline.attempts} tentativa(s) — hard cap respeitado (sem loop infinito).`)
  info(`  Leia: ${pipeline.handoffPath}`)
  info(`  Retome: gstack_vibehard plan run ${plan.id}`)
}

function renderPipelineHuman(pipeline, plan) {
  info("")
  section(`run ${pipeline.runId} — pipeline`)
  renderStageLines(pipeline.stages)
  if (pipeline.stages.preview?.url) success(`Preview: ${pipeline.stages.preview.url}`)
  renderPipelineOutcome(pipeline, plan)
}
