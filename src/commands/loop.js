import { buildLoopState, persistLoopState, readLoopState, loopVerdict, loopExhausted, classifyIntent, LOOP_PHASES, REPLIT_LOOP_SCHEMA } from "../skills/replit-loop.js"
import { runObservePhase } from "../skills/observe-layer.js"
import { runDiagnosePhase, buildCorrectionRequest } from "../skills/diagnose-loop.js"
import { createCheckpoint, rollbackToCheckpoint, rollbackToLastGreen } from "../skills/loop-checkpoint.js"
import { proveLoopEconomy, finalizeLoop } from "../skills/loop-economy.js"
import { phaseAtLeast } from "../skills/loop-engine.js"
import { proxyStatus } from "../tools/headroom-proxy.js"
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

const parseList = (arg) => (arg ? arg.split(";").map((s) => s.trim()).filter(Boolean) : [])

function renderCheckpoint(manifest) {
  section(`replit loop — checkpoint #${manifest.seq} (${manifest.green ? "verde" : "não-verde"})`)
  const codeDesc = manifest.hasCode ? `${manifest.files.filter((f) => !f.missing).length} arquivo(s)` : "só contexto"
  info(`  código: ${codeDesc} · nota: ${manifest.note || "-"}`)
}

function checkpointCmd(cwd, args, json) {
  const runId = flagValue(args, "--run")
  if (!runId) { error("loop checkpoint: informe --run <id>"); process.exitCode = 1; return null }
  const manifest = createCheckpoint({ root: cwd, runId, files: parseList(flagValue(args, "--files")), state: readLoopState({ root: cwd, runId }), green: args.includes("--green"), note: flagValue(args, "--note") || "" })
  // S41.4/S41.7: checkpoint rejeitado (runId inválido / arquivo negado por denylist/traversal/segredo)
  if (manifest.ok === false) {
    error(`loop checkpoint: rejeitado (${manifest.status}) — ${manifest.reason}`)
    process.exitCode = 1
    if (json) process.stdout.write(JSON.stringify({ schemaVersion: REPLIT_LOOP_SCHEMA, runId, checkpoint: manifest }) + "\n")
    return null
  }
  const payload = { schemaVersion: REPLIT_LOOP_SCHEMA, runId, checkpoint: manifest }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  renderCheckpoint(manifest)
  return payload
}

function rollbackCmd(cwd, args, json) {
  const runId = flagValue(args, "--run")
  if (!runId) { error("loop rollback: informe --run <id>"); process.exitCode = 1; return null }
  const seqArg = flagValue(args, "--seq")
  const result = seqArg ? rollbackToCheckpoint({ root: cwd, runId, seq: parseInt(seqArg, 10) }) : rollbackToLastGreen({ root: cwd, runId })
  if (!result.ok) process.exitCode = 1
  const payload = { schemaVersion: REPLIT_LOOP_SCHEMA, runId, rollback: result }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  if (result.ok) success(`  rollback ao checkpoint #${result.seq} — ${result.restored.length} arquivo(s) restaurado(s).`)
  else error(`  rollback falhou: ${result.reason}`)
  return payload
}

function renderEconomyClose(final, economy) {
  section(`replit loop — fechamento (${final.verdict})`)
  info(`  ${final.honest}`)
  if (economy.claimable) { success(`  ${economy.note}`); return }
  const pend = economy.pendency?.pending ? ` — pendência: ${economy.pendency.action}` : ""
  warn(`  ${economy.note}${pend}`)
}

function rejectEconomyOrder(runId, from, json) {
  error(`loop economy: invalid_transition — fase '${from}' está antes de 'diagnose'; rode 'loop diagnose --run ${runId}' antes de fechar`)
  process.exitCode = 1
  if (json) process.stdout.write(JSON.stringify({ schemaVersion: REPLIT_LOOP_SCHEMA, runId, error: "invalid_transition", from, need: "diagnose" }) + "\n")
  return null
}

async function economyCmd(cwd, args, json) {
  const runId = flagValue(args, "--run")
  if (!runId) { error("loop economy: informe --run <id>"); process.exitCode = 1; return null }
  const state = loadRunState(cwd, runId, "economy")
  if (!state) return null
  // PRD41 S41.4 (P0.5): fechar o ciclo/economia ANTES de diagnosticar é `invalid_transition`
  // — a ordem é a do Loop Engine (fonte única). Sem diagnose, não há o que "fechar".
  if (!phaseAtLeast(state.phase, "diagnose").ok) return rejectEconomyOrder(runId, state.phase, json)
  const economy = proveLoopEconomy({ state, cwd, proxyState: await proxyStatus({ cwd }) })
  const final = finalizeLoop({ state, observation: state.lastObservation, economy })
  const payload = { schemaVersion: REPLIT_LOOP_SCHEMA, runId, economy, final }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  renderEconomyClose(final, economy)
  return payload
}

function printUsage() {
  section("loop")
  info("  loop plan       --intent \"<o que implementar>\" [--accept \"c1;c2\"] [--run <id>] [--json]")
  info("  loop observe    --run <id> --url <url do app rodando> [--json]")
  info("  loop diagnose   --run <id> [--json]")
  info("  loop checkpoint --run <id> [--files \"a;b\"] [--green] [--note \"...\"] [--json]")
  info("  loop rollback   --run <id> [--seq <n>] [--json]   (sem --seq: último verde)")
  info("  loop economy    --run <id> [--json]   (fecha o ciclo: verdito + economia provada por ledger)")
  warn("  ciclo Replit-parity: implement→run→observe→diagnose→autocorrect→checkpoint (bounded). economia só afirmada com prova de tráfego (Headroom C).")
}

const SUBCOMMANDS = Object.freeze({
  plan: (cwd, args, json) => planCmd(cwd, args, json),
  observe: (cwd, args, json) => observeCmd(cwd, args, json),
  diagnose: (cwd, args, json) => diagnoseCmd(cwd, args, json),
  checkpoint: (cwd, args, json) => checkpointCmd(cwd, args, json),
  rollback: (cwd, args, json) => rollbackCmd(cwd, args, json),
  economy: (cwd, args, json) => economyCmd(cwd, args, json),
})

export async function loopCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
