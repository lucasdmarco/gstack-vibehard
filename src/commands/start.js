import { mkdirSync, writeFileSync, existsSync } from "fs"
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
import { buildSkillRoute, buildModelIntake, MODEL_INTAKE_SOURCES } from "../skills/route.js"
import { registerDesignSystem, evaluatePreWriteGate, resolveDesignSystem } from "../skills/design-system.js"
import { resolveLoopDecision, LOOP_MODES } from "../skills/loop-router.js"
import { contractsForRoute } from "../skills/execution-contract.js"
import { detectTargetProfiles, decideFirstRun } from "../onboarding/first-run.js"
import { discoverProject } from "../onboarding/project-discovery.js"
import { proposeBrownfieldChoices, decideBrownfieldOrNew } from "../onboarding/brownfield-plan.js"
import { openStateStore } from "../state/store.js"
import { listSessions, activeSession } from "../state/session-index.js"

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
const VALUE_FLAGS = { "--name": "projectName", "--mode": "mode", "--skills": "skills", "--design-system": "designSystem", "--loop": "loop" }
const BOOL_FLAGS = { "--dry-run": "dryRun", "--json": "json", "--yes": "yes", "-y": "yes", "--assume-no-existing-model": "assumeNoExistingModel", "--proof": "proof" }

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

// PRD48 S48.1 — Harness Session Profile: read-only, nunca escreve, nunca dispara login.
// Anexado ao dry-run (que já promete "nada é escrito") como visão honesta do que está
// apto ANTES de reservar budget ou iniciar o Golden Run.
function harnessSessionReport() {
  const profiles = detectTargetProfiles()
  return { profiles, decision: decideFirstRun({ profiles, requiresLlm: true }) }
}

// PRD48 S48.2 — brownfield: read-only, escolhe new|brownfield sem executar nada.
function brownfieldReport(cwd) {
  const discovery = discoverProject(cwd)
  const route = decideBrownfieldOrNew(discovery)
  return { discovery, route, ...(route === "brownfield" ? { proposal: proposeBrownfieldChoices(discovery) } : {}) }
}

// PRD48 S48.3 — sessão ativa: read-only DE VERDADE — `openStateStore` cria `.gstack/` como
// efeito colateral (mesmo só pra ler), o que violaria a garantia "dry-run não escreve nada"
// (S48.0/S48.1/S48.2). Sem `.gstack/` ainda, não há sessão possível — nunca abre o store.
function activeSessionReport(cwd) {
  if (!existsSync(join(cwd, ".gstack"))) return { hasActive: false, session: null }
  try {
    const store = openStateStore(cwd)
    const sessions = listSessions(store, { limit: 20 })
    store.close()
    const active = activeSession(sessions)
    return { hasActive: active !== null, session: active }
  } catch { return { hasActive: false, session: null } }
}

