import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync } from "child_process"
import { diagnoseOpenCode } from "../installer/opencode-jsonc.js"
import { inspectOpenCodeConfig } from "./opencode-config.js"

/**
 * OpenCode Doctor v2 (PRD24 Sprint 24.1) — inspirado no doctor do oh-my-openagent,
 * mas READ-ONLY e sem escrita destrutiva. Compõe o diagnóstico de config sagrada
 * (`diagnoseOpenCode`) + estratégia (`inspectOpenCodeConfig`) + detecção de plugins
 * gerenciados + presença do CLI OpenCode, em categorias com exit code honesto.
 *
 * PURO/injetável (`home`/`probe`/`pluginDir`/`pluginNames`): não spawna `opencode`
 * em teste e nunca toca no disco. NUNCA renomeia/consolida `opencode.jsonc`.
 */

// Plugins gerenciados pelo GStack (mesma lista que installOpenCode copia).
export const MANAGED_PLUGINS = Object.freeze(["gstack-security.js", "gstack-session.js", "gstack-prompt.js"])

// Probe padrão do CLI OpenCode: nunca lança; devolve versão ou null.
function defaultProbe(home) {
  try {
    return execFileSync("opencode", ["--version"], { encoding: "utf-8", timeout: 3000 }).trim()
  } catch {
    return null
  }
}

// ── categoria: system (CLI presente?) ────────────────────────────────────────
function systemCategory(version, strict) {
  const status = version ? "ok" : strict ? "error" : "warn"
  return { status, opencodeVersion: version || null }
}

// ── categoria: config (autoridade + shadowing, via diagnoseOpenCode) ─────────
function configStatus(diag) {
  if (diag.parseError) return "error"
  if (diag.shadowingRisk === "high" || diag.conflict) return "warn"
  return "ok"
}
function configCategory(diag) {
  return {
    status: configStatus(diag),
    authority: diag.configAuthority,
    hasJson: diag.hasJson,
    hasJsonc: diag.hasJsonc,
    shadowingRisk: diag.shadowingRisk,
    sensitiveKeys: diag.jsoncSensitiveKeys,
    parseError: diag.parseError || null,
  }
}

// ── categoria: plugins (gerenciados presentes no dir de plugins) ─────────────
function pluginsCategory(pluginDir, pluginNames) {
  const present = pluginNames.filter((f) => existsSync(join(pluginDir, f)))
  return { status: present.length > 0 ? "ok" : "warn", dir: pluginDir, managedPresent: present }
}

// ── categoria: residue (.jsonc.gstack-disabled deixado por versão antiga) ────
function residueCategory(diag) {
  return { status: diag.disabledResidue ? "warn" : "ok", disabledJsonc: diag.disabledResidue }
}

// models: sem lista não-interativa segura no OpenCode → honesto "unknown".
const MODELS_CATEGORY = Object.freeze({ status: "unknown", reason: "no safe non-interactive OpenCode model list available" })

// ── recommendedActions: derivadas da autoridade/estado (nunca automáticas) ───
function recommendedActions(diag) {
  const actions = []
  if (diag.disabledResidue) actions.push({ id: "restore-jsonc", safe: true, requiresFlag: "--restore-jsonc" })
  if (diag.configAuthority === "conflict" && diag.shadowingRisk === "high") {
    actions.push({ id: "preserve-jsonc", safe: true, automatic: false })
  }
  if (diag.recommendedAction === "merge") actions.push({ id: "merge-json", safe: true, requiresFlag: "--apply" })
  return actions
}

// exitCode agregado: 1 se algum error; senão 2 se algum warn; senão 0.
function aggregateExit(categories) {
  const statuses = Object.values(categories).map((c) => c.status)
  if (statuses.includes("error")) return 1
  if (statuses.includes("warn")) return 2
  return 0
}

/**
 * Constrói o relatório v2. `enforcement` declara honestamente rules_only/plugin-backed.
 * @returns {{ schemaVersion, ok, exitCode, categories, recommendedActions, enforcement }}
 */
export function buildOpenCodeDoctorV2(opts = {}) {
  const home = opts.home || homedir()
  const probe = opts.probe || defaultProbe
  const pluginDir = opts.pluginDir || join(home, ".config", "opencode", "plugins")
  const pluginNames = opts.pluginNames || MANAGED_PLUGINS
  const strict = opts.strict === true
  const diag = diagnoseOpenCode(home)
  const plugins = pluginsCategory(pluginDir, pluginNames)
  const categories = {
    system: systemCategory(probe(home), strict),
    config: configCategory(diag),
    plugins,
    skills: { status: "ok", dir: join(home, ".config", "opencode", "skills") },
    models: MODELS_CATEGORY,
    residue: residueCategory(diag),
  }
  const exitCode = aggregateExit(categories)
  return {
    schemaVersion: "gstack.opencode.v2",
    ok: exitCode === 0,
    exitCode,
    categories,
    recommendedActions: recommendedActions(diag),
    // Honestidade PRD24 §4.2 P2: OpenCode é rules_only/plugin-backed até plugin provado.
    enforcement: plugins.managedPresent.length > 0 ? "plugin_backed" : "rules_only",
    strategy: inspectOpenCodeConfig(home).preferredStrategy,
  }
}
