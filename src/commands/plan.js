import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { buildPlan } from "../project-plan/planner.js"
import { getMode } from "../project-plan/modes.js"
import { executePlan } from "../project-plan/executor.js"
import { readState } from "../project-plan/state.js"
import { success, warn, error, info, section, confirm } from "../cli/index.js"

/**
 * `plan` — gera um plano determinístico (sem LLM) a partir de um objetivo textual.
 * PR3: SÓ planeja/imprime/persiste. NÃO executa comandos (executor chega no PR5).
 *
 *   gstack_vibehard plan "<objetivo>" [--name <proj>] [--mode lite|full] [--recipe <id>]
 *   gstack_vibehard plan "<objetivo>" --json     # JSON puro p/ automação
 *   gstack_vibehard plan "<objetivo>" --dry-run  # idêntico (PR3 nunca executa)
 */
function parse(args) {
  const out = {
    _: [], json: args.includes("--json"), dryRun: args.includes("--dry-run"),
    yes: args.includes("--yes") || args.includes("-y"), withOptional: args.includes("--with-optional"),
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--name") out.name = args[++i]
    else if (a === "--mode") out.mode = args[++i]
    else if (a === "--recipe") out.recipe = args[++i]
    else if (["--json", "--dry-run", "--yes", "-y", "--with-optional"].includes(a)) { /* flag */ }
    else out._.push(a)
  }
  return out
}

function plansDir(cwd) {
  return join(cwd, ".gstack", "plans")
}

function loadPlan(cwd, planId) {
  if (!planId) return null
  const f = join(plansDir(cwd), planId, "plan.json")
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, "utf-8")) } catch { return null }
}

