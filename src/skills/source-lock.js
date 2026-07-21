/**
 * PRD46 S46.1 (§7.4) — Source Lock: representa conteúdo externo (skill/rule_pack/
 * reference_pack) sem obrigar que ele vire uma skill instalada. Project-scoped e
 * versionável: nada aqui cria lock global, symlink global, telemetria ou reinstalação
 * automática. Um hash novo produz `stale` + plano de re-auditoria, nunca silêncio.
 *
 * Determinístico por design: os mesmos repository+commit+path+conteúdo produzem
 * sempre o mesmo id/hash — é o que permite comparar re-auditorias sem ambiguidade.
 */
import { createHash } from "node:crypto"

export const SOURCE_LOCK_SCHEMA = "gstack.skill-source-lock.v1"
export const ARTIFACT_KINDS = Object.freeze(["skill", "rule_pack", "reference_pack"])

export const SOURCE_LOCK_TRANSITIONS = Object.freeze({
  discovered: ["quarantined"],
  quarantined: ["audited", "revoked"],
  audited: ["approved", "revoked"],
  approved: ["compiled", "stale", "revoked"],
  compiled: ["routed", "stale", "revoked"],
  routed: ["executed", "stale", "revoked"],
  executed: ["stale", "revoked"],
  stale: ["audited", "revoked"],
  revoked: [],
})

const GIT_COMMIT_RX = /^[0-9a-f]{40}$/
const TRAVERSAL_RX = /(^|[\\/])\.\.([\\/]|$)/

// PRD46 S46.4: licenças permitidas para vendoring (SPDX). Fora desta lista é
// `unsupported license` — bloqueado, nunca instalado silenciosamente.
export const SUPPORTED_LICENSES = Object.freeze([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense",
])
const licenseSupported = (license) => SUPPORTED_LICENSES.includes(license)

/** Drift de conteúdo: hash atual difere do `originalHash` travado -> nunca reinstalação silenciosa. */
export function hashDrifted(lock, currentContent) {
  return hashContent(currentContent) !== lock.content?.originalHash
}

// PRD46 S46.5 — projeção honesta por tipo de artefato (§9/§11 do PRD): `rule_pack`
// é fundido em gates/agentes existentes; `reference_pack` só é carregado por
// progressive disclosure. NENHUM dos dois vira skill instalada/comando/processo —
// só `skill` projeta como skill de verdade. Docs/doctor/Agent Factory devem
// consultar esta função, nunca inventar a própria regra de projeção.
export const ARTIFACT_PROJECTIONS = Object.freeze({
  skill: "installed_skill",
  rule_pack: "merged_into_gates",
  reference_pack: "progressive_disclosure_only",
})

/** @returns a projeção honesta de um artifactKind, ou null se desconhecido. */
export function projectArtifactKind(artifactKind) {
  return ARTIFACT_PROJECTIONS[artifactKind] || null
}

/** True só quando o artefato de fato aparece como skill instalada. */
export function appearsAsInstalledSkill(artifactKind) {
  return projectArtifactKind(artifactKind) === "installed_skill"
}

function sha256Hex(s) {
  return createHash("sha256").update(String(s)).digest("hex")
}

/** Hash de conteúdo — determinístico: mesmo texto -> sempre o mesmo hash. */
export function hashContent(content) {
  return "sha256:" + sha256Hex(content || "")
}

/** Id estável: mesmo repository+commit+path -> sempre o mesmo id. */
export function buildSourceLockId({ repository, commit, path } = {}) {
  return "sl_" + sha256Hex(`${repository || ""}::${commit || ""}::${path || ""}`).slice(0, 16)
}

/** True se `to` é uma aresta permitida a partir de `from` — revoked é sempre terminal. */
export function canTransitionLock(from, to) {
  const allowed = SOURCE_LOCK_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

function validateLockShape(lock) {
  const reasons = []
  if (lock.schemaVersion !== SOURCE_LOCK_SCHEMA) reasons.push(`schemaVersion inválido: ${lock.schemaVersion}`)
  if (!ARTIFACT_KINDS.includes(lock.artifactKind)) reasons.push(`artifactKind inválido: ${lock.artifactKind}`)
  if (!(lock.status in SOURCE_LOCK_TRANSITIONS)) reasons.push(`status inválido: ${lock.status}`)
  return reasons
}

function isUnsafePath(p) {
  return !p || TRAVERSAL_RX.test(p) || p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)
}

const lockSource = (lock) => lock.source || {}
const commitValid = (src) => GIT_COMMIT_RX.test(String(src.commit || ""))
const pathSafe = (src) => !isUnsafePath(String(src.path || ""))

function validateLockSource(lock) {
  const reasons = []
  const src = lockSource(lock)
  if (!commitValid(src)) reasons.push(`commit deve ser sha completo (40 hex), nunca branch/tag: ${src.commit}`)
  if (!src.license) reasons.push("license ausente — SPDX obrigatório")
  else if (!licenseSupported(src.license)) reasons.push(`license não suportada para vendoring: ${src.license}`)
  if (!pathSafe(src)) reasons.push(`path com travessia ou absoluto: ${src.path}`)
  return reasons
}

/**
 * Valida um source lock: commit precisa ser sha completo (nunca branch/tag mutável),
 * license (SPDX) obrigatória, path sem travessia/absoluto, artifactKind no enum.
 */
export function validateSourceLock(lock) {
  if (!lock || typeof lock !== "object") return { ok: false, reasons: ["source lock ausente"] }
  const reasons = [...validateLockShape(lock), ...validateLockSource(lock)]
  return { ok: reasons.length === 0, reasons }
}

/**
 * Monta um source lock determinístico a partir de conteúdo já lido (nunca toca disco —
 * quem chama é responsável por ler o arquivo com a descoberta read-only de discovery.js).
 */
export function buildSourceLock({
  repository, commit, path, license, artifactKind,
  originalContent = "", normalizedContent = null, routing = {},
} = {}) {
  const normalized = normalizedContent != null ? normalizedContent : originalContent
  return {
    schemaVersion: SOURCE_LOCK_SCHEMA,
    id: buildSourceLockId({ repository, commit, path }),
    artifactKind,
    source: { repository, commit, path, license, folderHash: hashContent(`${repository}::${commit}::${path}`) },
    content: {
      originalHash: hashContent(originalContent),
      normalizedHash: hashContent(normalized),
      modifiedHash: hashContent(normalized),
      modificationMap: [],
    },
    routing: {
      intents: routing.intents || [],
      agents: routing.agents || [],
      gates: routing.gates || [],
      harnesses: routing.harnesses || [],
    },
    status: "discovered",
  }
}
