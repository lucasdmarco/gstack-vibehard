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

const healthPathOf = (h) => (typeof h === "string" ? h : (h && h.path))
const portOf = (svc, envName) => (svc.port ? { preferred: Number(svc.port), env: svc.portEnv || envName, autoAllocate: true } : null)
const readinessOf = (healthPath) => (healthPath ? { type: "http", path: healthPath, timeoutSeconds: 60 } : { type: "process" })

/** Migra um serviço v1 (`{name, command, port, health}`) para o schema v2. */
export function migrateServiceToV2(svc = {}) {
  const name = String(svc.name || "")
  const envName = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_PORT"
  return {
    name,
    command: tokenizeCommand(svc.command),
    cwd: svc.cwd || ".",
    dependsOn: Array.isArray(svc.dependsOn) ? svc.dependsOn : [],
    port: portOf(svc, envName),
    health: { readiness: readinessOf(healthPathOf(svc.health)), liveness: { type: "process" } },
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

// Checagens por-serviço em TABELA (cada uma devolve mensagem ou null) — mantém cc≤6.
const nameCheck = (s, at) => (!s || !s.name ? `${at}: sem name` : (!isValidServiceName(s.name) ? `${at}: name inválido — use [A-Za-z0-9._-] sem '/', '\\' ou '..' (anti path-traversal)` : null))
const commandCheck = (s, at) => (!Array.isArray(s?.command) || s.command.length === 0 ? `${at}: command deve ser array não-vazio (sem shell string)` : (s.command.some((c) => typeof c !== "string") ? `${at}: command só pode conter strings` : null))
const portCheck = (s, at) => (s?.port != null && (typeof s.port !== "object" || typeof s.port.preferred !== "number") ? `${at}: port.preferred deve ser número` : null)
const restartCheck = (s, at) => (s?.restart && !["always", "on-failure", "never"].includes(s.restart.policy) ? `${at}: restart.policy inválido` : null)
const SERVICE_CHECKS = [nameCheck, commandCheck, portCheck, restartCheck]

const serviceLabel = (s, i) => `services[${i}]${s && s.name ? ` (${s.name})` : ""}`

// Validação por-serviço (reusada por v2 e v3). Não lança.
function validateServices(services) {
  if (!Array.isArray(services)) return ["services deve ser um array"]
  return services.flatMap((s, i) => SERVICE_CHECKS.map((c) => c(s, serviceLabel(s, i))).filter(Boolean))
}

/** Valida o manifest v2. Retorna `{ valid, errors }`. Não lança. */
export function validateRuntimeManifest(m) {
  if (!m || typeof m !== "object") return { valid: false, errors: ["manifest ausente/inválido"] }
  const errors = []
  if (m.schemaVersion !== 2) errors.push(`schemaVersion deve ser 2 (veio ${m.schemaVersion})`)
  errors.push(...validateServices(m.services))
  return { valid: errors.length === 0, errors }
}

// ── Runtime Manifest V3 (PRD42 S42.6) ─────────────────────────────────────────────
// v3 = v2 (services) + campos de PROJETO corroborados pela evidência .replit (S42.0E):
// workflows/postMerge/deploy/health. Migração NÃO-destrutiva; v2 segue válido.
export const RUNTIME_MANIFEST_SCHEMA_V3 = 3
const DEFAULT_PROJECT_HEALTH = Object.freeze({ type: "http", path: "/health", timeoutSeconds: 60, intervalSeconds: 5 })

const projectFields = (m) => ({
  workflows: Array.isArray(m.workflows) ? m.workflows : [],
  postMerge: m.postMerge || null,
  deploy: m.deploy || null,
  health: m.health || { ...DEFAULT_PROJECT_HEALTH },
})

/** Migração não-destrutiva v2→v3 (idempotente). Preserva services; adiciona campos de projeto. */
export function migrateManifestToV3(m = {}) {
  if (m.schemaVersion === 3) return m
  const base = m.schemaVersion === 2 ? m : buildRuntimeManifest({ services: m.services || [] })
  return { schemaVersion: 3, services: base.services, ...projectFields(m), migratedFrom: m.schemaVersion || "unknown" }
}

/** Constrói um manifest v3 a partir de services + campos de projeto. */
export function buildRuntimeManifestV3({ services = [], workflows = [], postMerge = null, deploy = null, health = null } = {}) {
  return migrateManifestToV3({ schemaVersion: 2, services: buildRuntimeManifest({ services }).services, workflows, postMerge, deploy, health })
}

const V3_FIELD_CHECKS = [
  (m) => (!Array.isArray(m.workflows) ? "workflows deve ser um array" : null),
  (m) => (m.deploy != null && typeof m.deploy !== "object" ? "deploy deve ser objeto ou null" : null),
  (m) => (m.health != null && typeof m.health !== "object" ? "health deve ser objeto ou null" : null),
]

/** Valida o manifest v3. Reaproveita a validação de serviços do v2. Não lança. */
export function validateRuntimeManifestV3(m) {
  if (!m || typeof m !== "object") return { valid: false, errors: ["manifest ausente/inválido"] }
  const errors = []
  if (m.schemaVersion !== 3) errors.push(`schemaVersion deve ser 3 (veio ${m.schemaVersion})`)
  errors.push(...validateServices(m.services))
  errors.push(...V3_FIELD_CHECKS.map((c) => c(m)).filter(Boolean))
  return { valid: errors.length === 0, errors }
}

/**
 * PRD51 S51.9.1 — V3 PROMOVIDO (§51.9 ação 1, opção "promover com migração
 * V2→V3, rollback e compatibilidade").
 *
 * Antes desta decisão o V3 era **dormente**: schema, migração e validação
 * existiam e eram testados, mas o único consumidor em todo o `src/` era… nada.
 * Só os testes o exercitavam. O loader devolvia v2 mesmo diante de um arquivo
 * v3 (ver `loadV2Preferred`), e o `dev` chamava `validateRuntimeManifest` (v2)
 * sem saber que v3 existia.
 *
 * Promovido significa: **carrega, valida e roda** nas duas versões, com v2
 * seguindo válido (compatibilidade) e um caminho de downgrade EXPLÍCITO
 * (rollback). Não significa que os campos de projeto do v3 executem — eles são
 * declarados e reportados como `declared_not_executed`, porque o supervisor
 * consome `services` e nada mais. Alegar execução de `workflows`/`deploy`
 * seria claim sem prova.
 */
export function validateManifestForVersion(m) {
  if (!m || typeof m !== "object") return { valid: false, errors: ["manifest ausente/inválido"], schemaVersion: null }
  const isV3 = m.schemaVersion === RUNTIME_MANIFEST_SCHEMA_V3
  const result = isV3 ? validateRuntimeManifestV3(m) : validateRuntimeManifest(m)
  return { ...result, schemaVersion: m.schemaVersion ?? null }
}

/** Campos que só o v3 tem — declarados, NÃO executados pelo supervisor. */
export const V3_PROJECT_FIELDS = Object.freeze(["workflows", "postMerge", "deploy", "health"])

/**
 * O que um manifest v3 declara além do que o runtime realmente executa. Serve
 * pra dizer a verdade na superfície em vez de deixar o usuário supor que
 * `workflows`/`deploy` rodam.
 */
export function manifestExecutionScope(m) {
  const isV3 = m?.schemaVersion === RUNTIME_MANIFEST_SCHEMA_V3
  const declared = isV3 ? V3_PROJECT_FIELDS.filter((f) => hasProjectField(m[f])) : []
  return {
    schemaVersion: m?.schemaVersion ?? null,
    executed: ["services"],
    declaredNotExecuted: declared,
    note: declared.length
      ? "campos de projeto do v3 são declarados e preservados, mas o supervisor executa apenas `services`"
      : null,
  }
}
const hasProjectField = (v) => (Array.isArray(v) ? v.length > 0 : v != null)

/**
 * Rollback EXPLÍCITO v3→v2 (§51.9 ação 1 exige rollback). Devolve o manifest v2
 * E a lista do que foi perdido — downgrade nunca é silencioso, nem aqui.
 */
export function downgradeManifestToV2(m = {}) {
  const dropped = V3_PROJECT_FIELDS.filter((f) => hasProjectField(m[f]))
  return { manifest: buildRuntimeManifest({ services: m.services || [] }), dropped }
}

export const PREVIEW_READINESS_SCHEMA = "gstack.preview-readiness.v1"

/**
 * URL de preview só é `ready` quando um probe de health REAL passou — nunca "verde por subir".
 * `healthProbe` injetado (o supervisor faz o HTTP real). Sem probe ok → URL retida.
 */
export function evaluatePreviewReadiness({ url = null, healthProbe = null } = {}) {
  const ok = Boolean(healthProbe && healthProbe.ok === true)
  const reason = ok ? null : (healthProbe ? "health probe não passou" : "sem health probe — URL não é liberada só por subir")
  return { schema: PREVIEW_READINESS_SCHEMA, ready: ok, url: ok ? url : null, reason }
}

/**
 * Carrega o manifest de runtime do projeto: prefere `.gstack/runtime.json` (v2);
 * se ausente, DERIVA de `.gstack/services.json` (v1). null se não houver projeto.
 */
const manifestIo = (io) => ({
  exists: io.exists || ((p) => existsSync(p)),
  readJson: io.readJson || ((p) => { try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null } }),
})

/**
 * PRD51 S51.9.1 — DEFEITO REAL corrigido aqui (§51.9 ação 2, "não permitir
 * downgrade silencioso de V3 para V2").
 *
 * A versão anterior era `m.schemaVersion === 2 ? m : buildRuntimeManifest(...)`.
 * Um arquivo com `schemaVersion: 3` caía no `else` e voltava RECONSTRUÍDO como
 * v2 — **descartando em silêncio** `workflows`, `postMerge`, `deploy` e
 * `health`. Sem aviso, sem erro. Verificado rodando o loader antes da correção:
 * `schemaVersion` voltava 2 e os quatro campos vinham `undefined`.
 *
 * Agora o v3 é carregado COMO v3, íntegro. Só o que NÃO declara versão
 * conhecida é normalizado para v2 (compatibilidade com manifests antigos).
 */
function loadV2Preferred(rt, io) {
  if (!io.exists(rt)) return null
  const m = io.readJson(rt)
  if (!m) return null
  if (m.schemaVersion === RUNTIME_MANIFEST_SCHEMA_V3) return m
  if (m.schemaVersion === 2) return m
  return buildRuntimeManifest({ services: m.services || [] })
}

function loadV1Derived(svcPath, io) {
  if (!io.exists(svcPath)) return null
  const v1 = io.readJson(svcPath)
  return v1 && Array.isArray(v1.services) ? buildRuntimeManifest({ services: v1.services }) : null
}

export function loadRuntimeManifest(projectDir, ioIn = {}) {
  const io = manifestIo(ioIn)
  return loadV2Preferred(join(projectDir, ".gstack", "runtime.json"), io)
    || loadV1Derived(join(projectDir, ".gstack", "services.json"), io)
    || null
}
