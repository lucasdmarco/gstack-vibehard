import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs"
import { join, resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { executePlan, sanitizeCommand } from "./executor.js"
import { runVerify } from "./verify-runner.js"
import { runChangedFilesVerify } from "./changed-files.js"
import { loadRuntimeManifest } from "../runtime/manifest.js"
import { readAllState } from "../runtime/supervisor.js"
import { scout } from "../context-docs/scout.js"
import { recordEvidence, writeTaskMd } from "./evidence-ledger.js"
import { buildContextPack } from "../skills/context-pack.js"
import { runCloseoutSync } from "../skills/closeout.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_ENTRY = join(__dirname, "..", "index.js")

/**
 * Run loop Replit-like (PRD18 Sprint 1). Pipeline sobre componentes EXISTENTES —
 * não recria runtime/verify/executor:
 *
 *   Intent -> Plan -> Scout -> Create -> Dev -> Test -> Review -> Verify -> Preview
 *
 * Regras:
 *  - LLM não aprova nada: o gate determinístico (verify) decide pronto/falhou;
 *  - hard iteration cap no executePlan (retomada pula passos concluídos);
 *  - cap esgotado → handoff humano (.gstack/runs/<runId>/handoff.md), sem loop zumbi;
 *  - todo estágio tem status honesto: ready|failed|pending|advisory|pending_feature|not_applicable;
 *  - journal por run em .gstack/runs/<runId>/ (só resumo, nunca secret/output bruto);
 *  - nenhuma escrita global.
 */

export const PIPELINE_STAGES = Object.freeze([
  "intent", "plan", "scout", "create", "dev", "test", "review", "verify", "preview",
])
export const DEFAULT_MAX_ATTEMPTS = 3

export function runsDir(cwd, runId) { return join(cwd, ".gstack", "runs", runId) }

function appendRunEvent(runDir, event) {
  mkdirSync(runDir, { recursive: true })
  appendFileSync(join(runDir, "journal.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n")
}

// Declarações do start viram artefatos do RUN (skillsUsed + gate evidence): a
// próxima sessão/agente lê quais skills e gates regem esta execução.
function persistRunDeclarations(ctx, opts) {
  if (opts.skillRoute) {
    writeFileSync(join(ctx.runDir, "skill-route.json"), JSON.stringify(opts.skillRoute, null, 2) + "\n")
    appendRunEvent(ctx.runDir, { event: "skill_route_declared", selectedSkills: opts.skillRoute.selectedSkills, blockingGates: opts.skillRoute.blockingGates })
  }
  if (opts.designSystemGate) {
    writeFileSync(join(ctx.runDir, "design-system-gate.json"), JSON.stringify(opts.designSystemGate, null, 2) + "\n")
    appendRunEvent(ctx.runDir, { event: "design_system_gate", status: opts.designSystemGate.designSystem.status, blocked: opts.designSystemGate.blocked })
  }
  if (opts.loopDecision) {
    writeFileSync(join(ctx.runDir, "loop-decision.json"), JSON.stringify(opts.loopDecision, null, 2) + "\n")
    appendRunEvent(ctx.runDir, { event: "loop_decision", mode: opts.loopDecision.mode, source: opts.loopDecision.source, confidence: opts.loopDecision.confidence })
  }
  // Context Pack por run (F3-A): contexto compartilhado p/ subtarefas — secrets excluídos.
  const pack = buildContextPack({ runId: ctx.runId, objective: ctx.plan.objective || ctx.plan.id, files: opts.contextFiles || [] })
  writeFileSync(join(ctx.runDir, "context-pack.json"), JSON.stringify(pack, null, 2) + "\n")
  appendRunEvent(ctx.runDir, { event: "context_pack", estimatedTokens: pack.tokenAccounting.estimatedTokens, files: pack.tokenAccounting.fileCount })
}

function writeRunStatus(runDir, status) {
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2) + "\n")
}

function stepMd(s, pendingSuffix) {
  return s.command ? ` — \`${sanitizeCommand(s.command)}\`` : pendingSuffix
}

function planStepsMd(plan) {
  const lines = ["## Passos"]
  for (const s of plan.steps) lines.push(`1. **${s.label}**${stepMd(s, " *(pendente de feature)*")}`)
  if (plan.optionalSteps?.length) {
    lines.push("", "## Passos opcionais")
    for (const s of plan.optionalSteps) lines.push(`- ${s.label}${stepMd(s, "")}`)
  }
  return lines
}

