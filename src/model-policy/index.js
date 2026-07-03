import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { stripBom } from "../util/json.js"
import { DEFAULT_MODEL_POLICY, validateModelPolicy } from "./schema.js"

/**
 * Carregamento/resolução do `.gstack/model-policy.json` (PRD18 Sprint 2).
 * `resolveModel(kind)` NUNCA exige modelo externo: sem modelo configurado para o
 * tier, o resultado declara `fallback: "local_deterministic"` — quem consome
 * (scout/review) usa a ferramenta local em vez de chamar LLM.
 */

export function modelPolicyPath(cwd) { return join(cwd, ".gstack", "model-policy.json") }

/** Policy efetiva: arquivo do projeto (validado) ou default. Nunca lança. */
export function loadModelPolicy(cwd) {
  const p = modelPolicyPath(cwd)
  if (!existsSync(p)) return { policy: DEFAULT_MODEL_POLICY, source: "default" }
  try {
    const parsed = JSON.parse(stripBom(readFileSync(p, "utf-8")))
    const v = validateModelPolicy(parsed)
    if (!v.valid) return { policy: DEFAULT_MODEL_POLICY, source: "default", warnings: v.errors }
    return { policy: { ...DEFAULT_MODEL_POLICY, ...parsed, modelPolicy: { ...DEFAULT_MODEL_POLICY.modelPolicy, ...parsed.modelPolicy } }, source: "project" }
  } catch (e) {
    return { policy: DEFAULT_MODEL_POLICY, source: "default", warnings: [`model-policy.json ilegível: ${e.message}`] }
  }
}

/**
 * Resolve o modelo para um tipo de tarefa.
 * @returns {{ kind, tier, model|null, fallback|null }}
 */
export function resolveModel(cwd, kind) {
  const { policy } = loadModelPolicy(cwd)
  const tier = policy.modelPolicy[kind] || "default"
  const model = (policy.models || {})[tier] || null
  return { kind, tier, model, fallback: model ? null : "local_deterministic" }
}

/** Cria o arquivo default (idempotente). */
export function initModelPolicy(cwd, { force = false } = {}) {
  const p = modelPolicyPath(cwd)
  if (existsSync(p) && !force) return { created: false, path: p }
  mkdirSync(join(cwd, ".gstack"), { recursive: true })
  writeFileSync(p, JSON.stringify(DEFAULT_MODEL_POLICY, null, 2) + "\n")
  return { created: true, path: p }
}
