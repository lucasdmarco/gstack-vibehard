import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { stripBom } from "../util/json.js"

/**
 * Schema de segredos do workspace (PRD 12 §10). Guarda SÓ nomes + metadados —
 * NUNCA valores. O valor vive no keychain do SO (ver providers.js). Evolui o
 * `.gstack/secrets.schema.json` já gerado pelo create (v1 `{required:[str],
 * optional:[str]}`) para o v2 estruturado `{schemaVersion:2, provider, required:[
 * {name, scope, services, sensitive}], optional:[...]}`. PURO/testável.
 */

/** v1 (lista de nomes) ou parcial → v2 estruturado. Idempotente. */
export function migrateSecretsSchema(raw = {}, opts = {}) {
  if (raw && raw.schemaVersion === 2 && Array.isArray(raw.required)) return raw
  const toEntry = (x) => {
    if (x && typeof x === "object") {
      return {
        name: String(x.name || ""),
        scope: x.scope || "runtime",
        services: Array.isArray(x.services) ? x.services : [],
        sensitive: x.sensitive !== false,
      }
    }
    return { name: String(x || ""), scope: "runtime", services: [], sensitive: true }
  }
  const required = (Array.isArray(raw.required) ? raw.required : []).map(toEntry).filter((e) => e.name)
  const optional = (Array.isArray(raw.optional) ? raw.optional : []).map((x) => (x && x.name ? String(x.name) : String(x))).filter(Boolean)
  return {
    schemaVersion: 2,
    provider: raw.provider || opts.provider || "os-keychain",
    required,
    optional,
  }
}

/** Lê + migra o schema do projeto. null se não houver. Tolera BOM. */
export function loadSecretsSchema(projectDir, io = {}) {
  const exists = io.exists || ((p) => existsSync(p))
  const read = io.read || ((p) => { try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null } })
  const p = join(projectDir, ".gstack", "secrets.schema.json")
  if (!exists(p)) return null
  const raw = read(p)
  return raw ? migrateSecretsSchema(raw) : null
}

/** Nomes de segredos REQUERIDOS por um serviço (scope runtime). Sem `services` = todos. */
export function requiredSecretsForService(schema, serviceName) {
  if (!schema || !Array.isArray(schema.required)) return []
  return schema.required
    .filter((e) => e.scope === "runtime")
    .filter((e) => !e.services || e.services.length === 0 || e.services.includes(serviceName))
    .map((e) => e.name)
}

/** Todos os nomes requeridos (qualquer serviço). */
export function allRequiredNames(schema) {
  if (!schema || !Array.isArray(schema.required)) return []
  return schema.required.map((e) => e.name).filter(Boolean)
}