/** Plano legível para humano (.gstack/plan.md) — espelho do plan.json. */
export function renderPlanMarkdown(plan) {
  const lines = [
    `# Plano — ${plan.objective || "(sem objetivo)"}`,
    "",
    `- id: \`${plan.id}\``,
    `- projeto: ${plan.projectName || "(atual)"} · template: ${plan.template} · modo: ${plan.mode}`,
    `- intent: ${plan.intent} — ${plan.modeReason || ""}`,
    "",
    ...planStepsMd(plan),
    "",
    `> Pipeline: ${PIPELINE_STAGES.join(" → ")} · gate determinístico decide; LLM só aconselha.`,
  ]
  return lines.join("\n") + "\n"
}

/** Handoff humano após cap/falha — resumo acionável, sem secrets/output bruto. */
export function renderHandoff({ runId, plan, stages, attempts, failedStage }) {
  const lines = [
    `# Handoff — run ${runId}`,
    "",
    `- plano: \`${plan.id}\` (${plan.objective || ""})`,
    `- tentativas: ${attempts} (hard cap atingido ou gate falhou sem passos retomáveis)`,
    `- estágio que parou: **${failedStage}**`,
    "",
    "## Estado por estágio",
  ]
  for (const [stage, s] of Object.entries(stages)) lines.push(`- ${stage}: ${s.status}${s.detail ? ` — ${s.detail}` : ""}`)
  lines.push("", "## Próximos passos sugeridos",
    `1. Veja o journal: .gstack/runs/${runId}/journal.jsonl`,
    `2. Corrija a causa e retome: \`gstack_vibehard plan run ${plan.id}\``,
    "3. Gate manual: `gstack_vibehard verify` no diretório do projeto.")
  return lines.join("\n") + "\n"
}

/** Runner default do `dev`: invoca a PRÓPRIA CLI (`dev --json`) no projectDir. */
function defaultDevRunner(projectDir) {
  const out = execFileSync(process.execPath, [CLI_ENTRY, "dev", "--json"], { cwd: projectDir, stdio: "pipe", encoding: "utf-8", timeout: 180000 })
  try { return JSON.parse(String(out).trim().split("\n").pop()) } catch { return { services: [] } }
}

function execResultToStage(res) {
  return res.status === "done"
    ? { status: "ready", detail: `${res.completed.length} passo(s), ${res.skipped.length} pulado(s)` }
    : { status: "failed", detail: `parou em '${res.failed?.stepId}': ${res.failed?.summary}` }
}

/** Executa o create/plan com retomada e hard cap. */
function createStage(ctx, stages) {
  let res = null
  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt++) {
    ctx.attempts = attempt
    appendRunEvent(ctx.runDir, { event: "attempt_started", attempt, stage: "create" })
    res = executePlan({ plan: ctx.plan, planDir: ctx.planDir, cwd: ctx.cwd, exec: ctx.exec, includeOptional: ctx.includeOptional })
    if (res.status === "done") break
    appendRunEvent(ctx.runDir, { event: "attempt_failed", attempt, stoppedAt: res.failed?.stepId, summary: res.failed?.summary })
  }
  stages.create = execResultToStage(res)
  return res
}

/** Estado dos serviços → status honesto do estágio dev. */
function devStatusFromServices(services) {
  const ready = services.filter((s) => s.status === "ready" || s.status === "running")
  if (ready.length) return { status: "ready", detail: `${ready.length}/${services.length} serviço(s) de pé` }
  if (services.length) return { status: "failed", detail: "serviços subiram unhealthy — veja `logs`" }
  return { status: "pending", detail: "nenhum serviço iniciado" }
}

/** Pré-condições do dev: projeto existente + manifest declarado. null = pode rodar. */
function devPrecondition(projectDir) {
  if (!existsSync(projectDir)) return { status: "not_applicable", detail: "projeto não criado neste run" }
  if (!loadRuntimeManifest(projectDir)) return { status: "not_applicable", detail: "sem .gstack/runtime.json — template não declara runtime" }
  return null
}

function failedStageFromError(e, fallbackMsg) {
  return { status: "failed", detail: String(e.message || fallbackMsg).split("\n")[0].slice(0, 160) }
}

function runDev(ctx) {
  const r = (ctx.devRunner || defaultDevRunner)(ctx.projectDir)
  return devStatusFromServices(r?.services || [])
}

function devStage(ctx, stages) {
  const blocked = devPrecondition(ctx.projectDir)
  if (blocked) { stages.dev = blocked; return }
  try { stages.dev = runDev(ctx) }
  catch (e) { stages.dev = failedStageFromError(e, "dev falhou") }
}

