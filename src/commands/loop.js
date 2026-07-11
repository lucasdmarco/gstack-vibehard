import { buildLoopState, persistLoopState, readLoopState, loopVerdict, loopExhausted, classifyIntent, LOOP_PHASES, REPLIT_LOOP_SCHEMA } from "../skills/replit-loop.js"
import { runObservePhase } from "../skills/observe-layer.js"
import { runDiagnosePhase, buildCorrectionRequest } from "../skills/diagnose-loop.js"
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

// Carrega o loop.json de um run; erra + marca exit 1 se ausente (retorna null).
function loadRunState(cwd, runId, sub) {
  const state = readLoopState({ root: cwd, runId })
  if (!state) { error(`loop ${sub}: sem loop.json para --run ${runId}`); process.exitCode = 1 }
  return state
}

// Persiste o estado avançado guardando a última observação (consumida por diagnose).
function persistObservedState(cwd, next, observation) {
  const lastObservation = { status: observation.status, visualValidated: observation.visualValidated, problems: observation.problems, checks: observation.checks || {} }
  persistLoopState({ root: cwd, state: { ...next, lastObservation } })
}

async function observeCmd(cwd, args, json) {
  const runId = flagValue(args, "--run")
  const url = flagValue(args, "--url")
  if (!runId || !url) { error("loop observe: informe --run <id> e --url <url do app rodando>"); process.exitCode = 1; return null }
  const state = loadRunState(cwd, runId, "observe")
  if (!state) return null
  const { state: next, observation } = await runObservePhase(state, { root: cwd, url })
  persistObservedState(cwd, next, observation)
  const verdict = loopVerdict(next, observation)
  if (!observation.visualValidated) process.exitCode = 1
  const payload = { schemaVersion: REPLIT_LOOP_SCHEMA, runId, observation, verdict, state: next }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  renderObserve(observation, verdict)
  return payload
}

function renderDiagnose(diagnosis, decision, correction) {
  section(`replit loop — diagnose (${decision.action})`)
  if (diagnosis.passed) { success("  critérios atendidos com evidência e observação limpa — pode fechar checkpoint."); return }
  warn(`  reprovou: ${[...diagnosis.problems, ...diagnosis.pendingCriteria.map((c) => `critério s/ evidência: ${c}`)].join("; ")}`)
  info(`  próximo: ${decision.action} — ${decision.reason}`)
  if (correction) info(`  correção (tentativa ${correction.attempt}/${correction.maxAttempts}): ${correction.guidance}`)
}

function diagnoseCmd(cwd, args, json) {
  const runId = flagValue(args, "--run")
  if (!runId) { error("loop diagnose: informe --run <id>"); process.exitCode = 1; return null }
  const state = loadRunState(cwd, runId, "diagnose")
  if (!state) return null
  const { state: next, diagnosis, next: decision } = runDiagnosePhase(state, { observation: state.lastObservation })
  const correction = diagnosis.passed ? null : buildCorrectionRequest({ diagnosis, state: next })
  persistLoopState({ root: cwd, state: next })
  if (!diagnosis.passed) process.exitCode = 1
  const payload = { schemaVersion: REPLIT_LOOP_SCHEMA, runId, diagnosis, decision, correction, state: next }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  renderDiagnose(diagnosis, decision, correction)
  return payload
}

function printUsage() {
  section("loop")
  info("  loop plan     --intent \"<o que implementar>\" [--accept \"c1;c2\"] [--run <id>] [--json]")
  info("  loop observe  --run <id> --url <url do app rodando> [--json]")
  info("  loop diagnose --run <id> [--json]")
  warn("  ciclo Replit-parity: implement→run→observe→diagnose→autocorrect→checkpoint (bounded). checkpoints+rollback chegam em D4.")
}

const SUBCOMMANDS = Object.freeze({
  plan: (cwd, args, json) => planCmd(cwd, args, json),
  observe: (cwd, args, json) => observeCmd(cwd, args, json),
  diagnose: (cwd, args, json) => diagnoseCmd(cwd, args, json),
})

export async function loopCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
