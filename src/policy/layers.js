import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { stripBom } from "../util/json.js"
import { mergeJson } from "../installer/merge.js"
import { DEFAULT_POLICY, normalizePolicy } from "./schema.js"

/**
 * Config em camadas (PRD15 §7.2): compartilhado versionado + local pessoal
 * gitignored. `config.json`/`policy.json` são do time; `*.local.json` nunca são
 * comitados. Segredos JAMAIS entram em qualquer camada (a policy versiona padrões).
 */

export const LAYER_FILES = Object.freeze({
  config: "config.json",
  configLocal: "config.local.json",
  policy: "policy.json",
  policyLocal: "policy.local.json",
})

// Padrões que o .gitignore do projeto DEVE conter (arquivos locais).
export const REQUIRED_GITIGNORE = Object.freeze([
  ".gstack/config.local.json",
  ".gstack/policy.local.json",
])

function gstackDir(cwd) { return join(cwd, ".gstack") }
export function layerPath(cwd, key) { return join(gstackDir(cwd), LAYER_FILES[key]) }

function readJson(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(stripBom(readFileSync(path, "utf-8"))) } catch { return null }
}

/**
 * Policy efetiva = default ← policy.json ← policy.local.json (local sobrepõe/exceção).
 * Retorna também a proveniência (quais camadas existiam).
 */
export function loadEffectivePolicy(cwd) {
  const base = readJson(layerPath(cwd, "policy"))
  const local = readJson(layerPath(cwd, "policyLocal"))
  let eff = normalizePolicy(DEFAULT_POLICY)
  const layers = []
  if (base) { eff = normalizePolicy(mergeJson(eff, normalizePolicy(base))); layers.push("policy.json") }
  else layers.push("default")
  if (local) { eff = normalizePolicy(mergeJson(eff, normalizePolicy(local))); layers.push("policy.local.json") }
  return { policy: eff, layers }
}

/** Config efetiva = config.json ← config.local.json. */
export function loadEffectiveConfig(cwd) {
  const base = readJson(layerPath(cwd, "config")) || {}
  const local = readJson(layerPath(cwd, "configLocal"))
  const layers = base && Object.keys(base).length ? ["config.json"] : []
  const eff = local ? mergeJson(base, local) : base
  if (local) layers.push("config.local.json")
  return { config: eff, layers }
}

/** O .gitignore do projeto cobre os arquivos locais? { ok, missing, hasGitignore }. */
export function localsGitignored(cwd) {
  const gi = join(cwd, ".gitignore")
  if (!existsSync(gi)) return { ok: false, missing: [...REQUIRED_GITIGNORE], hasGitignore: false }
  let text = ""
  try { text = readFileSync(gi, "utf-8") } catch { return { ok: false, missing: [...REQUIRED_GITIGNORE], hasGitignore: true } }
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()))
  const covered = (p) => lines.has(p) || lines.has(p.replace(".gstack/", "")) || lines.has(".gstack/") || lines.has(".gstack/*.local.json")
  const missing = REQUIRED_GITIGNORE.filter((p) => !covered(p))
  return { ok: missing.length === 0, missing, hasGitignore: true }
}