function testStage(ctx, stages) {
  if (!existsSync(ctx.projectDir)) { stages.test = { status: "not_applicable", detail: "projeto não criado" }; return }
  const r = runChangedFilesVerify({ cwd: ctx.projectDir, exec: ctx.gateExec })
  stages.test = r.status === "blocked"
    ? { status: "failed", detail: `changed-files: ${r.failed.join(", ")}` }
    : r.status === "fallback"
      ? { status: "pending", detail: "sem git p/ mapear alterados — o estágio verify cobre o gate completo" }
      : { status: "ready", detail: `changed-files: ${r.status} (${r.files.length} arquivo(s))` }
}

function verifyStage(ctx, stages) {
  if (!existsSync(ctx.projectDir)) { stages.verify = { status: "not_applicable", detail: "projeto não criado" }; return null }
  const report = (ctx.verifyRunner || runVerify)({ cwd: ctx.projectDir, profile: ctx.verifyProfile, exec: ctx.gateExec })
  stages.verify = report.status === "blocked"
    ? { status: "failed", detail: `gates falharam: ${(report.failed || []).join(", ")}` }
    : { status: report.usable ? "ready" : "pending", detail: `verify: ${report.status}` }
  return report
}

/** Estado do runtime → status honesto do preview. */
function previewFromState(state, devStatus) {
  const web = state.find((s) => s.url)
  if (web) return { status: "ready", detail: web.url, url: web.url, port: web.port }
  if (state.length) return { status: "pending", detail: "runtime de pé sem URL web — veja `gstack_vibehard logs`" }
  const status = devStatus === "not_applicable" ? "not_applicable" : "pending"
  return { status, detail: "sem preview — rode `gstack_vibehard dev`" }
}

function previewStage(ctx, stages) {
  if (!existsSync(ctx.projectDir)) { stages.preview = { status: "not_applicable", detail: "projeto não criado" }; return }
  let state = []
  try { state = readAllState(ctx.projectDir) } catch { state = [] }
  stages.preview = previewFromState(state, stages.dev?.status)
}

/**
 * Orquestra o pipeline. @returns {{ runId, status, stages, attempts, execResult, handoffPath? }}
 * status: "done" | "handoff".
 */
function buildPipelineCtx(opts, plan, planDir) {
  const { cwd = process.cwd(), verifyProfile = "scaffold", exec, gateExec, devRunner, verifyRunner, scoutRunner } = opts
  const runId = opts.runId || `${plan.id}-${Date.now().toString(36)}`
  const maxAttempts = Number.isInteger(opts.maxAttempts) && opts.maxAttempts > 0 ? opts.maxAttempts : DEFAULT_MAX_ATTEMPTS
  return {
    plan, planDir, cwd, runId,
    runDir: runsDir(cwd, runId),
    projectDir: resolve(cwd, plan.projectName || "."),
    exec, gateExec, devRunner, verifyRunner, scoutRunner, verifyProfile, // gateExec = exec dos GATES; default real
    includeOptional: opts.includeOptional === true,
    maxAttempts,
    attempts: 0,
  }
}

function initialStages(plan) {
  return {
    intent: { status: "ready", detail: `${plan.intent} (template ${plan.template}, modo ${plan.mode})` },
    plan: { status: "ready", detail: "plan.json + plan.md persistidos" },
    review: { status: "advisory", detail: "revisão é ADVISORY (qa/reviewer) — o gate determinístico decide; rode `gstack_vibehard qa` p/ lentes no diff" },
  }
}

function scoutResultToStage(r) {
  if (r.ok) return { status: "ready", detail: `${r.results.length} hit(s) locais · ~${r.tokensAvoided.estimate} tokens evitados (estimativa)` }
  return { status: "pending", detail: r.error || "scout sem termos utilizáveis" }
}

/**
 * Scout (PRD18 Sprint 2): explora ANTES do create quando o projeto JÁ existe —
 * contexto mínimo (paths+linhas) via backends locais. Projeto novo → not_applicable.
 */
function scoutStage(ctx, stages) {
  if (!existsSync(ctx.projectDir)) { stages.scout = { status: "not_applicable", detail: "projeto novo — nada a explorar antes do create" }; return }
  try {
    const r = (ctx.scoutRunner || scout)({ cwd: ctx.projectDir, question: ctx.plan.objective, maxResults: 5 })
    stages.scout = scoutResultToStage(r)
  } catch (e) {
    stages.scout = { status: "pending", detail: `scout indisponível: ${String(e.message || "").slice(0, 80)}` }
  }
}

const GATE_STAGES = new Set(["test", "verify"])
const POST_CREATE_STAGES = [["dev", devStage], ["test", testStage], ["verify", verifyStage], ["preview", previewStage]]

