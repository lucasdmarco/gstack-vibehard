import { readFileSync } from "node:fs"
import path from "node:path"
import { browserDriverAvailable, playwrightDriver, runVisualGate, VISUAL_GATE_SCHEMA } from "../skills/visual-gate.js"
import { detectColorContrastFindings } from "../skills/design-detector.js"
import { renderCompactFeedback, renderFeedbackMarkdown } from "../skills/design-feedback.js"
import { buildDesignRuleRegistry, getDesignRule } from "../skills/design-rule-registry.js"
import { applyDesignHookProjections, designHookStatus } from "../harness/design-hooks.js"
import { resolveDesignSystem } from "../skills/design-system.js"
import { designContextStatus, syncDesignContext } from "../skills/design-context-sync.js"
import { section, success, warn, error, info, confirm } from "../cli/index.js"

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

function hooksStatusCmd(cwd, json) {
  const status = designHookStatus(cwd)
  const payload = { results: status }
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  section("visual hooks status (project-local, nenhum lê/escreve fora do projeto)")
  for (const r of status) (r.installed ? success : warn)(`  ${r.installed ? "✓" : "–"} ${r.harness}: ${r.path}`)
  return payload
}

// PRD51 S51.4.2 — achado real: `hooks install` escrevia 4 arquivos de config do
// projeto (.claude/settings.json, AGENTS.md, .github/copilot-instructions.md,
// .cursor/rules/...) SEM nenhum gate de consentimento — mesmo padrão de
// `--yes`/TTY já usado por `plan run`/`start` (nunca escreve sem confirmação
// explícita em modo não-interativo).
// Injeção de `opts.confirm` (testes/chamada programática) conta como "consegue
// perguntar" — mesmo padrão de `canPromptSelect` (start.js).
const canPromptConfirm = (opts) => Boolean(opts.confirm) || Boolean(process.stdin.isTTY)
function hooksInstallRefused(json, autoYes, opts) {
  if (autoYes || canPromptConfirm(opts)) return false
  if (json) process.stdout.write(JSON.stringify({ error: "needs_confirmation", hint: "use --yes" }) + "\n")
  else { section("visual hooks install"); error("Modo não-interativo: confirme explicitamente com --yes.") }
  return true
}
async function hooksInstallGate(cwd, json, autoYes, doConfirm) {
  if (autoYes) return true
  if (!json) {
    section("visual hooks install (project-local — advisory/instructional, nunca bloqueia)")
    info("  Vai escrever/atualizar: .claude/settings.json, AGENTS.md, .github/copilot-instructions.md, .cursor/rules/gstack-design-detector.mdc")
  }
  const ok = await doConfirm(`Aplicar as projeções de hook de design neste projeto (${cwd})?`, false)
  if (!ok && !json) info("Instalação cancelada.")
  return ok
}
const wantsAutoYes = (args, opts) => args.includes("--yes") || args.includes("-y") || opts.yes === true
function emitCancelled(json) {
  const cancelled = { cancelled: true }
  if (json) process.stdout.write(JSON.stringify(cancelled) + "\n")
  return cancelled
}
const hookLine = (r) => `  ${r.ok ? "✓" : "✗"} ${r.harness}: ${r.path} (${r.ok ? r.action : r.reason})`
function renderHookResult(r) { (r.ok ? success : error)(hookLine(r)) }
function emitInstallResult(result, json) {
  if (json) { process.stdout.write(JSON.stringify(result) + "\n"); return result }
  for (const r of result.results) renderHookResult(r)
  return result
}
async function hooksInstallCmd(cwd, json, args, opts) {
  const autoYes = wantsAutoYes(args, opts)
  if (hooksInstallRefused(json, autoYes, opts)) return { error: "needs_confirmation" }
  const granted = await hooksInstallGate(cwd, json, autoYes, opts.confirm || confirm)
  if (!granted) return emitCancelled(json)
  return emitInstallResult(applyDesignHookProjections(cwd), json)
}

const HOOKS_ACTIONS = Object.freeze({
  status: (cwd, json) => hooksStatusCmd(cwd, json),
  install: (cwd, json, args, opts) => hooksInstallCmd(cwd, json, args, opts),
})

