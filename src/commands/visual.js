import { readFileSync } from "node:fs"
import path from "node:path"
import { browserDriverAvailable, playwrightDriver, runVisualGate, VISUAL_GATE_SCHEMA } from "../skills/visual-gate.js"
import { detectColorContrastFindings } from "../skills/design-detector.js"
import { renderCompactFeedback, renderFeedbackMarkdown } from "../skills/design-feedback.js"
import { buildDesignRuleRegistry, getDesignRule } from "../skills/design-rule-registry.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `gstack_vibehard visual check --url <u>` (PRD36 36.9). Executa o gate visual:
 * abre a página, captura screenshot+console+rede+a11y e grava evidência. Sem
 * driver de navegador, reporta `needs_browser` (blocked) — nunca finge verde.
 *
 * `visual doctor|detect|explain` (PRD49 S49.2B): expõe o detector nativo de
 * design vendorizado (só WCAG color-contrast até agora, S49.2A). `detect` lê
 * um JSON estruturado de elementos já extraídos — NÃO faz scraping de DOM/URL
 * ao vivo ainda (isso depende de código do motor Impeccable ainda não
 * vendorizado, ver src/vendor/impeccable/upstream-map.md).
 */

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const positionalAfter = (args, sub) => { const i = args.indexOf(sub); return i >= 0 ? args.slice(i + 1).find((a) => !a.startsWith("-")) || null : null }

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

function doctorCmd(json) {
  const registry = buildDesignRuleRegistry()
  const payload = {
    schemaVersion: registry.schemaVersion,
    engineSource: "impeccable",
    counts: registry.counts,
    activeRules: registry.rules.filter((r) => r.status === "active").map((r) => r.ruleId),
  }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  section("visual doctor")
  info(`  regras ativas: ${registry.counts.active} · ainda não vendorizadas: ${registry.counts.notYetVendored}`)
  for (const id of payload.activeRules) success(`  ✓ ${id}`)
  warn("  detector nativo é PARCIAL (só color-contrast) — motor completo ainda não vendorizado.")
  return payload
}

function readElementsFile(cwd, target) {
  const abs = path.isAbsolute(target) ? target : path.join(cwd, target)
  return JSON.parse(readFileSync(abs, "utf-8")).elements || []
}

function detectCmd(cwd, args, json) {
  const target = positionalAfter(args, "detect")
  if (!target) { error("visual detect: informe o caminho de um elements-JSON (ver `visual doctor`)"); process.exitCode = 1; return null }
  let elements
  try { elements = readElementsFile(cwd, target) }
  catch { error(`visual detect: não consegui ler/parsear ${target}`); process.exitCode = 1; return null }
  const result = detectColorContrastFindings(elements)
  const feedback = renderCompactFeedback(result.findings)
  const payload = { ...result, feedback }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  section(`visual detect — ${target}`)
  info(`  checados: ${result.counts.checked} · achados: ${result.counts.findings} · ignorados (cor não-parseável): ${result.counts.skipped}`)
  console.log(renderFeedbackMarkdown(feedback))
  return payload
}

function explainCmd(args, json) {
  const ruleId = positionalAfter(args, "explain")
  const rule = ruleId ? getDesignRule(ruleId) : null
  if (!rule) { error(`visual explain: regra desconhecida (${ruleId || "(nenhuma informada)"})`); process.exitCode = 1; return null }
  if (json) { process.stdout.write(JSON.stringify(rule) + "\n"); return rule }
  section(`visual explain — ${rule.ruleId}`)
  info(`  status: ${rule.status} · categoria: ${rule.category} · fonte: ${rule.source}`)
  if (rule.status === "active") info(`  ${rule.description}`)
  else warn(`  ainda não vendorizada: ${rule.reason}`)
  return rule
}

function printUsage() {
  section("visual")
  info("  visual check --url <endereço> [--run <id>] [--json]   executa o gate visual e grava evidência")
  info("  visual doctor [--json]                                 status do motor/regras nativas de design")
  info("  visual detect <elements.json> [--json]                 detecta findings (só color-contrast por ora)")
  info("  visual explain <rule-id> [--json]                      explica uma regra do registry")
  warn("  sem playwright instalado, reporta needs_browser (blocked) — nunca finge verde.")
  warn("  visual detect lê um JSON de elementos já extraídos — não faz scraping de DOM/URL ao vivo ainda.")
}

const SUBCOMMANDS = Object.freeze({
  check: (cwd, args, json) => checkCmd(cwd, args, json),
  doctor: (cwd, args, json) => doctorCmd(json),
  detect: (cwd, args, json) => detectCmd(cwd, args, json),
  explain: (cwd, args, json) => explainCmd(args, json),
})

export async function visualCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json)
  return printUsage()
}