// Fonte de evidência por estágio (define o que PODE provar). test/verify = gate real;
// scout/review nunca provam (viram advisory). O status honesto vem do próprio estágio.
const STAGE_SOURCE = Object.freeze({
  intent: "command", plan: "command", scout: "review", create: "command",
  dev: "command", test: "test", review: "review", verify: "verify", preview: "command",
})
const STAGE_STATUS_TO_EVIDENCE = Object.freeze({
  ready: "proved", failed: "failed", pending: "pending",
  advisory: "advisory", not_applicable: "not_applicable", pending_feature: "pending",
})

/**
 * Espelha os estágios do pipeline no Evidence Ledger da task (=plan.id), PRD18 S4.
 * `start` e `task` compartilham o MESMO ledger. Só test/verify (gate) podem `proved`;
 * o resto que reivindicar prova sem fonte determinística é rebaixado a advisory.
 */
function stageEvidenceEntry(objective, stage, s) {
  return {
    step: stage, objective, action: `pipeline:${stage}`,
    result: s.detail, evidence: s.url || s.detail,
    source: STAGE_SOURCE[stage] || "command",
    status: STAGE_STATUS_TO_EVIDENCE[s.status] || "pending",
  }
}

function writePipelineEvidence(ctx, stages) {
  const taskId = ctx.plan.id
  for (const stage of PIPELINE_STAGES) {
    if (stages[stage]) recordEvidence(ctx.cwd, taskId, stageEvidenceEntry(ctx.plan.objective, stage, stages[stage]))
  }
  try { writeTaskMd(ctx.cwd, taskId, ctx.plan.objective) } catch { /* TASK.md best-effort */ }
}

/** Fecha o run: handoff.md quando aplicável + journal + status.json. */
function finishPipeline(ctx, stages, status, failedStage) {
  let handoffPath
  if (status === "handoff") {
    handoffPath = join(ctx.runDir, "handoff.md")
    writeFileSync(handoffPath, renderHandoff({ runId: ctx.runId, plan: ctx.plan, stages, attempts: ctx.attempts, failedStage }))
  }
  appendRunEvent(ctx.runDir, { event: "pipeline_ended", status, failedStage: failedStage || null, attempts: ctx.attempts })
  writeRunStatus(ctx.runDir, { runId: ctx.runId, planId: ctx.plan.id, status, stages, attempts: ctx.attempts })
  try { writePipelineEvidence(ctx, stages) } catch { /* evidence best-effort — não derruba o run */ }
  // Run Closeout Sync (F4-A): fechamento unificado do run. best-effort, não derruba.
  try { runCloseoutSync({ cwd: ctx.cwd, runId: ctx.runId, command: "start", status }) } catch { /* closeout best-effort */ }
  return { runId: ctx.runId, status, stages, attempts: ctx.attempts, execResult: ctx.execResult, ...(handoffPath ? { handoffPath } : {}) }
}

/** Roda dev→test→verify→preview. Retorna o nome do gate que falhou, ou null. */
function runPostCreateStages(ctx, stages) {
  for (const [stage, fn] of POST_CREATE_STAGES) {
    fn(ctx, stages)
    appendRunEvent(ctx.runDir, { event: "stage_done", stage, status: stages[stage].status, detail: stages[stage].detail })
    // Gate determinístico falhou e não há passo retomável para corrigir → handoff
    // imediato (repetir o mesmo verify sem mudança seria loop zumbi).
    if (GATE_STAGES.has(stage) && stages[stage].status === "failed") return stage
  }
  return null
}

export function runPipeline(opts = {}) {
  const { plan, planDir } = opts
  if (!plan || !planDir) throw new Error("runPipeline: plan e planDir são obrigatórios")
  const ctx = buildPipelineCtx(opts, plan, planDir)
  const stages = initialStages(plan)
  appendRunEvent(ctx.runDir, { event: "pipeline_started", runId: ctx.runId, planId: plan.id, stages: PIPELINE_STAGES })

  // Skill route declarada no start (PRD29 29.2): vira artefato do RUN — a próxima
  // sessão/agente lê quais skills e gates regem esta execução (skillsUsed).
  persistRunDeclarations(ctx, opts)

  // Scout ANTES do create (projeto existente): contexto mínimo, read-only.
  scoutStage(ctx, stages)
  appendRunEvent(ctx.runDir, { event: "stage_done", stage: "scout", status: stages.scout.status })

  // Create (com hard cap + retomada). Cap esgotado → handoff, nunca loop infinito.
  ctx.execResult = createStage(ctx, stages)
  appendRunEvent(ctx.runDir, { event: "stage_done", stage: "create", status: stages.create.status })
  if (stages.create.status === "failed") return finishPipeline(ctx, stages, "handoff", "create")

  const failedGate = runPostCreateStages(ctx, stages)
  if (failedGate) return finishPipeline(ctx, stages, "handoff", failedGate)
  return finishPipeline(ctx, stages, "done")
}
