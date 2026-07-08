import { readFileSync, existsSync } from "fs"
import { join } from "path"

/**
 * Model / quota / budget preflight (PRD28 28.1 + 28.4 / PRD34 F3-B).
 *
 * Delegar sem saber se o modelo existe, está disponível e cabe no orçamento é
 * receita de loop caro. Este módulo resolve `--model auto` por esforço e classifica
 * o estado do modelo em 4 (contrato do PRD): `known` | `unknown` | `unavailable` |
 * `user_capped`. `unknown` NÃO bloqueia (não dá pra verificar — segue com aviso);
 * `unavailable`/`user_capped` bloqueiam com ação. Budget vem de `.gstack/loop-budget.json`.
 * PURO/testável.
 */

export const MODEL_PREFLIGHT_SCHEMA = "gstack.model-preflight.v1"
export const MODEL_STATES = Object.freeze(["known", "unknown", "unavailable", "user_capped"])

// Modelo default por nível de esforço (--model auto). Nomes de família, não IDs.
const EFFORT_MODEL = Object.freeze({ low: "haiku", medium: "sonnet", high: "opus" })
export const EFFORT_LEVELS = Object.freeze(Object.keys(EFFORT_MODEL))

export function resolveEffortModel(effort) { return EFFORT_MODEL[effort] || EFFORT_MODEL.medium }

const defaultIo = Object.freeze({
  exists: existsSync,
  readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } },
})

/** Lê `.gstack/loop-budget.json` (ausente = orçamento vazio, não erro). */
export function loadBudget(root, io = defaultIo) {
  const p = join(root, ".gstack", "loop-budget.json")
  return (io.exists(p) && io.readJson(p)) || {}
}

// Estado do modelo (tabela → cc baixa). available=null significa "não sei verificar".
function modelStatus(model, budget, available) {
  if ((budget.cappedModels || []).includes(model)) return "user_capped"
  if (Array.isArray(available)) return available.includes(model) ? "known" : "unavailable"
  return "unknown"
}
const STATUS_REASON = Object.freeze({
  known: (m) => `modelo '${m}' disponível`,
  unknown: (m) => `não foi possível verificar '${m}' (catálogo indisponível) — sigo com aviso`,
  unavailable: (m) => `modelo '${m}' não está na lista disponível`,
  user_capped: (m) => `modelo '${m}' bloqueado por política do usuário (loop-budget.cappedModels)`,
})

/**
 * Resolve o modelo (auto → esforço) e classifica o estado. `ok:false` só em
 * unavailable/user_capped — unknown segue (não inventa disponibilidade).
 */
export function preflightModel({ model = "auto", effort = "medium", budget = {}, availableModels = null } = {}) {
  const effective = (!model || model === "auto") ? resolveEffortModel(effort) : model
  const status = modelStatus(effective, budget, availableModels)
  return {
    schemaVersion: MODEL_PREFLIGHT_SCHEMA,
    requestedModel: model, model: effective, effort,
    status, ok: status === "known" || status === "unknown",
    reason: STATUS_REASON[status](effective),
    maxIterations: budget.maxIterations ?? null,
  }
}

/** Checa cota diária de delegações (se declarada no budget). */
export function withinBudget(budget = {}, usage = {}) {
  const cap = budget.maxDelegationsPerDay
  const used = usage.delegationsToday || 0
  if (cap != null && used >= cap) return { ok: false, reason: `cota diária de delegações atingida (${used}/${cap})` }
  return { ok: true, reason: null }
}