// PRD51 S51.7.5 — design context deixou de ser ilha. `buildProjections` só era
// CALCULADO no preview de `--dry-run` (start.js), nunca escrito nem consumido
// pelo gate. `visual context status` (read-only) e `visual context sync`
// (escreve, com o MESMO gate de consentimento do `hooks install`) fecham isso.
function resolveDsOrExplain(cwd, json) {
  const ds = resolveDesignSystem({ root: cwd, importLegacy: false })
  if (["complete", "generated", "bypassed"].includes(ds.status)) return ds
  const payload = { error: "no_design_system", status: ds.status, hint: "declare o design system antes (start ou --design-system <caminho>)" }
  if (json) process.stdout.write(JSON.stringify(payload) + "\n")
  else { section("visual context"); warn(`Sem design system canônico (status=${ds.status}) — nada a projetar.`) }
  return null
}
function contextStatusCmd(cwd, json) {
  const ds = resolveDsOrExplain(cwd, json)
  if (!ds) return { error: "no_design_system" }
  const st = designContextStatus({ cwd, ds })
  if (json) { process.stdout.write(JSON.stringify(st) + "\n"); return st }
  section("visual context status (read-only)")
  info(`  drift: ${st.status} · sourceHash ${String(st.sourceHash).slice(0, 12)}`)
  if (st.status === "stale") warn("  canônico mudou desde a última sincronização — rode `visual context sync`")
  if (st.status === "absent") info("  nunca sincronizado — rode `visual context sync` pra gerar as projeções")
  return st
}
const syncSummary = (r) => (r.applied ? `Sincronizado (${(r.written || []).length} arquivo(s)).` : "Plano acima (nada escrito) — repita com --yes para aplicar.")
function emitSyncResult(r, json) {
  if (json) { process.stdout.write(JSON.stringify(r) + "\n"); return r }
  for (const p of r.plans) info(`  ${p.action}: ${p.file}`)
  if (r.conflicts.length) warn(`  ${r.conflicts.length} arquivo(s) com edição humana — NUNCA sobrescritos; reconcilie à mão.`)
  ;(r.applied ? success : info)(syncSummary(r))
  return r
}
// Pergunta mostrando o plano ANTES — nunca escreve sem o humano ver o que muda.
async function confirmSync(cwd, ds, json, opts) {
  const plan = syncDesignContext({ cwd, ds, apply: false })
  if (!json) { section("visual context sync"); plan.plans.forEach((p) => info(`  ${p.action}: ${p.file}`)) }
  return (opts.confirm || confirm)(`Escrever as projeções de design context em ${cwd}?`, false)
}
async function contextSyncCmd(cwd, json, args, opts) {
  const ds = resolveDsOrExplain(cwd, json)
  if (!ds) return { error: "no_design_system" }
  const autoYes = wantsAutoYes(args, opts)
  // Sem --yes e sem como perguntar: devolve o PLANO (nada escrito) — nunca
  // pendura no stdin nem escreve sem consentimento (mesmo padrão do hooks install).
  if (!autoYes && !canPromptConfirm(opts)) return emitSyncResult(syncDesignContext({ cwd, ds, apply: false }), json)
  if (!autoYes && !(await confirmSync(cwd, ds, json, opts))) return emitCancelled(json)
  return emitSyncResult(syncDesignContext({ cwd, ds, apply: true }), json)
}
const CONTEXT_ACTIONS = Object.freeze({
  status: (cwd, json) => contextStatusCmd(cwd, json),
  sync: (cwd, json, args, opts) => contextSyncCmd(cwd, json, args, opts),
})
function contextCmd(cwd, args, json, opts) {
  const action = CONTEXT_ACTIONS[positionalAfter(args, "context")]
  if (action) return action(cwd, json, args, opts)
  error("visual context: use `status` ou `sync`")
  process.exitCode = 1
  return null
}

function hooksCmd(cwd, args, json, opts) {
  const action = HOOKS_ACTIONS[positionalAfter(args, "hooks")]
  if (action) return action(cwd, json, args, opts)
  error("visual hooks: use `install` ou `status`")
  process.exitCode = 1
  return null
}

function printUsage() {
  section("visual")
  info("  visual check --url <endereço> [--run <id>] [--json]   executa o gate visual e grava evidência")
  info("  visual doctor [--json]                                 status do motor/regras nativas de design")
  info("  visual detect <elements.json> [--json]                 detecta findings (só color-contrast por ora)")
  info("  visual explain <rule-id> [--json]                      explica uma regra do registry")
  info("  visual hooks install|status [--json] [--yes]           projeções de hook project-local por harness")
  info("  visual context status|sync [--json] [--yes]            design context (PRODUCT.md/DESIGN.md/.impeccable) e drift")
  warn("  visual hooks install pede confirmação (--yes ou TTY) antes de escrever — nunca sem consentimento.")
  warn("  sem playwright instalado, reporta needs_browser (blocked) — nunca finge verde.")
  warn("  visual detect lê um JSON de elementos já extraídos — não faz scraping de DOM/URL ao vivo ainda.")
  warn("  visual hooks nunca escreve config GLOBAL (~/.claude, ~/.cursor, ...) — só dentro do projeto (cwd).")
}

const SUBCOMMANDS = Object.freeze({
  check: (cwd, args, json) => checkCmd(cwd, args, json),
  doctor: (cwd, args, json) => doctorCmd(json),
  detect: (cwd, args, json) => detectCmd(cwd, args, json),
  explain: (cwd, args, json) => explainCmd(args, json),
  hooks: (cwd, args, json, opts) => hooksCmd(cwd, args, json, opts),
  context: (cwd, args, json, opts) => contextCmd(cwd, args, json, opts),
})

export async function visualCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.find((a) => !a.startsWith("-"))
  const handler = SUBCOMMANDS[sub]
  if (handler) return handler(cwd, args, json, opts)
  return printUsage()
}
