import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { isValidServiceName } from "./supervisor.js"
import { stripBom } from "../util/json.js"

/**
 * Runtime Manifest V2 (PRD 12 PR3). EVOLUI os manifests já gerados pelo create
 * (`.gstack/services.json`/`ports.json`) — não cria formato concorrente. Comandos
 * sempre em ARRAY (sem shell string), port com autoAllocate, health readiness/
 * liveness, restart com circuit breaker. Sem MOTOR aqui (o supervisor é o PR4):
 * este módulo só constrói, migra e VALIDA o contrato. PURO/testável.
 */

/** Tokeniza um command string em argv, respeitando aspas duplas. */
export function tokenizeCommand(cmd) {
  if (Array.isArray(cmd)) return cmd.filter((x) => x != null).map(String)
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(String(cmd || ""))) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

const DEFAULT_RESTART = Object.freeze({ policy: "on-failure", maxAttempts: 3, backoffSeconds: [1, 3, 10] })

/** Migra um serviço v1 (`{name, command, port, health}`) para o schema v2. */
export function migrateServiceToV2(svc = {}) {
  const name = String(svc.name || "")
  const envName = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_PORT"
  const healthPath = typeof svc.health === "string" ? svc.health : (svc.health && svc.health.path)
  return {
    name,
    command: tokenizeCommand(svc.command),
    cwd: svc.cwd || ".",
    dependsOn: Array.isArray(svc.dependsOn) ? svc.dependsOn : [],
    port: svc.port
      ? { preferred: Number(svc.port), env: svc.portEnv || envName, autoAllocate: true }
      : null,
    health: {
      readiness: healthPath
        ? { type: "http", path: healthPath, timeoutSeconds: 60 }
        : { type: "process" },
      liveness: { type: "process" },
    },
    restart: svc.restart || { ...DEFAULT_RESTART },
    secretRefs: Array.isArray(svc.secretRefs) ? svc.secretRefs : [],
  }
}

/** Constrói o manifest v2 a partir dos serviços v1 (ou já-v2). */
export function buildRuntimeManifest({ services = [] } = {}) {
  return {
    schemaVersion: 2,
    services: services.map((s) => (s && s.schemaVersion === 2 ? s : migrateServiceToV2(s))),
  }
}

/** Valida o manifest v2. Retorna `{ valid, errors }`. Não lança. */
export function validateRuntimeManifest(m) {
  const errors = []
  if (!m || typeof m !== "object") return { valid: false, errors: ["manifest ausente/inválido"] }
  if (m.schemaVersion !== 2) errors.push(`schemaVersion deve ser 2 (veio ${m.schemaVersion})`)
  if (!Array.isArray(m.services)) errors.push("services deve ser um array")
  for (const [i, s] of (m.services || []).entries()) {
    const at = `services[${i}]${s && s.name ? ` (${s.name})` : ""}`
    if (!s || !s.name) errors.push(`${at}: sem name`)
    else if (!isValidServiceName(s.name)) errors.push(`${at}: name inválido — use [A-Za-z0-9._-] sem '/', '\\' ou '..' (anti path-traversal)`)
    if (!Array.isArray(s?.command) || s.command.length === 0) errors.push(`${at}: command deve ser array não-vazio (sem shell string)`)
    else if (s.command.some((c) => typeof c !== "string")) errors.push(`${at}: command só pode conter strings`)
    if (s?.port != null && (typeof s.port !== "object" || typeof s.port.preferred !== "number")) errors.push(`${at}: port.preferred deve ser número`)
    if (s?.restart && !["always", "on-failure", "never"].includes(s.restart.policy)) errors.push(`${at}: restart.policy inválido`)
  }
  return { valid: errors.length === 0, errors }
}

/**
 * Carrega o manifest de runtime do projeto: prefere `.gstack/runtime.json` (v2);
 * se ausente, DERIVA de `.gstack/services.json` (v1). null se não houver projeto.
 */
export function loadRuntimeManifest(projectDir, io = {}) {
  const exists = io.exists || ((p) => existsSync(p))
  const readJson = io.readJson || ((p) => { try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null } })
  const rt = join(projectDir, ".gstack", "runtime.json")
  if (exists(rt)) {
    const m = readJson(rt)
    if (m) return m.schemaVersion === 2 ? m : buildRuntimeManifest({ services: m.services || [] })
  }
  const svcPath = join(projectDir, ".gstack", "services.json")
  if (exists(svcPath)) {
    const v1 = readJson(svcPath)
    if (v1 && Array.isArray(v1.services)) return buildRuntimeManifest({ services: v1.services })
  }
  return null
}