/** Dry-run JSON puro: plano + comandos que SERIAM chamados. Nada é escrito. */
function dryRunReport(flags, cwd) {
  const { plan, validation } = buildPlan({ objective: flags.objective, projectName: flags.projectName, mode: flags.mode })
  const commands = [...plan.steps, ...plan.optionalSteps]
    .filter((s) => Array.isArray(s.command))
    .map((s) => ({ id: s.id, command: sanitizeCommand(s.command), cwd: s.cwd, required: s.required !== false }))
  // Status do design system SEM efeito colateral (dry-run não escreve: importLegacy=false).
  const ds = resolveDesignSystem({ root: cwd, bypass: flags.designSystem === "none" ? "none" : null, importLegacy: false })
  return {
    ok: validation.ok,
    dryRun: true,
    plan,
    pipeline: { stages: [...PIPELINE_STAGES], commands },
    designSystem: { status: ds.status, source: ds.source, wouldBlockUi: !["complete", "generated", "bypassed"].includes(ds.status) },
    harnessSession: harnessSessionReport(),
    brownfield: brownfieldReport(cwd),
    activeSession: activeSessionReport(cwd),
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

/** Persiste plan.json + plan.md + status.json (+ brief.json S42.1). Artefato humano E máquina. */
function persistPlanArtifacts(cwd, plan, brief) {
  const planDir = join(cwd, ".gstack", "plans", plan.id)
  mkdirSync(planDir, { recursive: true })
  writeFileSync(join(planDir, "plan.json"), JSON.stringify(plan, null, 2) + "\n")
  writeFileSync(join(planDir, "plan.md"), renderPlanMarkdown(plan))
  writeFileSync(join(planDir, "status.json"), JSON.stringify({ id: plan.id, status: "ready", steps: {} }, null, 2) + "\n")
  // Product Brief (S42.1): decisões com fonte + aceites com verificador/pending — brief vivo
  // que o closeout (S42.10) reidrata. Só grava se o wizard o produziu (retrocompat).
  if (brief) writeFileSync(join(planDir, "brief.json"), JSON.stringify(brief, null, 2) + "\n")
  return planDir
}

function wizardInputs(flags, opts, objective) {
  return {
    objective,
    projectName: opts.projectName !== undefined ? opts.projectName : flags.projectName,
    mode: opts.mode || flags.mode,
    // --yes = zero perguntas: o wizard usa o modo recomendado sem select. Sem TTY e sem
    // `select` injetado também é não-interativo — senão as decisões do intake (S42.1)
    // penduram no stdin (CI/pipe/background). Mesma regra dos outros gates: canPromptSelect.
    nonInteractive: flags.yes === true || opts.yes === true || !canPromptSelect(opts),
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

// ── Skill Route (PRD29 29.2 + PRD28 28.10) ───────────────────────────────────────
// Antes de confirmar: detecta capacidades, pergunta pelo modelo existente (quando
// frontend + interativo) e DECLARA a rota de skills. Bloqueio pre-write = 29.3.
const INTAKE_LABELS = Object.freeze([
  "Não tenho — pode propor",
  "Screenshot/print existente", "Figma/design system", "Template/site de referência",
  "Planilha/modelo de dados", "Schema Supabase/banco", "OpenAPI/API existente",
  "Brand guide (cores/logo)", "App existente para adaptar",
])
// Sem TTY e sem `select` injetado não há como perguntar — perguntar penduraria
// no stdin pra sempre (CI/pipe/background). Centraliza a regra dos dois gates.
const canPromptSelect = (opts) => Boolean(opts.select) || Boolean(process.stdin.isTTY)

async function askModelIntake(opts) {
  const doSelect = opts.select || select
  const labels = [...INTAKE_LABELS]
  const idx = choiceIndex(await doSelect("Antes da interface: você já tem algum modelo/artefato para eu seguir?", labels), labels)
  if (idx <= 0) return buildModelIntake({ sources: [] })
  return buildModelIntake({ sources: [MODEL_INTAKE_SOURCES[idx - 1]] })
}
function skippedIntake(flags, opts) {
  if (flags.assumeNoExistingModel) return buildModelIntake({ skipped: true, skippedBy: "--assume-no-existing-model" })
  if (flags.yes || opts.yes === true) return buildModelIntake({ skipped: true, skippedBy: "--yes" })
  // BUG FIX (PRD34 §2.1): degrada honesto sem TTY — nunca pendura no stdin.
  if (!canPromptSelect(opts)) return buildModelIntake({ skipped: true, skippedBy: "non_interactive" })
  return null // interativo → pergunta
}
async function resolveModelIntake(caps, flags, opts) {
  if (!caps.touchesFrontend) return buildModelIntake({ sources: [] })
  return skippedIntake(flags, opts) || askModelIntake(opts)
}
function renderRoute(route, json) {
  if (json) return
  info("")
  info(`  Skills desta rota (${route.selectionSource === "user_flag" ? "--skills" : "detectadas pelos gates"}):`)
  route.selectedSkills.slice(0, 8).forEach((s) => info(`    • ${s}`))
  if (route.selectedSkills.length > 8) info(`    … +${route.selectedSkills.length - 8}`)
  if (route.blockingGates.length) info(`  Gates desta rota: ${route.blockingGates.join(", ")}`)
  info("")
}
async function declareSkillRoute(plan, flags, opts, json) {
  const override = flags.skills ? flags.skills.split(",").map((s) => s.trim()).filter(Boolean) : null
  // root default = raiz do PACOTE (as skills vêm com o produto) — cwd do usuário
  // pode ser um dir vazio e daria rota vazia (mesma lição do dream audit CM-08).
  const base = { objective: plan.objective, template: plan.template, intent: plan.intent }
  const probe = buildSkillRoute(base) // catálogo+matriz compilados aqui; intake vem depois
  const modelIntake = await resolveModelIntake(probe.detectedCapabilities, flags, opts)
  const route = { ...probe, modelIntake, selectedSkills: override || probe.selectedSkills, selectionSource: override ? "user_flag" : "gate_matrix" }
  renderRoute(route, json)
  return route
}

// Design System Gate pre-write (F2-B / PRD29 29.3 + 28.11): quando a rota exige
// (touchesFrontend), bloqueia a execução se não houver design system declarado.
// `--design-system <path|none>` registra a decisão (none = opt-out explícito).
// Universal: vale para qualquer harness (o hook Python só cobria o Claude).
function enforceDesignSystemGate(route, dsChoice, cwd, planDir) {
  const applies = route.blockingGates.includes("design-system-gate") || route.detectedCapabilities.touchesFrontend
  if (!applies) return { ok: true, applicable: false, evidence: null }
  if (dsChoice) registerDesignSystem({ root: cwd, choice: dsChoice })
  const evidence = evaluatePreWriteGate({ root: cwd, uiIntended: true, bypass: dsChoice === "none" ? "none" : null })
  writeFileSync(join(planDir, "design-system-gate.json"), JSON.stringify(evidence, null, 2) + "\n")
  if (evidence.blocked) writeFileSync(join(planDir, "skill-gate-violations.json"), JSON.stringify({ gate: "design-system-gate", violations: evidence.violations }, null, 2) + "\n")
  return { ok: !evidence.blocked, applicable: true, evidence }
}
function renderGateBlock(evidence, json) {
  if (json) { process.stdout.write(JSON.stringify({ ok: false, blocked: "design-system-gate", gate: evidence }) + "\n"); return }
  warn("Design System Gate: escrita de UI bloqueada — nenhum design system declarado.")
  info(`  ${evidence.requiredAction}`)
}

// Loop Router (F2-C): declara o modo de execução inferido. start é o replit_pipeline;
// quando a intenção casa melhor com outro modo, sugere o comando — sem trocar de trilho.
function declareLoopDecision(plan, flags, opts, json, planDir) {
  const interactive = Boolean(opts.select) || Boolean(process.stdin.isTTY)
  const decision = resolveLoopDecision({ objective: plan.objective, flags, interactive })
  writeFileSync(join(planDir, "loop-decision.json"), JSON.stringify(decision, null, 2) + "\n")
  if (!json && decision.mode !== "replit_pipeline") info(`  Loop Router: intenção casa com "${decision.mode}" (${LOOP_MODES[decision.mode].command}) — start segue como pipeline.`)
  return decision
}

// Proof no fim do start (F3-C): runner injetável (testes) ou o proof real (release).
async function runStartProof(cwd, json, opts) {
  if (opts.proofRunner) return opts.proofRunner(cwd)
  if (!json) info("Rodando proof determinístico (--profile release)…")
  const { proofCommand } = await import("./proof.js")
  return proofCommand(["--profile", "release", ...(json ? ["--json"] : [])], { cwd })
}

/** Persiste, confirma e roda o pipeline. Retorna o contrato público do start. */
async function confirmAndRunPipeline(plan, flags, opts, json, cwd, brief) {
  const planDir = persistPlanArtifacts(cwd, plan, brief)
  if (!json) printPlanHuman(plan)

  // Rota de skills DECLARADA antes do confirm (29.2): pergunta intake se frontend.
  const skillRoute = await declareSkillRoute(plan, flags, opts, json)
  writeFileSync(join(planDir, "skill-route.json"), JSON.stringify(skillRoute, null, 2) + "\n")

  // Skill Execution Contract (S42.3): cada skill selecionada entra sob contrato
  // selected→loaded→applied→verified (hash). Enforcement honesto (advisory na CLI —
  // sem real_hooks do harness). Verificação por hash roda onde a skill executa.
  writeFileSync(join(planDir, "skill-execution.json"),
    JSON.stringify(contractsForRoute(skillRoute, { harnessEnforcement: opts.harnessEnforcement || null }), null, 2) + "\n")

  // Loop Router declara o modo de execução inferido (F2-C) — ortogonal ao gate,
  // registrado sempre (mesmo que o gate abaixo bloqueie).
  const loopDecision = declareLoopDecision(plan, flags, opts, json, planDir)

  // Design System Gate pre-write (F2-B): bloqueia UI sem DS ANTES de qualquer escrita.
  // Choice via flag (--design-system) ou opts (chamada programática/testes).
  const dsChoice = flags.designSystem ?? opts.designSystem
  const dsGate = enforceDesignSystemGate(skillRoute, dsChoice, cwd, planDir)
  if (!dsGate.ok) {
    renderGateBlock(dsGate.evidence, json)
    return { plan, executed: false, guarded: "design-system-gate", skillRoute, loopDecision, gate: dsGate.evidence }
  }

  if (!(await confirmExecution(plan, flags, opts))) {
    info(`Plano salvo. Execute quando quiser: gstack_vibehard plan run ${plan.id}`)
    return { plan, executed: false, skillRoute, loopDecision }
  }

  // Pipeline Replit-like: create (hard cap+retomada) → dev → test → review → verify → preview.
  const pipeline = runPipeline({
    plan, planDir, cwd, skillRoute, designSystemGate: dsGate.evidence, loopDecision,
    exec: opts.exec, gateExec: opts.gateExec,
    devRunner: opts.devRunner, verifyRunner: opts.verifyRunner, scoutRunner: opts.scoutRunner,
    maxAttempts: opts.maxAttempts,
  })

  return emitAndProof(plan, pipeline, { skillRoute, loopDecision }, flags, opts, json, cwd)
}

// Emite o resultado + proof offer (F3-C / 28.5). Extraído p/ manter cc baixa.
async function emitAndProof(plan, pipeline, decl, flags, opts, json, cwd) {
  if (json) process.stdout.write(JSON.stringify({ ok: pipeline.status === "done", runId: pipeline.runId, status: pipeline.status, stages: pipeline.stages, planId: plan.id, skillRoute: { selectedSkills: decl.skillRoute.selectedSkills, modelIntake: decl.skillRoute.modelIntake.status } }) + "\n")
  else renderPipelineHuman(pipeline, plan)
  const proof = flags.proof ? await runStartProof(cwd, json, opts) : null
  return { plan, result: pipeline.execResult, pipeline, executed: true, skillRoute: decl.skillRoute, loopDecision: decl.loopDecision, ...(proof ? { proof } : {}) }
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
/**
 * BUG FIX (PRD34 §2.1): o `select()` da CLI retorna a STRING da opção escolhida
 * (contrato real — o wizard depende disso), NÃO o índice. Normalizamos aqui;
 * número segue aceito por retrocompat, mas o contrato canônico é string.
 */
function choiceIndex(choice, options) {
  if (typeof choice === "number") return choice
  const idx = options.indexOf(choice)
  return idx >= 0 ? idx : 0
}
/** true = seguir para o wizard; false = usuário escolheu sair (já orientado). */
async function workspaceGuard(cwd, opts) {
  const ws = (opts.classify || classifyWorkspace)(cwd)
  const q = GUARD_QUESTIONS[ws.state]
  // Mesmo fix do intake: sem gate aplicável, ou sem como perguntar (não-TTY sem
  // select), segue para o wizard em vez de pendurar no stdin.
  if (!q || !canPromptSelect(opts)) return true
  warn(q.intro(ws))
  const doSelect = opts.select || select
  const idx = choiceIndex(await doSelect("O que você quer fazer?", q.choices), q.choices)
  if (idx === 0) return true
  renderGuardExit(ws, idx)
  return false
}

export async function startCommand(args = [], opts = {}) {
  const { flags, objective, cwd, json } = resolveStartCtx(args, opts)
  if (flags.dryRun) return handleDryRun(flags, objective, json, cwd)
  if (startNeedsHelp(objective, opts)) return printNonInteractiveHelp()
  if (!(await workspaceGuard(cwd, opts))) return { executed: false, guarded: true }
  const res = await collectPlan(flags, opts, objective, json, cwd)
  if (!res) return
  return confirmAndRunPipeline(res.plan, flags, opts, json, cwd, res.brief)
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
