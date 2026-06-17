import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { buildPlan } from "../project-plan/planner.js"
import { getMode } from "../project-plan/modes.js"
import { success, warn, error, info, section } from "../cli/index.js"

/**
 * `plan` — gera um plano determinístico (sem LLM) a partir de um objetivo textual.
 * PR3: SÓ planeja/imprime/persiste. NÃO executa comandos (executor chega no PR5).
 *
 *   gstack_vibehard plan "<objetivo>" [--name <proj>] [--mode lite|full] [--recipe <id>]
 *   gstack_vibehard plan "<objetivo>" --json     # JSON puro p/ automação
 *   gstack_vibehard plan "<objetivo>" --dry-run  # idêntico (PR3 nunca executa)
 */
function parse(args) {
  const out = { _: [], json: args.includes("--json"), dryRun: args.includes("--dry-run") }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--name") out.name = args[++i]
    else if (a === "--mode") out.mode = args[++i]
    else if (a === "--recipe") out.recipe = args[++i]
    else if (a === "--json" || a === "--dry-run") { /* flag */ }
    else out._.push(a)
  }
  return out
}

function plansDir(cwd) {
  return join(cwd, ".gstack", "plans")
}

/** Persiste o plano em .gstack/plans/<id>/{plan,status}.json (não-destrutivo). */
function persistPlan(cwd, plan) {
  const dir = join(plansDir(cwd), plan.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n")
  writeFileSync(join(dir, "status.json"), JSON.stringify({ id: plan.id, status: "ready", steps: {} }, null, 2) + "\n")
  return dir
}

function printPlanHuman(plan) {
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

export async function planCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const flags = parse(args)
  const sub = flags._[0]

  // Subcomandos de execução/inspeção dependem do executor (PR5) — honesto:
  if (["run", "status", "explain"].includes(sub)) {
    if (flags.json) { process.stdout.write(JSON.stringify({ error: "executor_pending", subcommand: sub }) + "\n"); return }
    section(`plan ${sub}`)
    warn("Execução/inspeção de planos chega no próximo release (executor + journal).")
    info("Por ora, use o plano impresso como guia e rode os comandos manualmente, ou re-gere com `plan \"<objetivo>\"`.")
    return
  }

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
