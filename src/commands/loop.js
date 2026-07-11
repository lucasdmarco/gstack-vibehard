import { buildLoopState, persistLoopState, readLoopState, loopVerdict, loopExhausted, classifyIntent, LOOP_PHASES, REPLIT_LOOP_SCHEMA } from "../skills/replit-loop.js"
import { runObservePhase } from "../skills/observe-layer.js"
import { section, success, warn, info, error } from "../cli/index.js"

/**
 * `gstack_vibehard loop plan --intent "..."` (PRD37 37.0/37.1). EXECUTION layer:
 * o ciclo Replit-parity RODA o app e (em D3) autocorrige. `plan` monta o
 * contrato/estado inicial e grava `.gstack/runs/<runId>/loop.json` — o motor de
 * observação (D2) e autocorreção (D3) constroem sobre este estado.
 */

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

function renderPlan(state) {
  section(`replit loop — plano (${state.intentKind})`)
  info(`  intenção: ${state.intent || "(vazia)"}`)
  info(`  fases: ${LOOP_PHASES.join(" → ")}`)
  info(`  bounded: max ${state.budget.maxIterations} iterações · ${state.budget.maxWallTimeSeconds}s`)
  info(`  aceite: ${state.acceptance.length ? state.acceptance.join("; ") : "(defina com --accept)"}`)
  const intent = classifyIntent(state.intent)
  if (intent.isGenericScaffold) warn("  intenção genérica — o ciclo NÃO é scaffold: descreva a feature (ex.: 'com login e dashboard').")
  success(`  loop.json gravado — LLM propõe; observação/verifier decidem (nunca o LLM).`)
}

function planCmd(cwd, args, json) {
  const intent = flagValue(args, "--intent") || ""
  if (!intent) { error("loop plan: informe --intent \"o que implementar\""); process.exitCode = 1; return null }
  const runId = flagValue(args, "--run") || `loop-${Date.now()}`
  const accept = flagValue(args, "--accept")
  const state = buildLoopState({ runId, intent, acceptance: accept ? accept.split(";").map((s) => s.trim()).filter(Boolean) : [] })
  persistLoopState({ root: cwd, state })
  const payload = { schemaVersion: REPLIT_LOOP_SCHEMA, runId, intentKind: state.intentKind, bounded: loopExhausted(state), phases: [...LOOP_PHASES], state }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  renderPlan(state)
  return payload
}

function renderObserve(observation, verdict) {
  section(`replit loop — observe (${observation.status})`)
  info(`  url: ${observation.url}`)
  if (observation.visualValidated) success("  observação limpa — navegador validou (screenshot + console + rede + a11y).")
  else warn(`  não validou: ${observation.problems.join("; ")}`)
  info(`  verdito do ciclo: ${verdict.verdict} — ${verdict.reason}`)
}

async function observeCmd(cwd, args, json) {
  const runId = flagValue(args, "--run")
  const url = flagValue(args, "--url")
  if (!runId || !url) { error("loop observe: informe --run <id> e --url <url do app rodando>"); process.exitCode = 1; return null }
  const state = readLoopState({ root: cwd, runId })
  if (!state) { error(`loop observe: sem loop.json para --run ${runId} (rode 'loop plan' antes)`); process.exitCode = 1; return null }
  const { state: next, observation } = await runObservePhase(state, { root: cwd, url })
  persistLoopState({ root: cwd, state: next })
  const verdict = loopVerdict(next, observation)
  if (!observation.visualValidated) process.exitCode = 1
  const payload = { schemaVersion: REPLIT_LOOP_SCHEMA, runId, observation, verdict, state: next }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  renderObserve(observation, verdict)
  return payload
}

function printUsage() {
  section("loop")
  info("  loop plan    --intent \"<o que implementar>\" [--accept \"c1;c2\"] [--run <id>] [--json]")
  info("  loop observe --run <id> --url <url do app rodando> [--json]")
  warn("  ciclo Replit-parity: implement→run→observe→diagnose→autocorrect→checkpoint (bounded). diagnose+autocorrect chegam em D3.")
}

const SUBCOMMANDS = Object.freeze({
  plan: (cwd, args, json) => planCmd(cwd, args, json),
  observe: (cwd, args, json) => observeCmd(cwd, args, json),
})

export async function loopCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