/** Persiste o plano em .gstack/plans/<id>/{plan,status}.json (não-destrutivo). */
function persistPlan(cwd, plan) {
  const dir = join(plansDir(cwd), plan.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n")
  writeFileSync(join(dir, "status.json"), JSON.stringify({ id: plan.id, status: "ready", steps: {} }, null, 2) + "\n")
  return dir
}

export function printPlanHuman(plan) {
  const mode = getMode(plan.mode)
  section(`plan — ${plan.objective || "(sem objetivo)"}`)
  info(`  intent:           ${plan.intent}`)
  info(`  template:         ${plan.template}`)
  info(`  modo:             ${plan.mode} (recomendado: ${plan.recommendedMode})`)
  if (plan.modeReason) info(`  motivo do modo:   ${plan.modeReason}`)
  if (mode) info(`  ${mode.label}: ${mode.summary}`)
  if (plan.suggestedIntegrations.length) info(`  integrações:      ${plan.suggestedIntegrations.join(", ")}`)
  info("")
  info("  Passos (em ordem):")
  plan.steps.forEach((s, i) => info(`   ${i + 1}. ${s.label}\n        $ ${s.command.join(" ")}${s.cwd && s.cwd !== "." ? `   (em ${s.cwd})` : ""}`))
  if (plan.optionalSteps.length) {
    info("")
    info("  Passos opcionais:")
    plan.optionalSteps.forEach((s) => {
      if (s.pendingFeature) info(`   • ${s.label} — feature futura (pulado)`)
      else info(`   • ${s.label}\n        $ ${s.command.join(" ")}`)
    })
  }
  info("")
  info(`  Plano salvo em .gstack/plans/${plan.id}/`)
  info("  Revise antes de executar. Nada foi executado (PR3 só planeja).")
}

// Por que cada passo existe (explicação honesta para o usuário leigo).
const STEP_WHY = {
  doctor: "Confere se o ambiente tem o necessário antes de criar o projeto.",
  create: "Cria o projeto a partir do template real escolhido pela recipe.",
  "context:init": "Prepara os docs de contexto (ADR/PRD/plans/research) do projeto.",
  "context:index": "Indexa o Document Graph local (busca offline, sem LLM).",
  "tools:suggested": "Lista integrações sugeridas para o template (nada é instalado).",
  "runtime:start": "Sobe os serviços do projeto com o runtime supervisor (`gstack_vibehard dev`).",
  "runtime:logs": "Mostra os logs dos serviços do runtime (`gstack_vibehard logs`).",
  "runtime:open": "Abre a URL do serviço web no navegador (`gstack_vibehard open`).",
}
function whyStep(step) {
  if (STEP_WHY[step.id]) return STEP_WHY[step.id]
  if (step.id.startsWith("tools:install:")) return "Instala uma integração específica (opt-in)."
  if (step.id.startsWith("tools:mcp:enable:")) return "Habilita o MCP da integração (opt-in)."
  return "Passo do plano."
}

function planStatus(cwd, flags) {
  const planId = flags._[1]
  const st = readState(join(plansDir(cwd), planId || ""))
  if (flags.json) { process.stdout.write(JSON.stringify(st || { error: "not_found", planId }) + "\n"); return }
  section(`plan status ${planId || ""}`)
  if (!st) { warn(`Plano não encontrado: ${planId || "(sem id)"}`); return }
  info(`  status: ${st.status}`)
  for (const [id, s] of Object.entries(st.steps || {})) {
    const icon = s === "completed" ? "✓" : s === "failed" ? "✗" : s === "skipped" ? "•" : "·"
    info(`   ${icon} ${id} — ${s}`)
  }
}

function planExplain(cwd, flags) {
  const planId = flags._[1]
  const plan = loadPlan(cwd, planId)
  if (flags.json) {
    if (!plan) { process.stdout.write(JSON.stringify({ error: "not_found", planId }) + "\n"); return }
    process.stdout.write(JSON.stringify({ id: plan.id, steps: plan.steps.map((s) => ({ id: s.id, why: whyStep(s), command: s.command })) }) + "\n")
    return
  }
  section(`plan explain ${planId || ""}`)
  if (!plan) { warn(`Plano não encontrado: ${planId || "(sem id)"}`); return }
  info(`  objetivo: ${plan.objective}`)
  plan.steps.forEach((s, i) => info(`   ${i + 1}. ${s.label}\n        por quê: ${whyStep(s)}\n        $ ${(s.command || []).join(" ")}`))
}

async function planRun(cwd, flags, opts) {
  const planId = flags._[1]
  const plan = loadPlan(cwd, planId)
  if (!plan) {
    if (flags.json) { process.stdout.write(JSON.stringify({ error: "not_found", planId }) + "\n"); return }
    section("plan run"); error('Plano não encontrado: ' + (planId || "(sem id)") + '. Gere primeiro com: plan "<objetivo>"')
    return
  }
  const planDir = join(plansDir(cwd), plan.id)
  const autoYes = flags.yes || opts.yes === true

  // Execução segura: sem TTY e sem --yes → recusa (não roda comando sem consentimento).
  if (!autoYes && !process.stdin.isTTY) {
    if (flags.json) { process.stdout.write(JSON.stringify({ error: "needs_confirmation", hint: "use --yes" }) + "\n"); return }
    section("plan run"); error("Modo não-interativo: confirme explicitamente com --yes."); return
  }

  if (!flags.json) {
    printPlanHuman(plan)
  }
  if (!autoYes) {
    const ok = await confirm(`Executar o plano ${plan.id} (${plan.steps.length} passos)?`, false)
    if (!ok) { info("Execução cancelada."); return }
  }

  const result = executePlan({ plan, planDir, cwd, exec: opts.exec, includeOptional: flags.withOptional })

  if (flags.json) { process.stdout.write(JSON.stringify(result) + "\n"); return }
  if (result.status === "done") success(`Plano concluído: ${result.completed.length} passo(s) ok, ${result.skipped.length} pulado(s).`)
  else { error(`Plano parou em '${result.failed?.stepId}': ${result.failed?.summary}`); info("Corrija e rode `plan run` de novo — passos concluídos são retomados (journal).") }
  return result
}

export async function planCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const flags = parse(args)
  const sub = flags._[0]

  if (sub === "status") return planStatus(cwd, flags)
  if (sub === "explain") return planExplain(cwd, flags)
  if (sub === "run") return planRun(cwd, flags, opts)

  const objective = flags._.join(" ").trim()
  if (!objective) {
    if (flags.json) { process.stdout.write(JSON.stringify({ error: "missing objective" }) + "\n"); return }
    section("plan")
    error("Forneça um objetivo: plan \"quero criar um SaaS com login e Stripe\"")
    info("Flags: --name <proj> --mode lite|full --recipe <id> --json --dry-run")
    return
  }

  const { plan, validation } = buildPlan({ objective, projectName: flags.name, mode: flags.mode, recipeId: flags.recipe })
  if (!validation.ok) {
    if (flags.json) { process.stdout.write(JSON.stringify({ error: "invalid_plan", details: validation.errors }) + "\n"); return }
    error(`Plano inválido: ${validation.errors.join("; ")}`)
    return
  }

  // Persistência é não-destrutiva; --dry-run apenas reforça que nada é executado.
  const dir = persistPlan(cwd, plan)

  if (flags.json) {
    process.stdout.write(JSON.stringify({ plan, savedTo: dir }) + "\n")
    return
  }
  printPlanHuman(plan)
  if (flags.dryRun) success("--dry-run: nenhum comando executado (esperado neste release).")
}
