import { browserDriverAvailable, playwrightDriver, runVisualGate, VISUAL_GATE_SCHEMA } from "../skills/visual-gate.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `gstack_vibehard visual check --url <u>` (PRD36 36.9). Executa o gate visual:
 * abre a página, captura screenshot+console+rede+a11y e grava evidência. Sem
 * driver de navegador, reporta `needs_browser` (blocked) — nunca finge verde.
 */

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

function renderHuman(result, available) {
  section(`visual gate — ${result.url || "(sem url)"}`)
  if (!available) warn("  driver de navegador AUSENTE (playwright não instalado) — gate não pode validar.")
  info(`  status: ${result.status} · blocked: ${result.blocked}`)
  for (const p of result.problems) info(`    • ${p}`)
  if (result.status === "validated") success("  validado com evidência de navegador (screenshot + console/rede limpos).")
  else error("  NÃO validado — mudança visual não conclui sem evidência de navegador.")
}

function emitVisual(payload, available, json) {
  if (json) process.stdout.write(JSON.stringify(payload) + "\n")
  else renderHuman(payload, available)
  if (payload.blocked) process.exitCode = 1
  return payload
}

async function checkCmd(cwd, args, json) {
  const url = flagValue(args, "--url")
  if (!url) { error("visual check: informe --url <endereço do app rodando>"); process.exitCode = 1; return null }
  const runId = flagValue(args, "--run") || `visual-${Date.now()}`
  const available = browserDriverAvailable()
  const driver = available ? await playwrightDriver({ headless: true }) : null
  const result = await runVisualGate({ root: cwd, runId, url, uiChanged: true, driver })
  return emitVisual({ schemaVersion: VISUAL_GATE_SCHEMA, driverAvailable: available, ...result }, available, json)
}

function printUsage() {
  section("visual")
  info("  visual check --url <endereço> [--run <id>] [--json]   executa o gate visual e grava evidência")
  warn("  sem playwright instalado, reporta needs_browser (blocked) — nunca finge verde.")
}

const SUBCOMMANDS = Object.freeze({ check: (cwd, args, json) => checkCmd(cwd, args, json) })

export async function visualCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
